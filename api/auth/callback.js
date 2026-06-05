export default async function handler(req, res) {
  const { code } = req.query

  if (!code) {
    return res.redirect('/?error=no_code')
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
    })

    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      return res.redirect('/?error=token_failed')
    }

    // Get user info from Discord
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const user = await userRes.json()

    if (!user.id) {
      return res.redirect('/?error=user_failed')
    }

    // Upsert user into Supabase
    const sbRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        discord_id: user.id,
        discord_username: user.username,
        discord_avatar: user.avatar,
      }),
    })

    if (!sbRes.ok) {
      console.error('Supabase upsert failed:', await sbRes.text())
    }

    // Pass user info back to frontend via query params (safe — no tokens)
    const params = new URLSearchParams({
      discord_id: user.id,
      username: user.username,
      avatar: user.avatar || '',
    })

    res.redirect(`/?login=success&${params}`)
  } catch (e) {
    console.error('OAuth callback error:', e)
    res.redirect('/?error=server_error')
  }
}
