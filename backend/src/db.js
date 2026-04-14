const { Pool } = require('pg');
const logger = require('./utils/logger');
const createWorkspaceModule = require('./db-modules/workspace');
const createMessageSchemaModule = require('./db-modules/messages');

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
