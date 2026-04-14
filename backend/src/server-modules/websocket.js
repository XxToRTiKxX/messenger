const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

function extractAuthToken(cookieHeader) {
  if (!cookieHeader) return null;

  const cookieArray = cookieHeader.split(';');
  for (const cookie of cookieArray) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'auth_token') return value;
  }

  return null;
}

function setupWebsocketServer(server, { logger, config, onClientsUpdate }) {
  const clients = new Map();
  const wss = new WebSocket.Server({ server });

  const notifyClientsUpdate = () => {
    if (typeof onClientsUpdate === 'function') {
      onClientsUpdate(clients);
    }
  };

  wss.on('connection', (ws, req) => {
    logger.info('WebSocket connection established', {
      ip: req.socket.remoteAddress
    });

    const authToken = extractAuthToken(req.headers.cookie);
    if (!authToken) {
      logger.warn('WebSocket connection without auth token');
      ws.close(4001, 'Authentication required');
      return;
    }

    try {
      const decoded = jwt.verify(authToken, config.jwt.secret);
      const userId = decoded.userId;
      clients.set(userId, ws);
      notifyClientsUpdate();

      logger.info('WebSocket authenticated', { userId });

      ws.send(
        JSON.stringify({
          type: 'authenticated',
          userId,
          username: decoded.username
        })
      );

      ws.on('message', (message) => {
        logger.debug('WebSocket message received', {
          userId,
          messageLength: message.length
        });
      });

      ws.on('close', () => {
        logger.info('WebSocket connection closed', { userId });
        clients.delete(userId);
        notifyClientsUpdate();
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', {
          userId,
          error: error.message
        });
      });
    } catch (err) {
      logger.error('WebSocket authentication failed', {
        error: err.message
      });
      ws.close(4002, 'Authentication failed');
    }
  });

  notifyClientsUpdate();
  return { wss, clients };
}

module.exports = setupWebsocketServer;
