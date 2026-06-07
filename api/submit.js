export const config = { api: { bodyParser: false } }

import { Readable } from 'stream'

async function buffer(readable) {
  const chunks = []
  for await (const chunk of readable) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks)
}

function parseMultipart(buf, boundary) {
  const parts = {}
  const boundaryBuf = Buffer.from('--' + boundary)
  let start = 0

  while (start < buf.length) {
    const boundaryIdx = buf.indexOf(boundaryBuf, start)
    if (boundaryIdx === -1) break
    const headerStart = boundaryIdx + boundaryBuf.length + 2
    const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'), headerStart)
    if (headerEnd === -1) break
    const headers = buf.slice(headerStart, headerEnd).toString()
    const dataStart = headerEnd + 4
    const nextBoundary = buf.indexOf(boundaryBuf, dataStart)
    const dataEnd = nextBoundary === -1 ? buf.length : nextBoundary - 2
    const data = buf.slice(dataStart, dataEnd)

    const nameMatch = headers.match(/name="([^"]+)"/)
    const filenameMatch = headers.match(/filename="([^"]+)"/)
    const contentTypeMatch = headers.match(/Content-Type: ([^\r\n]+)/)

    if (nameMatch) {
      const name = nameMatch[1]
      if (filenameMatch) {
        parts[name] = {
          filename: filenameMatch[1],
          contentType: contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream',
          data,
        }
      } else {
        parts[name] = data.toString().trim()
      }
    }
    start = nextBoundary === -1 ? buf.length : nextBoundary
  }
  return parts
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const contentType = req.headers['content-type'] || ''
    const buf = await buffer(req)
    let parts = {}

    if (contentType.includes('multipart/form-data')) {
      const boundary = contentType.split('boundary=')[1]
      if (!boundary) return res.status(400).json({ error: 'No boundary' })
      parts = parseMultipart(buf, boundary)
    } else {
      const body = JSON.parse(buf.toString())
      parts = body
    }

    const type = parts.type
    const discord_id = parts.discord_id
    const discord_username = parts.discord_username

    if (!type || !discord_id) return res.status(400).json({ error: 'Missing type or discord_id' })

    // Look up the user in Supabase
    const userRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/users?discord_id=eq.${discord_id}&select=id`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }
    )
    const users = await userRes.json()
    const submitted_by = users?.[0]?.id || null

    // ── PLAYER STATS ──
    if (type === 'player_stats') {
      const entry = {
        submitted_by,
        discord_id,
        player_name: parts.player_name,
        faction: parts.faction || null,
        clan: parts.clan || null,
        rank: parts.rank || null,
        kills: parts.kills ? parseInt(parts.kills) : null,
        deaths: parts.deaths ? parseInt(parts.deaths) : null,
        wins: parts.wins ? parseInt(parts.wins) : null,
        losses: parts.losses ? parseInt(parts.losses) : null,
        playtime_hours: parts.playtime_hours ? parseFloat(parts.playtime_hours) : null,
        notes: parts.notes || null,
        status: 'pending',
      }

      const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/player_stats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          Prefer: 'return=representation',
        },
        body: JSON.stringify(entry),
      })

      if (!insertRes.ok) return res.status(500).json({ error: 'Failed to save player stat' })
      const [saved] = await insertRes.json()
      await notifyDiscord('player stat', discord_username, saved.id, entry)
      return res.status(200).json({ success: true, id: saved.id })
    }

// ── FACTION STATS ──
if (type === 'faction_stats') {
  // Upload image to Supabase Storage
  let imageUrl = null
  const imageFile = parts.image
  if (imageFile && imageFile.data) {
    const allowedImages = ['image/png','image/jpeg','image/webp','image/gif']
    if (!allowedImages.includes(imageFile.contentType)) {
      return res.status(400).json({ error: 'Invalid image type. Use PNG, JPG, WebP or GIF.' })
    }
    const imageName = `factions/${discord_id}_${Date.now()}_${imageFile.filename.replace(/[^a-zA-Z0-9._-]/g,'_')}`
    const uploadRes = await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/submissions/${imageName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': imageFile.contentType,
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: imageFile.data,
      }
    )
    if (uploadRes.ok) {
      imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/submissions/${imageName}`
    }
  }

  const entry = {
    submitted_by,
    faction_name: parts.faction_name,
    team: parts.team || null,
    total_members: parts.total_members ? parseInt(parts.total_members) : null,
    date_started: parts.date_started || null,
    owners: parts.owners || null,
    invite_link: parts.invite_link || null,
    roblox_group: parts.roblox_group || null,
    image_proof: imageUrl,
    status: 'pending',
  }

  const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/faction_stats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(entry),
  })

  if (!insertRes.ok) return res.status(500).json({ error: 'Failed to save faction stat' })
  const [saved] = await insertRes.json()
  await notifyDiscord('faction', discord_username, saved.id, entry)
  return res.status(200).json({ success: true, id: saved.id })
}

    // ── VIDEO UPLOAD ──
    if (type === 'video') {
      const file = parts.video
      if (!file || !file.data) return res.status(400).json({ error: 'No video file' })

      const MAX_SIZE = 50 * 1024 * 1024 // 50MB
      if (file.data.length > MAX_SIZE) return res.status(400).json({ error: 'File too large. Maximum 50MB.' })

      const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo']
      if (!allowed.includes(file.contentType)) return res.status(400).json({ error: 'Invalid file type. Use MP4, WebM, or MOV.' })

      const fileName = `${discord_id}_${Date.now()}_${file.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`

      // Upload to Supabase Storage
      const uploadRes = await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/submissions/${fileName}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': file.contentType,
            apikey: process.env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          },
          body: file.data,
        }
      )

      if (!uploadRes.ok) {
        const err = await uploadRes.text()
        console.error('Upload failed:', err)
        return res.status(500).json({ error: 'Video upload failed' })
      }

      const videoUrl = `${process.env.SUPABASE_URL}/storage/v1/object/submissions/${fileName}`

      // Save to player_stats with video reference
      const entry = {
        submitted_by,
        discord_id,
        player_name: parts.player_name,
        faction: parts.faction || null,
        clan: parts.clan || null,
        rank: parts.rank || null,
        kills: parts.kills ? parseInt(parts.kills) : null,
        deaths: parts.deaths ? parseInt(parts.deaths) : null,
        wins: parts.wins ? parseInt(parts.wins) : null,
        losses: parts.losses ? parseInt(parts.losses) : null,
        notes: `Video submission: ${videoUrl}`,
        status: 'pending',
      }

      const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/player_stats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          Prefer: 'return=representation',
        },
        body: JSON.stringify(entry),
      })

      if (!insertRes.ok) return res.status(500).json({ error: 'Failed to save submission' })
      const [saved] = await insertRes.json()
      await notifyDiscord('video stat submission', discord_username, saved.id, { ...entry, video_url: videoUrl })
      return res.status(200).json({ success: true, id: saved.id })
    }

    return res.status(400).json({ error: 'Unknown submission type' })
  } catch (e) {
    console.error('Submit error:', e)
    return res.status(500).json({ error: 'Server error' })
  }
}

async function notifyDiscord(type, username, id, data) {
  const webhookUrl = process.env.MOD_WEBHOOK_URL
  if (!webhookUrl) return

  const fields = Object.entries(data)
    .filter(([k, v]) => v != null && v !== '' && k !== 'submitted_by' && k !== 'status')
    .slice(0, 20)
    .map(([k, v]) => ({ name: k.replace(/_/g, ' '), value: String(v).slice(0, 1024), inline: true }))

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: '@here',
      embeds: [{
        title: `New ${type} submission`,
        description: `**Submitted by:** ${username}\n**ID:** \`${id}\``,
        color: 0xF59E0B,
        fields,
        footer: { text: 'Use /approve or /reject in Discord with this ID' },
        timestamp: new Date().toISOString(),
      }]
    }),
  })
}
