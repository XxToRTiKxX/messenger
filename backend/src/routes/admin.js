const express = require('express');
const config = require('../config');
const { query } = require('../db');
const logger = require('../utils/logger');
const {
  setAdminCookie,
  clearAdminCookie,
  createAdminToken,
  requireAdminAuth
} = require('../middleware/adminAuth');

const router = express.Router();

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

module.exports = router;
