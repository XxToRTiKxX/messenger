const test = require('node:test');
const assert = require('node:assert/strict');

const createMessageSchemaModule = require('../../backend/src/db-modules/messages');

function createQueryRecorder() {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 0 };
  };
  return { query, calls };
}

test('migrateMessagesWorkspaceFields runs expected migration steps', async () => {
  const { query, calls } = createQueryRecorder();
  const module = createMessageSchemaModule({
    query,
    DEFAULT_SERVER_ID: 'server-default',
    DEFAULT_CHANNEL_ID: 'channel-default'
  });

  await module.migrateMessagesWorkspaceFields();

  assert.equal(calls.length, 9);
  assert.match(calls[0].sql, /ALTER TABLE messages ADD COLUMN IF NOT EXISTS server_id/);
  assert.match(calls[1].sql, /ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel_id/);
  assert.deepEqual(calls[2].params, ['server-default']);
  assert.deepEqual(calls[3].params, ['channel-default']);
  assert.match(calls[8].sql, /CREATE INDEX IF NOT EXISTS idx_messages_server_channel_created_at/);
});

test('createDirectMessagesSchema creates table and both indexes', async () => {
  const { query, calls } = createQueryRecorder();
  const module = createMessageSchemaModule({ query, DEFAULT_SERVER_ID: 's', DEFAULT_CHANNEL_ID: 'c' });

  await module.createDirectMessagesSchema();

  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS direct_messages/);
  assert.match(calls[1].sql, /idx_direct_messages_pair_created_at/);
  assert.match(calls[2].sql, /idx_direct_messages_recipient_created_at/);
});

test('migrateMessageLifecycleFields adds edited_at and deleted_at columns to both tables', async () => {
  const { query, calls } = createQueryRecorder();
  const module = createMessageSchemaModule({ query, DEFAULT_SERVER_ID: 's', DEFAULT_CHANNEL_ID: 'c' });

  await module.migrateMessageLifecycleFields();

  assert.equal(calls.length, 4);
  assert.match(calls[0].sql, /ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at/);
  assert.match(calls[1].sql, /ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at/);
  assert.match(calls[2].sql, /ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS edited_at/);
  assert.match(calls[3].sql, /ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS deleted_at/);
});

test('createReactionsSchema creates reactions tables and indexes', async () => {
  const { query, calls } = createQueryRecorder();
  const module = createMessageSchemaModule({ query, DEFAULT_SERVER_ID: 's', DEFAULT_CHANNEL_ID: 'c' });

  await module.createReactionsSchema();

  assert.equal(calls.length, 4);
  assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS message_reactions/);
  assert.match(calls[1].sql, /CREATE TABLE IF NOT EXISTS direct_message_reactions/);
  assert.match(calls[2].sql, /idx_message_reactions_message_id/);
  assert.match(calls[3].sql, /idx_direct_message_reactions_message_id/);
});
