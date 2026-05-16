const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { query, DEFAULT_SERVER_ID, DEFAULT_CHANNEL_ID } = require('../db');
const logger = require('../utils/logger');
const { createMessageCrypto } = require('../server-modules/messageCrypto');
const {
  setAdminCookie,
  clearAdminCookie,
  createAdminToken,
  requireAdminAuth
} = require('../middleware/adminAuth');

const router = express.Router();
const messageCrypto = createMessageCrypto(config, logger);
const ADAPTIVITY_BOT_USERNAME = 'Adaptivity';

router.use((req, res, next) => {
  logger.info('Admin API request', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

router.get('/client-ping', (req, res) => {
  logger.info('Admin UI client ping', {
    source: 'admin-ui',
    event: req.query?.event || 'ping',
    href: req.query?.href || null,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  return res.status(204).end();
});

router.post('/client-log', (req, res) => {
  const levelRaw = String(req.body?.level || 'info').toLowerCase();
  const level = ['error', 'warn', 'info', 'debug'].includes(levelRaw) ? levelRaw : 'info';
  const payload = {
    source: 'admin-ui',
    event: req.body?.event || 'client_log',
    message: req.body?.message || '',
    details: req.body?.details || null,
    href: req.body?.href || null,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  };

  logger.log(level, 'Admin UI client log', payload);
  return res.json({ ok: true });
});

router.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!config.admin.login || !config.admin.password) {
    return res.status(500).json({ error: 'Admin credentials are not configured' });
  }

  if (login !== config.admin.login || password !== config.admin.password) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const token = createAdminToken(login);
  setAdminCookie(res, token);
  return res.json({ success: true });
});

router.post('/logout', (req, res) => {
  clearAdminCookie(res);
  return res.json({ success: true });
});

router.get('/session', requireAdminAuth, (req, res) => {
  res.json({
    authenticated: true,
    admin: req.admin.login
  });
});

router.get('/requests', requireAdminAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT id,
              username AS "requestedUsername",
              email,
              registration_note AS "about",
              registration_status AS "status",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM users
       WHERE registration_status IN ('pending', 'rejected')
       ORDER BY created_at DESC`
    );
    return res.json({ requests: result.rows });
  } catch (err) {
    logger.error('Failed to load requests for admin', { error: err.message });
    return res.status(500).json({ error: 'Failed to load requests' });
  }
});

router.post('/requests/:id/approve', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `UPDATE users
       SET registration_status = 'active',
           is_approved = TRUE,
           approved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND registration_status = 'pending'
       RETURNING id, username, email`,
      [id]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'Pending request not found' });
    }

    logger.info('Registration request approved', { requestId: id, userId: row.id });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Failed to approve request', { error: err.message });
    return res.status(500).json({ error: 'Failed to approve request' });
  }
});

router.post('/requests/:id/reject', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `UPDATE users
       SET registration_status = 'rejected',
           is_approved = FALSE,
           updated_at = NOW()
       WHERE id = $1
         AND registration_status IN ('pending', 'approved')
       RETURNING id`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Request not found' });
    }

    logger.info('Registration request rejected', { requestId: id });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Failed to reject request', { error: err.message });
    return res.status(500).json({ error: 'Failed to reject request' });
  }
});

router.post('/broadcast', requireAdminAuth, async (req, res) => {
  try {
    const content = String(req.body?.content || '').trim();
    const channelId = String(req.body?.channelId || DEFAULT_CHANNEL_ID).trim() || DEFAULT_CHANNEL_ID;
    if (!content) {
      return res.status(400).json({ error: 'Message content required' });
    }
    if (content.length > 1500) {
      return res.status(400).json({ error: 'Message too long (max 1500 chars)' });
    }

    await query('BEGIN');
    try {
      const existingBot = await query(
        `SELECT id, username
         FROM users
         WHERE username = $1
         ORDER BY created_at ASC
         LIMIT 1`,
        [ADAPTIVITY_BOT_USERNAME]
      );
      let bot = existingBot.rows[0];
      if (!bot) {
        const botResult = await query(
          `INSERT INTO users (id, username, registration_status, is_approved)
           VALUES (gen_random_uuid(), $1, 'active', TRUE)
           RETURNING id, username`,
          [ADAPTIVITY_BOT_USERNAME]
        );
        bot = botResult.rows[0];
      }

      await query(
        `INSERT INTO server_participants (server_id, user_id, role)
         VALUES ($1, $2, 'creator')
         ON CONFLICT (server_id, user_id) DO NOTHING`,
        [DEFAULT_SERVER_ID, bot.id]
      );
      await query(
        `INSERT INTO channel_participants (channel_id, user_id, role)
         VALUES ($1, $2, 'creator')
         ON CONFLICT (channel_id, user_id) DO NOTHING`,
        [channelId, bot.id]
      );

      const messageId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const encryptedContent = messageCrypto.encryptContent(content, 'server', {
        messageId,
        serverId: DEFAULT_SERVER_ID,
        channelId,
        userId: bot.id,
        createdAt,
        type: 'server_message'
      });

      const inserted = await query(
        `INSERT INTO messages (id, user_id, server_id, channel_id, content, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, user_id AS "userId", server_id AS "serverId", channel_id AS "channelId", created_at AS "createdAt"`,
        [messageId, bot.id, DEFAULT_SERVER_ID, channelId, encryptedContent, createdAt]
      );

      await query('COMMIT');
      return res.json({ success: true, message: inserted.rows[0], author: bot.username });
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (err) {
    logger.error('Admin broadcast failed', { error: err.message, admin: req.admin?.login || null });
    return res.status(500).json({ error: 'Failed to broadcast admin message' });
  }
});

module.exports = router;
