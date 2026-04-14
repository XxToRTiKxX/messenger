const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { query, ensureDefaultWorkspaceForUser } = require('../db');
const logger = require('../utils/logger');
const { optionalAuth } = require('../middleware/auth');
const createAuthUsers = require('./auth-modules/users');
const {
  getRedirectUri,
  createOnboardingToken,
  verifyOnboardingToken,
  setAuthCookie,
  telegramDataIsValid
} = require('./auth-modules/helpers');

const router = express.Router();

logger.info('Auth routes initialized');

const { getUserById, getUserByUsername, upsertUserFromProvider } = createAuthUsers({ query, uuidv4 });

function redirectToOnboarding(res, user) {
  if (user.registrationStatus === 'pending') {
    return res.redirect('/auth/?pending=1');
  }
  if (user.registrationStatus === 'rejected') {
    return res.redirect('/auth/?rejected=1');
  }

  const stage = user.passwordHash ? 'profile' : 'credentials';
  const token = createOnboardingToken(user.id, config);
  return res.redirect(`/auth/?onboarding=${encodeURIComponent(token)}&stage=${stage}`);
}

async function finishLogin(req, res, user, provider) {
  if (!user.isApproved || user.registrationStatus !== 'active') {
    logger.info('OAuth user routed to onboarding/pending flow', {
      userId: user.id,
      registrationStatus: user.registrationStatus,
      provider
    });
    return redirectToOnboarding(res, user);
  }

  const token = jwt.sign(
    {
      userId: user.id,
      username: user.username,
      email: user.email
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  await ensureDefaultWorkspaceForUser(user.id);
  setAuthCookie(res, token, config);
  logger.info('Auth successful', { userId: user.id, provider });
  return res.redirect('/app/');
}

router.get('/providers', (req, res) => {
  res.json({
    yandex: { enabled: !!config.yandex.clientId },
    google: { enabled: !!config.google.clientId },
    telegram: {
      enabled: !!config.telegram.botToken && !!config.telegram.botUsername,
      botUsername: config.telegram.botUsername || null
    }
  });
});

router.post('/onboarding/credentials', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');

    const payload = verifyOnboardingToken(token, config);
    if (!payload) {
      return res.status(401).json({ error: 'Сессия onboarding истекла. Войдите через OAuth снова.' });
    }

    const user = await getUserById(payload.userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    if (user.registrationStatus === 'pending') {
      return res.status(409).json({ error: 'Заявка уже отправлена и ожидает одобрения' });
    }
    if (user.registrationStatus === 'active' && user.isApproved) {
      return res.status(409).json({ error: 'Профиль уже активирован' });
    }

    if (!username || username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: 'Логин должен быть от 3 до 32 символов' });
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return res.status(400).json({ error: 'Логин содержит недопустимые символы' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Пароль и подтверждение не совпадают' });
    }

    const conflict = await getUserByUsername(username);
    if (conflict && conflict.id !== user.id) {
      return res.status(409).json({ error: 'Логин уже занят' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await query(
      `UPDATE users
       SET username = $2,
           password_hash = $3,
           registration_status = 'onboarding_profile',
           updated_at = NOW()
       WHERE id = $1`,
      [user.id, username, passwordHash]
    );

    return res.json({ success: true, nextStage: 'profile' });
  } catch (err) {
    logger.error('Onboarding credentials failed', { error: err.message });
    return res.status(500).json({ error: 'Не удалось сохранить логин и пароль' });
  }
});

router.post('/onboarding/profile', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const about = String(req.body?.about || '').trim();

    const payload = verifyOnboardingToken(token, config);
    if (!payload) {
      return res.status(401).json({ error: 'Сессия onboarding истекла. Войдите через OAuth снова.' });
    }

    const user = await getUserById(payload.userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    if (!user.passwordHash) {
      return res.status(400).json({ error: 'Сначала задайте логин и пароль' });
    }
    if (!about || about.length < 10 || about.length > 2000) {
      return res.status(400).json({ error: 'Опишите информацию о себе (10-2000 символов)' });
    }

    await query(
      `UPDATE users
       SET registration_note = $2,
           registration_status = 'pending',
           is_approved = FALSE,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id, about]
    );

    return res.json({ success: true, status: 'pending' });
  } catch (err) {
    logger.error('Onboarding profile failed', { error: err.message });
    return res.status(500).json({ error: 'Не удалось отправить данные на модерацию' });
  }
});

router.get('/yandex', (req, res) => {
  if (!config.yandex.clientId) {
    return res.status(500).json({ error: 'Yandex OAuth not configured' });
  }

  const redirectUri = encodeURIComponent(getRedirectUri(req, 'yandex', config));
  const scope = 'login:email login:info login:avatar';
  const authUrl = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${config.yandex.clientId}&redirect_uri=${redirectUri}&scope=${scope}`;
  return res.redirect(authUrl);
});

router.get('/yandex/callback', optionalAuth, async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`/auth/?error=${encodeURIComponent(error)}`);
  if (!code) return res.redirect('/auth/?error=no_authorization_code');

  try {
    const tokenResponse = await axios.post(
      'https://oauth.yandex.ru/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.yandex.clientId,
        client_secret: config.yandex.clientSecret
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data.access_token;
    const userResponse = await axios.get('https://login.yandex.ru/info', {
      headers: { Authorization: `OAuth ${accessToken}` }
    });

    const p = userResponse.data;
    const user = await upsertUserFromProvider({
      currentUserId: req.user?.userId || null,
      provider: 'yandex',
      providerUserId: String(p.id),
      username: p.display_name || p.real_name || `yandex_${String(p.id).slice(0, 8)}`,
      email: p.default_email || null,
      avatar: p.default_avatar_id || null
    });

    return finishLogin(req, res, user, 'yandex');
  } catch (err) {
    logger.error('Yandex OAuth error', { error: err.message, response: err.response?.data });
    return res.redirect('/auth/?error=authentication_failed');
  }
});

router.get('/google', (req, res) => {
  if (!config.google.clientId) {
    return res.status(500).json({ error: 'Google OAuth not configured' });
  }

  const redirectUri = encodeURIComponent(getRedirectUri(req, 'google', config));
  const scope = encodeURIComponent('openid email profile');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${config.google.clientId}&redirect_uri=${redirectUri}&scope=${scope}&access_type=online&prompt=select_account`;
  return res.redirect(authUrl);
});

router.get('/google/callback', optionalAuth, async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`/auth/?error=${encodeURIComponent(error)}`);
  if (!code) return res.redirect('/auth/?error=no_authorization_code');

  try {
    const redirectUri = getRedirectUri(req, 'google', config);
    const tokenResponse = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data.access_token;
    const userResponse = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const p = userResponse.data;
    const user = await upsertUserFromProvider({
      currentUserId: req.user?.userId || null,
      provider: 'google',
      providerUserId: String(p.sub),
      username: p.name || p.email || `google_${String(p.sub).slice(0, 8)}`,
      email: p.email || null,
      avatar: p.picture || null
    });

    return finishLogin(req, res, user, 'google');
  } catch (err) {
    const providerError =
      err.response?.data?.error_description ||
      err.response?.data?.error ||
      err.message ||
      'authentication_failed';
    logger.error('Google OAuth error', { error: err.message, response: err.response?.data });
    return res.redirect(`/auth/?error=${encodeURIComponent(`google_oauth_failed: ${providerError}`)}`);
  }
});

router.get('/telegram/callback', optionalAuth, async (req, res) => {
  if (!telegramDataIsValid(req.query, config)) {
    return res.redirect('/auth/?error=telegram_signature_invalid');
  }

  try {
    const tgId = String(req.query.id);
    const username =
      req.query.username ||
      [req.query.first_name, req.query.last_name].filter(Boolean).join(' ') ||
      `tg_${tgId.slice(0, 8)}`;

    const user = await upsertUserFromProvider({
      currentUserId: req.user?.userId || null,
      provider: 'telegram',
      providerUserId: tgId,
      username,
      email: null,
      avatar: req.query.photo_url || null
    });

    return finishLogin(req, res, user, 'telegram');
  } catch (err) {
    logger.error('Telegram auth error', { error: err.message });
    return res.redirect('/auth/?error=authentication_failed');
  }
});

router.post('/logout', (req, res) => {
  const cookieBase = {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/'
  };

  res.clearCookie('auth_token', cookieBase);
  res.clearCookie('auth_token', { ...cookieBase, domain: config.domain });
  res.clearCookie('auth_token', { ...cookieBase, domain: 'adaptivity.ru' });
  res.clearCookie('auth_token', { ...cookieBase, domain: '.adaptivity.ru' });

  return res.json({ success: true });
});

router.get('/status', optionalAuth, async (req, res) => {
  if (!req.user?.userId) {
    return res.json({
      authenticated: false,
      user: null,
      timestamp: new Date().toISOString()
    });
  }

  const user = await getUserById(req.user.userId);
  return res.json({
    authenticated: !!user,
    user: user
      ? {
          userId: user.id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          isApproved: user.isApproved,
          registrationStatus: user.registrationStatus
        }
      : null,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
