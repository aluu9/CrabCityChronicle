const OWNER_DISCORD_ID = '910599867175419934'

// Allowed tables and fields to prevent arbitrary writes
const ALLOWED = {
  dev_patches: ['content', 'title', 'version'],
  news: ['content', 'title'],
  clan_history: ['description', 'title'],
  clan_wars: ['description'],
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let body
  try { body = req.body } catch(e) { return res.status(400).json({ error: 'Invalid body' }) }

  const { id, table, field, value, discord_id } = body

  // Owner check
  if (discord_id !== OWNER_DISCORD_ID) {
    return res.status(403).json({ error: 'Not authorised' })
  }

  // Validate table and field
  if (!ALLOWED[table] || !ALLOWED[table].includes(field)) {
    return res.status(400).json({ error: 'Invalid table or field' })
  }

  if (!id || !value) {
    return res.status(400).json({ error: 'Missing id or value' })
  }

  // Update in Supabase
  const updateRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ [field]: value }),
    }
  )

  if (!updateRes.ok) {
    const err = await updateRes.text()
    console.error('CMS update error:', err)
    return res.status(500).json({ error: 'Database update failed' })
  }

  return res.status(200).json({ success: true })
}
