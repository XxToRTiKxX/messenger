const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { NonceManager } = require('../../backend/src/server-modules/messageCrypto');

test('NonceManager.reserve returns unique 12-byte nonces per key', () => {
  const nonceManager = new NonceManager();
  const iv1 = nonceManager.reserve('k1');
  const iv2 = nonceManager.reserve('k1');

  assert.equal(Buffer.isBuffer(iv1), true);
  assert.equal(Buffer.isBuffer(iv2), true);
  assert.equal(iv1.length, 12);
  assert.equal(iv2.length, 12);
  assert.equal(iv1.equals(iv2), false);
});

test('NonceManager.reset can clear one key or all keys', () => {
  const nonceManager = new NonceManager();
  nonceManager.reserve('k1');
  nonceManager.reserve('k2');

  nonceManager.reset('k1');
  assert.equal(nonceManager.usedNonces.has('k1'), false);
  assert.equal(nonceManager.usedNonces.has('k2'), true);

  nonceManager.reset();
  assert.equal(nonceManager.usedNonces.size, 0);
});

test('NonceManager.reserve throws when it cannot generate unique nonce', () => {
  const nonceManager = new NonceManager();
  const originalRandomBytes = crypto.randomBytes;

  crypto.randomBytes = () => Buffer.alloc(12, 1);
  try {
    nonceManager.reserve('k1');
    assert.throws(() => nonceManager.reserve('k1'), /Failed to allocate unique nonce/);
  } finally {
    crypto.randomBytes = originalRandomBytes;
  }
});
