export const config = { api: { bodyParser: true } }

const OWNER_DISCORD_ID = '910599867175419934'

const ALLOWED = {
  dev_patches: ['content', 'title', 'version', 'delete'],
  news: ['content', 'title', 'delete'],
  clan_history: ['description', 'title', 'delete'],
  clan_wars: ['description', 'delete'],
  faction_stats: ['image_proof', 'owners', 'total_members', 'invite_link', 'multi', 'delete'],
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body
  if (!body) return res.status(400).json({ error: 'Empty body' })

  const { id, table, field, value, values, discord_id, is_upload, filename, filetype } = body

  if (discord_id !== OWNER_DISCORD_ID) return res.status(403).json({ error: 'Not authorised' })
  if (!table || !ALLOWED[table]) return res.status(400).json({ error: 'Invalid table' })
  if (!field || !ALLOWED[table].includes(field)) return res.status(400).json({ error: 'Invalid field' })
  if (!id) return res.status(400).json({ error: 'Missing id' })

  // ── DELETE ──
  if (field === 'delete') {
    const deleteRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
    })
    if (!deleteRes.ok) { console.error('Delete error:', await deleteRes.text()); return res.status(500).json({ error: 'Delete failed' }) }
    return res.status(200).json({ success: true })
  }

  // ── MULTI-FIELD UPDATE ──
  if (field === 'multi') {
    if (!values || typeof values !== 'object') return res.status(400).json({ error: 'Missing values' })
    const updateRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify(values),
    })
    if (!updateRes.ok) return res.status(500).json({ error: 'Database update failed' })
    return res.status(200).json({ success: true })
  }

  // ── IMAGE UPLOAD ──
  if (is_upload && field === 'image_proof') {
    if (!value || !filename || !filetype) return res.status(400).json({ error: 'Missing file data' })
    const fileBuffer = Buffer.from(value, 'base64')
    const ext = filename.split('.').pop()
    const storageName = `factions/${id}_${Date.now()}.${ext}`
    const uploadRes = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/submissions/${storageName}`, {
      method: 'POST',
      headers: { 'Content-Type': filetype, apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
      body: fileBuffer,
    })
    if (!uploadRes.ok) { console.error('Upload error:', await uploadRes.text()); return res.status(500).json({ error: 'Image upload failed' }) }
    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/submissions/${storageName}`
    const updateRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/faction_stats?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ image_proof: publicUrl }),
    })
    if (!updateRes.ok) return res.status(500).json({ error: 'Database update failed' })
    return res.status(200).json({ success: true, url: publicUrl })
  }

  // ── STANDARD TEXT UPDATE ──
  if (!value) return res.status(400).json({ error: 'Missing value' })
  const updateRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, Prefer: 'return=minimal' },
    body: JSON.stringify({ [field]: value }),
  })
  if (!updateRes.ok) { console.error('CMS update error:', await updateRes.text()); return res.status(500).json({ error: 'Database update failed' }) }
  return res.status(200).json({ success: true })
}
