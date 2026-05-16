const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  KeyRing,
  NonceManager,
  MessageCryptoService,
  DecryptionError
} = require('../../backend/src/server-modules/messageCrypto');
const {
  TEST_KEY_ID,
  TEST_KEY_BUFFER,
  buildServerContext,
  buildDmContext
} = require('./helpers');

function createService() {
  const keyRing = new KeyRing(`${TEST_KEY_ID}:${TEST_KEY_BUFFER.toString('base64')}`, { warn: () => {} });
  keyRing.setActiveKeyId(TEST_KEY_ID);
  const nonceManager = new NonceManager();
  return new MessageCryptoService(keyRing, nonceManager);
}

test('MessageCryptoService encrypt/decrypt roundtrip', () => {
  const service = createService();
  const ctx = buildServerContext();

  const encrypted = service.encrypt('service-roundtrip', 'server', ctx);
  const decrypted = service.decrypt(encrypted, 'server', ctx);

  assert.match(encrypted, /^enc:v3:/);
  assert.equal(decrypted, 'service-roundtrip');
});

test('MessageCryptoService decrypt returns raw text when payload is not encrypted', () => {
  const service = createService();

  assert.equal(service.decrypt('just-text', 'dm', buildDmContext()), 'just-text');
});

test('MessageCryptoService decrypt throws DecryptionError for unknown enc version', () => {
  const service = createService();

  assert.throws(
    () => service.decrypt('enc:v999:foo', 'dm', buildDmContext()),
    (error) => error instanceof DecryptionError && error.code === 'DECRYPTION_FAILED'
  );
});

test('MessageCryptoService decrypt throws DecryptionError for invalid MAC', () => {
  const service = createService();
  const ctx = buildServerContext();
  const encrypted = service.encrypt('abc', 'server', ctx);

  const parts = encrypted.split(':');
  parts[6] = Buffer.alloc(31, 0).toString('base64url');

  assert.throws(
    () => service.decrypt(parts.join(':'), 'server', ctx),
    (error) => error instanceof DecryptionError && error.code === 'DECRYPTION_FAILED'
  );
});

test('MessageCryptoService decrypt rejects v1/v2 envelopes', () => {
  const service = createService();
  const ctx = buildServerContext();
  assert.throws(
    () => service.decrypt(`enc:v1:${TEST_KEY_ID}:stub`, 'server', ctx),
    (error) => error instanceof DecryptionError && error.code === 'DECRYPTION_FAILED'
  );
  assert.throws(
    () => service.decrypt(`enc:v2:${TEST_KEY_ID}:stub`, 'server', ctx),
    (error) => error instanceof DecryptionError && error.code === 'DECRYPTION_FAILED'
  );
});

test('MessageCryptoService shouldReencrypt works by v3 envelope only', () => {
  const service = createService();
  const ctx = buildDmContext();
  const encrypted = service.encrypt('x', 'dm', ctx);

  assert.equal(service.shouldReencrypt('plain'), true);
  assert.equal(service.shouldReencrypt(encrypted), false);

  assert.equal(service.shouldReencrypt('enc:v2:legacy'), true);
  assert.equal(service.shouldReencrypt('enc:v1:legacy'), true);
});

test('MessageCryptoService.encrypt validates required context fields', () => {
  const service = createService();

  assert.throws(
    () => service.encrypt('payload', 'server', { messageId: 'm1' }),
    /Encryption context missing required fields/
  );
});

test('MessageCryptoService.encrypt enforces plaintext size limit', () => {
  const service = createService();
  const ctx = buildServerContext();
  const tooLong = 'a'.repeat(4095);

  assert.throws(() => service.encrypt(tooLong, 'server', ctx), /Message exceeds encrypted payload size limit/);
});
