const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  getBaseUrl,
  getRedirectUri,
  createOnboardingToken,
  verifyOnboardingToken,
  setAuthCookie,
  telegramDataIsValid
} = require('../../backend/src/routes/auth-modules/helpers');

const config = {
  jwt: { secret: 'test-secret' },
  cookie: {
    secure: false,
    sameSite: 'lax',
    maxAge: 1000
  },
  domain: 'example.test',
  yandex: { redirectUri: '' },
  google: { redirectUri: '' },
  telegram: { botToken: '123456:bot-token' }
};

function mockReq(headers = {}) {
  return {
    get: (name) => headers[name.toLowerCase()] || headers[name] || undefined
  };
}

test('getBaseUrl and getRedirectUri use forwarded headers and provider rules', () => {
  const req = mockReq({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'chat.example.test' });

  assert.equal(getBaseUrl(req), 'https://chat.example.test');
  assert.equal(getRedirectUri(req, 'yandex', config), 'https://chat.example.test/auth/yandex/callback');
  assert.equal(getRedirectUri(req, 'google', config), 'https://chat.example.test/auth/google/callback');
  assert.equal(getRedirectUri(req, 'github', config), 'https://chat.example.test/auth/github/callback');
});

test('onboarding token create/verify roundtrip and invalid purpose handling', () => {
  const token = createOnboardingToken('user-1', config);
  const payload = verifyOnboardingToken(token, config);

  assert.ok(payload);
  assert.equal(payload.userId, 'user-1');
  assert.equal(payload.purpose, 'onboarding');

  const invalidPurposePayload = Buffer.from(JSON.stringify({ userId: 'u', purpose: 'other', exp: Date.now() / 1000 + 60 })).toString('base64url');
  const fake = `a.${invalidPurposePayload}.c`;
  assert.equal(verifyOnboardingToken(fake, config), null);
});

test('setAuthCookie writes cookie with expected flags', () => {
  const calls = [];
  const res = {
    cookie: (...args) => calls.push(args)
  };

  setAuthCookie(res, 'jwt-token', config);

  assert.equal(calls.length, 1);
  const [name, value, options] = calls[0];
  assert.equal(name, 'auth_token');
  assert.equal(value, 'jwt-token');
  assert.deepEqual(options, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 1000,
    domain: 'example.test'
  });
});

test('telegramDataIsValid accepts valid payload and rejects stale/wrong hash', () => {
  const authDate = String(Math.floor(Date.now() / 1000));
  const queryData = {
    id: '10001',
    first_name: 'Test',
    username: 'tester',
    auth_date: authDate
  };

  const dataCheckString = Object.keys(queryData)
    .sort()
    .map((key) => `${key}=${queryData[key]}`)
    .join('\n');

  const secret = crypto.createHash('sha256').update(config.telegram.botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  assert.equal(telegramDataIsValid({ ...queryData, hash }, config), true);
  assert.equal(telegramDataIsValid({ ...queryData, hash: 'deadbeef' }, config), false);
  assert.equal(
    telegramDataIsValid({ ...queryData, auth_date: String(Math.floor(Date.now() / 1000) - 90000), hash }, config),
    false
  );
});
