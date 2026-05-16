const { Pool } = require('pg');
const config = require('./config');
const logger = require('./utils/logger');
const createWorkspaceModule = require('./db-modules/workspace');
const createMessageSchemaModule = require('./db-modules/messages');
const { createMessageCrypto } = require('./server-modules/messageCrypto');

const databaseUrl = process.env.DATABASE_URL || 'postgresql://messenger:messenger@db:5432/messenger';

const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_CHANNEL_ID = '00000000-0000-0000-0000-000000000101';

const pool = new Pool({
  connectionString: databaseUrl
});

pool.on('error', (err) => {
  logger.error('PostgreSQL pool error', { error: err.message });
});

async function query(text, params = []) {
  return pool.query(text, params);
}

const workspace = createWorkspaceModule({ query, DEFAULT_SERVER_ID, DEFAULT_CHANNEL_ID });
const messageSchema = createMessageSchemaModule({ query, DEFAULT_SERVER_ID, DEFAULT_CHANNEL_ID });
const messageCrypto = createMessageCrypto(config, logger);

async function initDatabase() {
  await query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT UNIQUE,
      avatar TEXT,
      is_approved BOOLEAN NOT NULL DEFAULT TRUE,
      password_hash TEXT,
      registration_note TEXT,
      registration_status TEXT NOT NULL DEFAULT 'active',
      setup_token TEXT,
      setup_token_expires_at TIMESTAMPTZ,
      approval_token TEXT,
      approval_requested_at TIMESTAMPTZ,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS friendships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(requester_id, addressee_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS auth_identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(provider, provider_user_id)
    );
  `);

  await workspace.createWorkspaceSchema();

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS server_invites (
      id UUID PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      invite_type TEXT NOT NULL DEFAULT 'long_term',
      max_uses INTEGER NOT NULL DEFAULT 0,
      uses_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_server_invites_code ON server_invites(code);');
  await query('CREATE INDEX IF NOT EXISTS idx_server_invites_server ON server_invites(server_id, created_at DESC);');

  await workspace.ensureDefaultWorkspace();
  await messageSchema.migrateMessagesWorkspaceFields();
  await messageSchema.createDirectMessagesSchema();
  await messageSchema.migrateMessageLifecycleFields();
  await messageSchema.createReactionsSchema();

  await query(`
    CREATE TABLE IF NOT EXISTS media_files (
      id UUID PRIMARY KEY,
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
      channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      original_size BIGINT NOT NULL,
      compressed_size BIGINT NOT NULL,
      storage_path TEXT NOT NULL,
      encryption_iv BYTEA NOT NULL,
      encryption_tag BYTEA NOT NULL,
      encryption_algo TEXT NOT NULL DEFAULT 'aes-256-gcm',
      compression_algo TEXT NOT NULL DEFAULT 'gzip',
      is_committed BOOLEAN NOT NULL DEFAULT FALSE,
      committed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_id UUID REFERENCES media_files(id) ON DELETE SET NULL;');
  await query('ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS media_id UUID REFERENCES media_files(id) ON DELETE SET NULL;');
  await query('CREATE INDEX IF NOT EXISTS idx_media_files_server_channel ON media_files(server_id, channel_id, created_at DESC);');
  await query('CREATE INDEX IF NOT EXISTS idx_media_files_dm_context ON media_files(owner_user_id, peer_user_id, created_at DESC);');
  await query('CREATE INDEX IF NOT EXISTS idx_messages_media_id ON messages(media_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_direct_messages_media_id ON direct_messages(media_id);');

  if (config.message.migrateOnStart) {
    const migrated = await messageCrypto.migrateStoredMessages(query, { batchSize: 200 });
    if (migrated > 0) {
      logger.info('Message encryption migration completed', { migrated });
    }
  }

  logger.info('Database initialized');
}

async function waitForDatabase(maxAttempts = 30, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await query('SELECT 1');
      logger.info('Database connection established', { attempt });
      return;
    } catch (err) {
      logger.warn('Database not ready yet', { attempt, maxAttempts, error: err.message });
      if (attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = {
  pool,
  query,
  initDatabase,
  waitForDatabase,
  ensureDefaultWorkspaceForUser: workspace.ensureDefaultWorkspaceForUser,
  DEFAULT_SERVER_ID,
  DEFAULT_CHANNEL_ID
};
