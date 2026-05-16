const test = require('node:test');
const assert = require('node:assert/strict');

const { MessageMigrator } = require('../../backend/src/server-modules/messageCrypto');
const { buildServerContext, buildDmContext } = require('./helpers');

function createLogger() {
  const errors = [];
  return {
    errors,
    error: (...args) => errors.push(args),
    warn: () => {},
    info: () => {}
  };
}

test('MessageMigrator helper methods return expected values', () => {
  const migrator = new MessageMigrator({}, createLogger());

  assert.equal(migrator._determineMessageType('server', null), 'server_message');
  assert.equal(migrator._determineMessageType('server', '2026-01-01T00:00:00.000Z'), 'server_deleted');
  assert.equal(migrator._determineMessageType('dm', null), 'dm_message');
  assert.equal(migrator._determineMessageType('dm', '2026-01-01T00:00:00.000Z'), 'dm_deleted');

  const serverRow = {
    id: 'm1',
    userId: 'u1',
    serverId: 's1',
    channelId: 'c1',
    createdAt: '2026-01-01T00:00:00.000Z'
  };
  const dmRow = {
    id: 'd1',
    senderId: 'u1',
    recipientId: 'u2',
    createdAt: '2026-01-01T00:00:00.000Z'
  };

  const serverCtx = migrator._buildMessageContext('server', serverRow, 'server_message');
  const dmCtx = migrator._buildMessageContext('dm', dmRow, 'dm_message');

  assert.deepEqual(serverCtx, buildServerContext({
    messageId: 'm1',
    serverId: 's1',
    channelId: 'c1',
    userId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    type: 'server_message'
  }));

  assert.deepEqual(dmCtx, buildDmContext({
    messageId: 'd1',
    senderId: 'u1',
    recipientId: 'u2',
    createdAt: '2026-01-01T00:00:00.000Z',
    type: 'dm_message'
  }));

  assert.match(migrator._getSelectQuery('server'), /FROM messages/);
  assert.match(migrator._getSelectQuery('dm'), /FROM direct_messages/);
});

test('_tryMigrateOne logs and skips record when decrypt fails', async () => {
  const logger = createLogger();
  const cryptoService = {
    decrypt: () => {
      throw new Error('boom');
    },
    shouldReencrypt: () => true,
    encrypt: () => 'enc:v3:new'
  };
  const migrator = new MessageMigrator(cryptoService, logger);

  const queryCalls = [];
  const query = async (sql, params) => {
    queryCalls.push({ sql, params });
    return { rows: [] };
  };

  const result = await migrator._tryMigrateOne(
    {
      id: 'm1',
      userId: 'u1',
      serverId: 's1',
      channelId: 'c1',
      content: 'enc:v3:bad',
      createdAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null
    },
    'server',
    'messages',
    query
  );

  assert.equal(result, false);
  assert.equal(queryCalls.length, 0);
  assert.equal(logger.errors.length, 1);
});

test('_tryMigrateOne skips update when shouldReencrypt is false', async () => {
  const logger = createLogger();
  const cryptoService = {
    decrypt: () => 'plain',
    shouldReencrypt: () => false,
    encrypt: () => 'enc:v3:new'
  };
  const migrator = new MessageMigrator(cryptoService, logger);

  const queryCalls = [];
  const query = async (sql, params) => {
    queryCalls.push({ sql, params });
    return { rows: [] };
  };

  const result = await migrator._tryMigrateOne(
    {
      id: 'd1',
      senderId: 'u1',
      recipientId: 'u2',
      content: 'enc:v3:old',
      createdAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null
    },
    'dm',
    'direct_messages',
    query
  );

  assert.equal(result, false);
  assert.equal(queryCalls.length, 0);
});

test('_tryMigrateOne updates one record when re-encryption is required', async () => {
  const logger = createLogger();
  const cryptoService = {
    decrypt: () => 'plain',
    shouldReencrypt: () => true,
    encrypt: () => 'enc:v3:new'
  };
  const migrator = new MessageMigrator(cryptoService, logger);

  const queryCalls = [];
  const query = async (sql, params) => {
    queryCalls.push({ sql, params });
    return { rowCount: 1, rows: [] };
  };

  const result = await migrator._tryMigrateOne(
    {
      id: 'm9',
      userId: 'u1',
      serverId: 's1',
      channelId: 'c1',
      content: 'plain-legacy',
      createdAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null
    },
    'server',
    'messages',
    query
  );

  assert.equal(result, true);
  assert.equal(queryCalls.length, 1);
  assert.match(queryCalls[0].sql, /^UPDATE messages SET content = \$2 WHERE id = \$1$/);
  assert.deepEqual(queryCalls[0].params, ['m9', 'enc:v3:new']);
});

test('migrateStoredMessages paginates over both tables and sums migrated count', async () => {
  let serverPage = 0;
  let dmPage = 0;

  const cryptoService = {
    decrypt: () => 'plain',
    shouldReencrypt: (content) => content !== 'already-ok',
    encrypt: (content) => `enc:v3:${content}`
  };

  const migrator = new MessageMigrator(cryptoService, createLogger());
  const updates = [];

  const query = async (sql, params) => {
    if (sql.includes('FROM messages')) {
      serverPage += 1;
      if (serverPage === 1) {
        return {
          rows: [
            {
              id: 'm1',
              userId: 'u1',
              serverId: 's1',
              channelId: 'c1',
              content: 'plain-old1',
              createdAt: '2026-01-01T00:00:00.000Z',
              deletedAt: null
            },
            {
              id: 'm2',
              userId: 'u1',
              serverId: 's1',
              channelId: 'c1',
              content: 'already-ok',
              createdAt: '2026-01-01T00:00:01.000Z',
              deletedAt: null
            }
          ]
        };
      }
      return { rows: [] };
    }

    if (sql.includes('FROM direct_messages')) {
      dmPage += 1;
      if (dmPage === 1) {
        return {
          rows: [
            {
              id: 'd1',
              senderId: 'u1',
              recipientId: 'u2',
              content: 'plain-old2',
              createdAt: '2026-01-01T00:00:02.000Z',
              deletedAt: null
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

    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const migrated = await migrator.migrateStoredMessages(query, { batchSize: 2 });

  assert.equal(migrated, 2);
  assert.equal(updates.length, 2);
  assert.equal(serverPage, 2);
  assert.equal(dmPage, 2);
});
