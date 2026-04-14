const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

function authenticateToken(req, res, next) {
  logger.debug('Authentication middleware called', {
    url: req.url,
    method: req.method,
    cookies: req.cookies ? Object.keys(req.cookies) : 'no cookies'
  });

  let token = null;
  
  // Сначала пробуем signed cookie, затем обычный
  if (req.signedCookies && req.signedCookies.auth_token) {
    token = req.signedCookies.auth_token;
    logger.debug('Found auth_token in signed cookies');
  } else if (req.cookies && req.cookies.auth_token) {
    token = req.cookies.auth_token;
    logger.debug('Found auth_token in cookies');
  }
  
  if (!token) {
    logger.warn('No auth token found', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    return res.status(401).json({ error: 'Access token required' });
  }
  
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    logger.info('User authenticated successfully', {
      userId: decoded.userId,
      username: decoded.username
    });
    next();
  } catch (err) {
    logger.warn('Invalid token', {
      error: err.message,
      ip: req.ip
    });
    // Очищаем недействительный cookie
    res.clearCookie('auth_token', {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      domain: config.domain
    });
    return res.status(403).json({ error: 'Invalid token' });
  }
}

function optionalAuth(req, res, next) {
  let token = null;
  
  if (req.signedCookies && req.signedCookies.auth_token) {
    token = req.signedCookies.auth_token;
  } else if (req.cookies && req.cookies.auth_token) {
    token = req.cookies.auth_token;
  }
  
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      req.user = decoded;
      logger.debug('Optional auth: user authenticated', {
        userId: decoded.userId
      });
    } catch (err) {
      logger.debug('Optional auth: invalid token, continuing without auth');
      // Не ошибка, просто продолжаем без аутентификации
    }
  }
  
  next();
}

module.exports = {
  authenticateToken,
  optionalAuth
};
