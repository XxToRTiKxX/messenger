const express = require('express');
const http = require('http');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./utils/logger');
const { waitForDatabase, initDatabase } = require('./db');
const { optionalAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const createHttpLoggerMiddleware = require('./server-modules/httpLogger');
const registerPageRoutes = require('./server-modules/pageRoutes');
const setupWebsocketServer = require('./server-modules/websocket');
const registerLifecycleHandlers = require('./server-modules/lifecycle');

const app = express();
const server = http.createServer(app);
const FRONTEND_ROOT = path.join(__dirname, '../frontend');
const CANDIDATE_DIST_PATH = process.env.FRONTEND_DIST_PATH || '/app/frontend/dist';
const FRONTEND_DIST = fs.existsSync(path.join(CANDIDATE_DIST_PATH, 'index.html'))
  ? CANDIDATE_DIST_PATH
  : '/app/frontend_dist';

app.use(cookieParser(config.cookie.secret));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(createHttpLoggerMiddleware(logger));

app.use('/public', express.static(path.join(FRONTEND_ROOT, 'public')));
app.use('/assets', express.static(path.join(FRONTEND_DIST, 'assets')));
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});
app.get('/public/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/admin/api', adminRoutes);

registerPageRoutes(app, {
  logger,
  optionalAuth,
  frontendDist: FRONTEND_DIST
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  res.status(500).json({
    error: 'Internal server error',
    requestId: req.id
  });
});

app.use((req, res) => {
  logger.warn('Route not found', {
    url: req.url,
    method: req.method
  });

  if (req.path.startsWith('/api') || req.path.startsWith('/auth/')) {
    return res.status(404).json({ error: 'Not found' });
  }

  return res.status(404).send('Not found');
});

setupWebsocketServer(server, {
  logger,
  config,
  onClientsUpdate: apiRoutes.setClients
});

registerLifecycleHandlers({ logger, server });

async function start() {
  await waitForDatabase();
  await initDatabase();

  server.listen(config.port, '0.0.0.0', () => {
    logger.info(`Messenger Server running on port ${config.port}`, {
      environment: config.nodeEnv,
      domain: config.domain
    });
  });
}

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});

module.exports = app;
