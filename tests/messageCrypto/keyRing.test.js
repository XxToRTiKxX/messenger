const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { KeyRing } = require('../../backend/src/server-modules/messageCrypto');

function createLoggerMock() {
  return { warn: () => {}, info: () => {}, error: () => {} };
}

test('KeyRing parses valid entries and exposes lookup helpers', () => {
  const keyA = Buffer.alloc(32, 1).toString('base64');
  const keyB = Buffer.alloc(32, 2).toString('base64');
  const keyRing = new KeyRing(`k1:${keyA},k2:${keyB}`, createLoggerMock());

  assert.equal(keyRing.has('k1'), true);
  assert.equal(keyRing.has('k2'), true);
  assert.equal(keyRing.has('missing'), false);

  keyRing.setActiveKeyId('k2');
  assert.equal(keyRing.getActiveKeyId(), 'k2');
  assert.equal(keyRing.getActive().encKey.equals(Buffer.alloc(32, 2)), true);
});

test('KeyRing throws for unknown active key', () => {
  const keyA = Buffer.alloc(32, 1).toString('base64');
  const keyRing = new KeyRing(`k1:${keyA}`, createLoggerMock());

  assert.throws(() => keyRing.setActiveKeyId('kX'), /Active key "kX" not found in keyring/);
});

test('KeyRing falls back to SHA-256 for non-base64 key material', () => {
  const raw = 'not-a-valid-base64-key';
  const keyRing = new KeyRing(`legacy:${raw}`, createLoggerMock());
  const parsed = keyRing.get('legacy');
  const expected = crypto.createHash('sha256').update(raw, 'utf8').digest();

  assert.ok(parsed);
  assert.equal(parsed.encKey.equals(expected), true);
});

test('KeyRing ignores malformed keyring entries', () => {
  const keyA = Buffer.alloc(32, 9).toString('base64');
  const keyRing = new KeyRing(`badEntry, :${keyA}, k1: , k2:${keyA}`, createLoggerMock());

  assert.equal(keyRing.has('k1'), false);
  assert.equal(keyRing.has('k2'), true);
});
