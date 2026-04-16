const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDiscordUser, isAdmin } = require('../lib/discord');

const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

const ERROR_MESSAGES = {
  cancelled:     'Login cancelled.',
  invalid_state: 'Login failed (invalid state). Please try again.',
  not_admin:     'You do not have an admin role in the server.',
  oauth_failed:  'Login failed. Please try again.',
};

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/admin');
  const error = ERROR_MESSAGES[req.query.error] || null;
  res.render('login', { error });
});

router.get('/discord', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id:     process.env.CLIENT_ID,
    redirect_uri:  process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope:         'identify',
    state,
  });

  res.redirect(`${DISCORD_AUTH_URL}?${params}`);
});

router.get('/discord/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.redirect('/auth/login?error=cancelled');

  if (!code || !state || state !== req.session.oauthState) {
    return res.redirect('/auth/login?error=invalid_state');
  }

  delete req.session.oauthState;

  try {
    const tokenRes = await fetch(DISCORD_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  process.env.DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
    const { access_token } = await tokenRes.json();

    const discordUser = await getDiscordUser(access_token);

    if (!(await isAdmin(discordUser.id))) {
      return res.redirect('/auth/login?error=not_admin');
    }

    req.session.user = {
      id:         discordUser.id,
      username:   discordUser.username,
      globalName: discordUser.global_name,
      avatar:     discordUser.avatar,
    };

    res.redirect('/admin');
  } catch (err) {
    console.error('OAuth error:', err);
    res.redirect('/auth/login?error=oauth_failed');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

module.exports = router;
