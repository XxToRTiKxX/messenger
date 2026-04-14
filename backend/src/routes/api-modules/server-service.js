function createServerService({ query, uuidv4 }) {
  async function createServerWithDefaultChannel({ name, userId }) {
    const serverId = uuidv4();
    const defaultChannelId = uuidv4();

    await query('BEGIN');
    try {
      await query(
        `INSERT INTO servers (id, name, created_by)
         VALUES ($1, $2, $3)`,
        [serverId, name, userId]
      );

      await query(
        `INSERT INTO server_participants (server_id, user_id, role)
         VALUES ($1, $2, 'creator')`,
        [serverId, userId]
      );

      await query(
        `INSERT INTO channels (id, server_id, name, description, type, position, created_by)
         VALUES ($1, $2, 'general', 'Базовый канал', 'text', 0, $3)`,
        [defaultChannelId, serverId, userId]
      );

      await query(
        `INSERT INTO channel_participants (channel_id, user_id, role)
         VALUES ($1, $2, 'creator')`,
        [defaultChannelId, userId]
      );

      await query('COMMIT');
      return {
        id: serverId,
        name,
        role: 'creator',
        createdAt: new Date().toISOString()
      };
    } catch (err) {
      await query('ROLLBACK');
      throw err;
    }
  }

  async function createInvite({ serverId, userId, targetUserId, inviteType, maxUses, code }) {
    const inviteId = uuidv4();

    await query(
      `INSERT INTO server_invites (
         id, code, server_id, created_by, target_user_id, invite_type, max_uses, uses_count, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, NULL)`,
      [inviteId, code, serverId, userId, targetUserId, inviteType, maxUses]
    );

    return {
      inviteId,
      code,
      inviteType,
      oneTime: inviteType === 'one_time',
      targetUserId
    };
  }

  async function loadInviteByCode(code) {
    const result = await query(
      `SELECT si.id,
              si.code,
              si.server_id AS "serverId",
              s.name AS "serverName",
              si.target_user_id AS "targetUserId",
              si.invite_type AS "inviteType",
              si.max_uses AS "maxUses",
              si.uses_count AS "usesCount",
              si.expires_at AS "expiresAt"
       FROM server_invites si
       JOIN servers s ON s.id = si.server_id
       WHERE si.code = $1
       LIMIT 1`,
      [code]
    );
    return result.rows[0] || null;
  }

  async function acceptInvite({ code, userId }) {
    await query('BEGIN');
    try {
      const inviteResult = await query(
        `SELECT si.id,
                si.server_id AS "serverId",
                si.target_user_id AS "targetUserId",
                si.max_uses AS "maxUses",
                si.uses_count AS "usesCount",
                si.expires_at AS "expiresAt",
                s.name AS "serverName"
         FROM server_invites si
         JOIN servers s ON s.id = si.server_id
         WHERE si.code = $1
         FOR UPDATE`,
        [code]
      );

      const invite = inviteResult.rows[0] || null;
      if (!invite) {
        await query('ROLLBACK');
        return { error: 'not_found' };
      }

      if (invite.targetUserId && invite.targetUserId !== userId) {
        await query('ROLLBACK');
        return { error: 'wrong_user' };
      }

      if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) {
        await query('ROLLBACK');
        return { error: 'expired' };
      }

      if (invite.maxUses > 0 && invite.usesCount >= invite.maxUses) {
        await query('ROLLBACK');
        return { error: 'used' };
      }

      const memberResult = await query(
        `SELECT role
         FROM server_participants
         WHERE server_id = $1
           AND user_id = $2
         LIMIT 1`,
        [invite.serverId, userId]
      );

      const alreadyMember = !!memberResult.rows[0];

      if (!alreadyMember) {
        await query(
          `INSERT INTO server_participants (server_id, user_id, role)
           VALUES ($1, $2, 'member')`,
          [invite.serverId, userId]
        );

        await query(
          `INSERT INTO channel_participants (channel_id, user_id, role)
           SELECT c.id, $2, 'member'
           FROM channels c
           WHERE c.server_id = $1
           ON CONFLICT (channel_id, user_id) DO NOTHING`,
          [invite.serverId, userId]
        );
      }

      await query(
        `UPDATE server_invites
         SET uses_count = uses_count + 1
         WHERE id = $1`,
        [invite.id]
      );

      await query('COMMIT');

      return {
        error: null,
        alreadyMember,
        server: {
          id: invite.serverId,
          name: invite.serverName
        }
      };
    } catch (err) {
      await query('ROLLBACK');
      throw err;
    }
  }

  return {
    createServerWithDefaultChannel,
    createInvite,
    loadInviteByCode,
    acceptInvite
  };
}

module.exports = createServerService;
