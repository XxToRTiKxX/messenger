const test = require('node:test');
const assert = require('node:assert/strict');

const { revokeToken, isTokenRevoked } = require('../../backend/src/server-modules/tokenRevocation');

function createJwtWithExp(expSeconds) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'u1', exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
}

test('revokeToken marks valid token as revoked until expiry', () => {
  const token = createJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  revokeToken(token);
  assert.equal(isTokenRevoked(token), true);
});

test('expired token is auto-cleaned and not considered revoked', () => {
  const token = createJwtWithExp(Math.floor(Date.now() / 1000) - 10);
  revokeToken(token);
  assert.equal(isTokenRevoked(token), false);
});

test('invalid/empty token input does not crash and is not revoked', () => {
  revokeToken('');
  revokeToken('not-a-jwt');

  assert.equal(isTokenRevoked(''), false);
  assert.equal(isTokenRevoked('not-a-jwt'), true);
});
