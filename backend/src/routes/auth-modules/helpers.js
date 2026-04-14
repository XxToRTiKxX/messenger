const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function getBaseUrl(req) {
  const proto = (req.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function getRedirectUri(req, provider, config) {
  if (provider === 'yandex') {
    return config.yandex.redirectUri || `${getBaseUrl(req)}/auth/yandex/callback`;
  }
  if (provider === 'google') {
    return config.google.redirectUri || `${getBaseUrl(req)}/auth/google/callback`;
  }
  return `${getBaseUrl(req)}/auth/${provider}/callback`;
}

function createOnboardingToken(userId, config) {
  return jwt.sign(
    {
      userId,
      purpose: 'onboarding'
    },
    config.jwt.secret,
    { expiresIn: '30m' }
  );
}

function verifyOnboardingToken(token, config) {
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (payload.purpose !== 'onboarding' || !payload.userId) {
      return null;
    }
    return payload;
  } catch (_err) {
    return null;
  }
}

function setAuthCookie(res, token, config) {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    maxAge: config.cookie.maxAge,
    domain: config.domain
  });
}

function telegramDataIsValid(queryData, config) {
  if (!config.telegram.botToken) {
    return false;
  }

  const data = { ...queryData };
  const incomingHash = data.hash;
  if (!incomingHash) return false;
  delete data.hash;

  const dataCheckString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('\n');

  const secret = crypto.createHash('sha256').update(config.telegram.botToken).digest();
  const calculatedHash = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  const authDate = Number(data.auth_date || 0);
  const tooOld = !authDate || Date.now() / 1000 - authDate > 86400;
  return !tooOld && calculatedHash === incomingHash;
}

module.exports = {
  getBaseUrl,
  getRedirectUri,
  createOnboardingToken,
  verifyOnboardingToken,
  setAuthCookie,
  telegramDataIsValid
};
