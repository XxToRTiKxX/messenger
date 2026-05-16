function createMessageSchemaModule({ query, DEFAULT_SERVER_ID, DEFAULT_CHANNEL_ID }) {
  async function migrateMessagesWorkspaceFields() {
    await query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS server_id UUID;');
    await query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel_id UUID;');

    await query('UPDATE messages SET server_id = $1 WHERE server_id IS NULL;', [DEFAULT_SERVER_ID]);
    await query('UPDATE messages SET channel_id = $1 WHERE channel_id IS NULL;', [DEFAULT_CHANNEL_ID]);

    await query('ALTER TABLE messages ALTER COLUMN server_id SET NOT NULL;');
    await query('ALTER TABLE messages ALTER COLUMN channel_id SET NOT NULL;');

    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_server_id_fkey') THEN
          ALTER TABLE messages
            ADD CONSTRAINT messages_server_id_fkey
            FOREIGN KEY (server_id)
            REFERENCES servers(id)
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_channel_id_fkey') THEN
          ALTER TABLE messages
            ADD CONSTRAINT messages_channel_id_fkey
            FOREIGN KEY (channel_id)
            REFERENCES channels(id)
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await query('CREATE INDEX IF NOT EXISTS idx_messages_server_channel_created_at ON messages(server_id, channel_id, created_at DESC);');
  }

  async function createDirectMessagesSchema() {
    await query(`
      CREATE TABLE IF NOT EXISTS direct_messages (
        id UUID PRIMARY KEY,
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await query('CREATE INDEX IF NOT EXISTS idx_direct_messages_pair_created_at ON direct_messages(sender_id, recipient_id, created_at DESC);');
    await query('CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient_created_at ON direct_messages(recipient_id, created_at DESC);');
  }

  async function migrateMessageLifecycleFields() {
    await query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;');
    await query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;');
    await query('ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;');
    await query('ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;');
    await query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;');
    await query('ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES direct_messages(id) ON DELETE SET NULL;');
    await query('CREATE INDEX IF NOT EXISTS idx_messages_reply_to_message_id ON messages(reply_to_message_id);');
    await query('CREATE INDEX IF NOT EXISTS idx_direct_messages_reply_to_message_id ON direct_messages(reply_to_message_id);');
  }

  async function createReactionsSchema() {
    await query(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_id, user_id, emoji)
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS direct_message_reactions (
        direct_message_id UUID NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (direct_message_id, user_id, emoji)
      );
    `);

    await query('CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions(message_id);');
    await query('CREATE INDEX IF NOT EXISTS idx_direct_message_reactions_message_id ON direct_message_reactions(direct_message_id);');
  }

  return {
    migrateMessagesWorkspaceFields,
    createDirectMessagesSchema,
    migrateMessageLifecycleFields,
    createReactionsSchema
  };
}

module.exports = createMessageSchemaModule;
