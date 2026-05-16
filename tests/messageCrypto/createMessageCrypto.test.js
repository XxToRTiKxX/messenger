const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMessageCrypto,
  DecryptionError
} = require('../../backend/src/server-modules/messageCrypto');
const {
  createConfig,
  createLoggerMock,
  buildServerContext,
  buildDmContext,
  TEST_KEY_ID
} = require('./helpers');

test('createMessageCrypto throws when active key is missing', () => {
  assert.throws(
    () => createMessageCrypto({ message: { encryptionKeys: '', activeKeyId: '' } }, createLoggerMock()),
    /Message encryption active key is not configured/
  );
});

test('createMessageCrypto exposes backward-compatible API', () => {
  const messageCrypto = createMessageCrypto(createConfig(), createLoggerMock());

  assert.equal(typeof messageCrypto.encryptContent, 'function');
  assert.equal(typeof messageCrypto.decryptContent, 'function');
  assert.equal(typeof messageCrypto.shouldReencrypt, 'function');
  assert.equal(typeof messageCrypto.migrateStoredMessages, 'function');
  assert.equal(messageCrypto.DecryptionError, DecryptionError);
});

test('encryptContent/decryptContent roundtrip for server scope', () => {
  const messageCrypto = createMessageCrypto(createConfig(), createLoggerMock());
  const context = buildServerContext();

  const encrypted = messageCrypto.encryptContent('hello server', 'server', context);
  const decrypted = messageCrypto.decryptContent(encrypted, 'server', context);

  assert.match(encrypted, /^enc:v3:/);
  assert.equal(decrypted, 'hello server');
});

test('encryptContent/decryptContent roundtrip for dm scope', () => {
  const messageCrypto = createMessageCrypto(createConfig(), createLoggerMock());
  const context = buildDmContext();

  const encrypted = messageCrypto.encryptContent('hello dm', 'dm', context);
  const decrypted = messageCrypto.decryptContent(encrypted, 'dm', context);

  assert.match(encrypted, /^enc:v3:/);
  assert.equal(decrypted, 'hello dm');
});

test('encryptContent requires type and createdAt in context', () => {
  const messageCrypto = createMessageCrypto(createConfig(), createLoggerMock());

  assert.throws(
    () => messageCrypto.encryptContent('x', 'server', { messageId: 'm1' }),
    /Encryption context missing required fields/
  );
});

test('decryptContent returns raw value for non-encrypted payload', () => {
  const messageCrypto = createMessageCrypto(createConfig(), createLoggerMock());

  assert.equal(messageCrypto.decryptContent('plain-text', 'server', buildServerContext()), 'plain-text');
});

test('decryptContent throws DecryptionError for legacy v1/v2 envelopes', () => {
  const messageCrypto = createMessageCrypto(createConfig(), createLoggerMock());
  const context = buildServerContext();

  assert.throws(
    () => messageCrypto.decryptContent(`enc:v1:${TEST_KEY_ID}:stub`, 'server', context),
    (error) => error instanceof DecryptionError && error.code === 'DECRYPTION_FAILED'
  );
  assert.throws(
    () => messageCrypto.decryptContent(`enc:v2:${TEST_KEY_ID}:stub`, 'server', context),
    (error) => error instanceof DecryptionError && error.code === 'DECRYPTION_FAILED'
  );
});

test('decryptContent throws DecryptionError when MAC is invalid', () => {
  const messageCrypto = createMessageCrypto(createConfig(), createLoggerMock());
  const context = buildServerContext();

  const encrypted = messageCrypto.encryptContent('tamper-me', 'server', context);
  const parts = encrypted.split(':');
  parts[6] = parts[6].slice(0, -2) + 'aa';
  const tampered = parts.join(':');

  assert.throws(
    () => messageCrypto.decryptContent(tampered, 'server', context),
    (error) => error instanceof DecryptionError && error.code === 'DECRYPTION_FAILED'
  );
});

test('shouldReencrypt behavior for plain and v3 envelope', () => {
  const messageCrypto = createMessageCrypto(createConfig(), createLoggerMock());
  const context = buildDmContext();

  const encrypted = messageCrypto.encryptContent('payload', 'dm', context);
  assert.equal(messageCrypto.shouldReencrypt('plain'), true);
  assert.equal(messageCrypto.shouldReencrypt(encrypted), false);

  assert.equal(messageCrypto.shouldReencrypt('enc:v2:test'), true);
  assert.equal(messageCrypto.shouldReencrypt('enc:v1:test'), true);
});

test('migrateStoredMessages updates only records that need re-encryption', async () => {
  const messageCrypto = createMessageCrypto(createConfig(), createLoggerMock());

  const serverContext = buildServerContext({
    messageId: 'm1',
    createdAt: '2026-01-01T01:00:00.000Z',
    type: 'server_message'
  });
  const dmContext = buildDmContext({
    messageId: 'd1',
    createdAt: '2026-01-01T02:00:00.000Z',
    type: 'dm_deleted'
  });

  const activeServerEncrypted = messageCrypto.encryptContent('already-active', 'server', serverContext);
  const legacyDmEncrypted = 'plain-legacy-dm';

  const updates = [];
  const query = async (sql, params) => {
    if (sql.includes('FROM messages')) {
      const offset = params[1];
      if (offset === 0) {
        return {
          rows: [
            {
              id: 'm1',
              userId: serverContext.userId,
              serverId: serverContext.serverId,
              channelId: serverContext.channelId,
              content: activeServerEncrypted,
              createdAt: serverContext.createdAt,
              deletedAt: null
            }
          ]
        };
      }
      return { rows: [] };
    }

    if (sql.includes('FROM direct_messages')) {
      const offset = params[1];
      if (offset === 0) {
        return {
          rows: [
            {
              id: 'd1',
              senderId: dmContext.senderId,
              recipientId: dmContext.recipientId,
              content: legacyDmEncrypted,
              createdAt: dmContext.createdAt,
              deletedAt: '2026-01-01T03:00:00.000Z'
            }
          ]
        };
      }
      return { rows: [] };
    }

    if (sql.startsWith('UPDATE')) {
      updates.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  const migrated = await messageCrypto.migrateStoredMessages(query, createLoggerMock(), { batchSize: 1 });

  assert.equal(migrated, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].params[0], 'd1');
  assert.match(updates[0].params[1], /^enc:v3:/);
});
