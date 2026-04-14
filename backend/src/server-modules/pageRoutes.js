const path = require('path');

function setNoStoreHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
}

function registerPageRoutes(app, { logger, optionalAuth, frontendDist }) {
  app.get('/', (req, res) => {
    logger.debug('Root route accessed, serving auth page');
    return res.redirect('/auth/');
  });

  app.get('/auth/', (req, res) => {
    logger.debug('Auth page requested');
    setNoStoreHeaders(res);
    res.sendFile(path.join(frontendDist, 'auth.html'));
  });

  app.get('/app/', optionalAuth, (req, res) => {
    if (!req.user) {
      return res.redirect('/auth/');
    }
    logger.debug('App page requested', { userId: req.user.userId });
    res.sendFile(path.join(frontendDist, 'index.html'));
  });

  app.get('/app/*', optionalAuth, (req, res) => {
    if (!req.user) {
      return res.redirect('/auth/');
    }
    logger.debug('App SPA route requested', {
      userId: req.user.userId,
      route: req.path
    });
    res.sendFile(path.join(frontendDist, 'index.html'));
  });

  app.get(['/admin', '/admin/'], (req, res) => {
    logger.info('Admin page served', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    setNoStoreHeaders(res);
    res.set('Clear-Site-Data', '"cache"');
    res.sendFile(path.join(frontendDist, 'admin.html'));
  });
}

module.exports = registerPageRoutes;
