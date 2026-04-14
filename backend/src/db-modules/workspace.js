function createWorkspaceModule({ query, DEFAULT_SERVER_ID, DEFAULT_CHANNEL_ID }) {
  async function createWorkspaceSchema() {
    await query(`
      CREATE TABLE IF NOT EXISTS servers (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS server_participants (
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (server_id, user_id)
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS channels (
        id UUID PRIMARY KEY,
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'text',
        position INTEGER NOT NULL DEFAULT 0,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (server_id, name)
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS channel_participants (
        channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (channel_id, user_id)
      );
    `);

    await query('CREATE INDEX IF NOT EXISTS idx_server_participants_user ON server_participants(user_id);');
    await query('CREATE INDEX IF NOT EXISTS idx_channels_server_position ON channels(server_id, position, created_at);');
    await query('CREATE INDEX IF NOT EXISTS idx_channel_participants_user ON channel_participants(user_id);');
  }

  async function ensureDefaultWorkspace() {
    await query(
      `INSERT INTO servers (id, name, created_by)
       VALUES ($1, 'Main Server', NULL)
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_SERVER_ID]
    );

    await query(
      `INSERT INTO channels (id, server_id, name, description, type, position, created_by)
       VALUES ($1, $2, 'general', 'Базовый канал сервера', 'text', 0, NULL)
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_CHANNEL_ID, DEFAULT_SERVER_ID]
    );

    await query(
      `INSERT INTO server_participants (server_id, user_id, role)
       SELECT $1, u.id, 'member'
       FROM users u
       ON CONFLICT (server_id, user_id) DO NOTHING`,
      [DEFAULT_SERVER_ID]
    );

    await query(
      `INSERT INTO channel_participants (channel_id, user_id, role)
       SELECT $1, u.id, 'member'
       FROM users u
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [DEFAULT_CHANNEL_ID]
    );
  }

  async function ensureDefaultWorkspaceForUser(userId) {
    if (!userId) return;
    await ensureDefaultWorkspace();

    await query(
      `INSERT INTO server_participants (server_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (server_id, user_id) DO NOTHING`,
      [DEFAULT_SERVER_ID, userId]
    );

    await query(
      `INSERT INTO channel_participants (channel_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [DEFAULT_CHANNEL_ID, userId]
    );
  }

  return {
    createWorkspaceSchema,
    ensureDefaultWorkspace,
    ensureDefaultWorkspaceForUser
  };
}

module.exports = createWorkspaceModule;
