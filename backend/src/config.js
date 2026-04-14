require('dotenv').config();

function getSameSite() {
  const raw = String(process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  if (raw === 'strict' || raw === 'lax' || raw === 'none') {
    return raw;
  }
  return 'lax';
}

const config = {
  port: process.env.PORT || 8000,
  nodeEnv: process.env.NODE_ENV || 'development',
  domain: process.env.DOMAIN || 'localhost',
  yandex: {
    clientId: process.env.YANDEX_CLIENT_ID,
    clientSecret: process.env.YANDEX_CLIENT_SECRET,
    redirectUri: process.env.YANDEX_REDIRECT_URI
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    botUsername: process.env.TELEGRAM_BOT_USERNAME
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback_jwt_secret',
    expiresIn: '7d'
  },
  cookie: {
    secret: process.env.COOKIE_SECRET || 'fallback_cookie_secret',
    maxAge: parseInt(process.env.SESSION_TIMEOUT) || 7 * 24 * 60 * 60 * 1000, // 7 дней
    secure: process.env.NODE_ENV === 'production',
    sameSite: getSameSite()
  },
  admin: {
    login: process.env.ADMIN_LOGIN || null,
    password: process.env.ADMIN_PASSWORD || null
  },
  logLevel: process.env.LOG_LEVEL || 'info'
};

module.exports = config;
