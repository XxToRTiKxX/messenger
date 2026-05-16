const express = require('express');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const {
  query,
  ensureDefaultWorkspaceForUser,
  DEFAULT_SERVER_ID,
  DEFAULT_CHANNEL_ID
} = require('../db');
const logger = require('../utils/logger');
const createShared = require('./api-modules/shared');
const registerProfileRoutes = require('./api-modules/profile');
const registerFriendRoutes = require('./api-modules/friends');
const registerServerRoutes = require('./api-modules/servers');
const registerChannelRoutes = require('./api-modules/channels');
const registerMessageRoutes = require('./api-modules/messages');
const registerMediaRoutes = require('./api-modules/media');
const { createMessageCrypto } = require('../server-modules/messageCrypto');

const router = express.Router();
let clients = new Map();

logger.info('API routes initialized');

const shared = createShared({ query, config });
const messageCrypto = createMessageCrypto(config, logger);

router.post('/client-log', optionalAuth, (req, res) => {
  const levelRaw = String(req.body?.level || 'info').toLowerCase();
  const level = ['error', 'warn', 'info', 'debug'].includes(levelRaw) ? levelRaw : 'info';

  const event = String(req.body?.event || 'client_log').slice(0, 100);
  const message = String(req.body?.message || '').slice(0, 1500);
  const href = String(req.body?.href || '').slice(0, 1000);
  const app = String(req.body?.app || 'unknown').slice(0, 64);

  let details = req.body?.details ?? null;
  try {
    const encoded = JSON.stringify(details);
    if (encoded && encoded.length > 6000) {
      details = { truncated: true };
    }
  } catch (_error) {
    details = { unserializable: true };
  }

  logger.log(level, 'Frontend client log', {
    source: 'frontend-client',
    app,
    event,
    message,
    href,
    details,
    userId: req.user?.userId || null,
    username: req.user?.username || null,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  return res.json({ ok: true });
});

registerProfileRoutes(router, {
  authenticateToken,
  query,
  logger
});

registerFriendRoutes(router, {
  authenticateToken,
  query,
  logger,
  shared,
  broadcastMessage,
  messageCrypto
});

registerServerRoutes(router, {
  authenticateToken,
  query,
  logger,
  uuidv4,
  ensureDefaultWorkspaceForUser,
  shared
});

registerChannelRoutes(router, {
  authenticateToken,
  query,
  logger,
  shared
});

registerMessageRoutes(router, {
  authenticateToken,
  query,
  logger,
  shared,
  uuidv4,
  defaults: {
    DEFAULT_SERVER_ID,
    DEFAULT_CHANNEL_ID
  },
  broadcastMessage,
  messageCrypto
});

registerMediaRoutes(router, {
  authenticateToken,
  query,
  logger,
  shared,
  uuidv4,
  config
});

module.exports = router;
module.exports.setClients = (clientsMap) => {
  clients = clientsMap;
};

function broadcastMessage(eventPayload, options = {}) {
  if (!clients) return;
  const recipientIds = Array.isArray(options.recipientUserIds)
    ? options.recipientUserIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const targetSet = recipientIds.length > 0 ? new Set(recipientIds) : null;

  clients.forEach((userConnections, userId) => {
    if (targetSet && !targetSet.has(userId)) return;

    const sockets = userConnections instanceof Set ? userConnections : new Set([userConnections]);
    sockets.forEach((ws) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (typeof ws.__sendStamped !== 'function') return;
      ws.__sendStamped(eventPayload);
    });
  });
}
