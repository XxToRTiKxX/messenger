const jwt = require('jsonwebtoken');
const config = require('../config');

function setAdminCookie(res, token) {
  clearAdminCookie(res);
  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    maxAge: config.cookie.maxAge,
    path: '/admin'
  });
}

function clearAdminCookie(res) {
  const cookieBase = {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/admin'
  };

  // Clear host-only cookie
  res.clearCookie('admin_token', cookieBase);
  // Clear legacy domain-bound variants
  res.clearCookie('admin_token', { ...cookieBase, domain: config.domain });
  res.clearCookie('admin_token', { ...cookieBase, domain: 'adaptivity.ru' });
  res.clearCookie('admin_token', { ...cookieBase, domain: '.adaptivity.ru' });
}

function createAdminToken(login) {
  return jwt.sign(
    {
      role: 'admin',
      login
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function requireAdminAuth(req, res, next) {
  const token =
    (req.signedCookies && req.signedCookies.admin_token) ||
    (req.cookies && req.cookies.admin_token) ||
    null;

  if (!token) {
    return res.status(401).json({ error: 'Admin auth required' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.admin = decoded;
    return next();
  } catch (err) {
    clearAdminCookie(res);
    return res.status(403).json({ error: 'Invalid admin session' });
  }
}

module.exports = {
  setAdminCookie,
  clearAdminCookie,
  createAdminToken,
  requireAdminAuth
};
