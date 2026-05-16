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
  ws: {
    requireTls: String(process.env.WS_REQUIRE_TLS || (process.env.NODE_ENV === 'production' ? 'true' : 'false')).toLowerCase() === 'true',
    bootstrapPsk: process.env.WS_BOOTSTRAP_PSK || 'dev-ws-bootstrap-psk'
  },
  message: {
    activeKeyId: process.env.MESSAGE_ENCRYPTION_ACTIVE_KEY_ID || 'v1',
    encryptionKeys:
      process.env.MESSAGE_ENCRYPTION_KEYS ||
      (process.env.MESSAGE_ENCRYPTION_MASTER_KEY ? `v1:${process.env.MESSAGE_ENCRYPTION_MASTER_KEY}` : '') ||
      (process.env.MESSAGE_ENCRYPTION_KEY ? `v1:${process.env.MESSAGE_ENCRYPTION_KEY}` : ''),
    migrateOnStart:
      String(process.env.MESSAGE_ENCRYPTION_MIGRATE_ON_START || 'false').toLowerCase() === 'true'
  },
  logLevel: process.env.LOG_LEVEL || 'info'
};

module.exports = config;
