const createReactionHelpers = require('./reactions');

function registerMessageRoutes(router, deps) {
  const { authenticateToken, query, logger, shared, uuidv4, broadcastMessage, defaults } = deps;
  const { ensureUserHasServerAccess, areUsersFriends } = shared;
  const { DEFAULT_SERVER_ID, DEFAULT_CHANNEL_ID } = defaults;
  const { loadMessageReactionsByIds, enrichMessagesWithReactions } = createReactionHelpers(query);
  const DELETED_CONTENT = 'deleted';

  const readEmoji = (raw) => String(raw || '').trim().slice(0, 24);

  router.get('/messages', authenticateToken, async (req, res) => {
    const serverId = String(req.query?.serverId || DEFAULT_SERVER_ID);
    const channelId = String(req.query?.channelId || DEFAULT_CHANNEL_ID);

    try {
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }

      const channelCheck = await query(
        `SELECT id
         FROM channels
         WHERE id = $1 AND server_id = $2
         LIMIT 1`,
        [channelId, serverId]
      );

      if (!channelCheck.rows[0]) {
        return res.status(404).json({ error: 'Channel not found in server' });
      }

      const result = await query(
        `SELECT m.id,
                m.user_id AS "userId",
                u.username,
                m.server_id AS "serverId",
                m.channel_id AS "channelId",
                m.content,
                m.created_at AS "timestamp",
                m.edited_at AS "editedAt",
                m.deleted_at AS "deletedAt"
         FROM messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.server_id = $1
           AND m.channel_id = $2
         ORDER BY m.created_at DESC
         LIMIT 100`,
        [serverId, channelId]
      );

      const messages = await enrichMessagesWithReactions(result.rows.reverse(), loadMessageReactionsByIds);
      return res.json(messages);
    } catch (err) {
      logger.error('Messages fetch failed', {
        error: err.message,
        userId: req.user.userId,
        serverId,
        channelId
      });
      return res.status(500).json({ error: 'Failed to load messages' });
    }
  });

  router.post('/messages', authenticateToken, async (req, res) => {
    const { content } = req.body || {};
    const serverId = String(req.body?.serverId || DEFAULT_SERVER_ID);
    const channelId = String(req.body?.channelId || DEFAULT_CHANNEL_ID);

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content required' });
    }
    if (content.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 chars)' });
    }

    try {
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }

      const channelCheck = await query(
        `SELECT id
         FROM channels
         WHERE id = $1 AND server_id = $2
         LIMIT 1`,
        [channelId, serverId]
      );

      if (!channelCheck.rows[0]) {
        return res.status(404).json({ error: 'Channel not found in server' });
      }

      const userResult = await query(
        'SELECT username FROM users WHERE id = $1 LIMIT 1',
        [req.user.userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const messageId = uuidv4();
      const inserted = await query(
        `INSERT INTO messages (id, user_id, server_id, channel_id, content)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id,
                   user_id AS "userId",
                   server_id AS "serverId",
                   channel_id AS "channelId",
                   content,
                   created_at AS "timestamp",
                   edited_at AS "editedAt",
                   deleted_at AS "deletedAt"`,
        [messageId, req.user.userId, serverId, channelId, content.trim()]
      );

      const message = {
        ...inserted.rows[0],
        username: userResult.rows[0].username,
        reactions: []
      };

      broadcastMessage({ type: 'new_message', message });
      return res.json({ success: true, message });
    } catch (err) {
      logger.error('Message save failed', {
        error: err.message,
        userId: req.user.userId,
        serverId,
        channelId
      });
      return res.status(500).json({ error: 'Failed to save message' });
    }
  });

  router.patch('/messages/:messageId', authenticateToken, async (req, res) => {
    const messageId = String(req.params.messageId || '').trim();
    const content = String(req.body?.content || '').trim();

    if (!messageId) {
      return res.status(400).json({ error: 'Message id required' });
    }
    if (!content) {
      return res.status(400).json({ error: 'Message content required' });
    }
    if (content.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 chars)' });
    }

    try {
      const existing = await query(
        `SELECT m.id,
                m.user_id AS "userId",
                m.server_id AS "serverId",
                m.channel_id AS "channelId",
                m.deleted_at AS "deletedAt",
                u.username
         FROM messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.id = $1
         LIMIT 1`,
        [messageId]
      );

      const target = existing.rows[0];
      if (!target) {
        return res.status(404).json({ error: 'Message not found' });
      }
      const serverRole = await ensureUserHasServerAccess(target.serverId, req.user.userId);
      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }
      if (target.userId !== req.user.userId) {
        return res.status(403).json({ error: 'Cannot edit this message' });
      }
      if (target.deletedAt) {
        return res.status(409).json({ error: 'Deleted messages cannot be edited' });
      }

      const updated = await query(
        `UPDATE messages
         SET content = $2,
             edited_at = NOW()
         WHERE id = $1
         RETURNING id,
                   user_id AS "userId",
                   server_id AS "serverId",
                   channel_id AS "channelId",
                   content,
                   created_at AS "timestamp",
                   edited_at AS "editedAt",
                   deleted_at AS "deletedAt"`,
        [messageId, content]
      );

      const messageBase = {
        ...updated.rows[0],
        username: target.username
      };
      const [message] = await enrichMessagesWithReactions([messageBase], loadMessageReactionsByIds);

      broadcastMessage({ type: 'message_updated', message });
      return res.json({ success: true, message });
    } catch (err) {
      logger.error('Message edit failed', {
        error: err.message,
        userId: req.user.userId,
        messageId
      });
      return res.status(500).json({ error: 'Failed to edit message' });
    }
  });

  router.delete('/messages/:messageId', authenticateToken, async (req, res) => {
    const messageId = String(req.params.messageId || '').trim();
    if (!messageId) {
      return res.status(400).json({ error: 'Message id required' });
    }

    try {
      const existing = await query(
        `SELECT m.id,
                m.user_id AS "userId",
                m.server_id AS "serverId",
                m.channel_id AS "channelId",
                u.username
         FROM messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.id = $1
         LIMIT 1`,
        [messageId]
      );

      const target = existing.rows[0];
      if (!target) {
        return res.status(404).json({ error: 'Message not found' });
      }
      const serverRole = await ensureUserHasServerAccess(target.serverId, req.user.userId);
      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }
      if (target.userId !== req.user.userId) {
        return res.status(403).json({ error: 'Cannot delete this message' });
      }

      const deleted = await query(
        `UPDATE messages
         SET content = $2,
             deleted_at = NOW()
         WHERE id = $1
         RETURNING id,
                   user_id AS "userId",
                   server_id AS "serverId",
                   channel_id AS "channelId",
                   content,
                   created_at AS "timestamp",
                   edited_at AS "editedAt",
                   deleted_at AS "deletedAt"`,
        [messageId, DELETED_CONTENT]
      );

      const messageBase = {
        ...deleted.rows[0],
        username: target.username
      };
      const [message] = await enrichMessagesWithReactions([messageBase], loadMessageReactionsByIds);

      broadcastMessage({ type: 'message_deleted', message });
      return res.json({ success: true, message });
    } catch (err) {
      logger.error('Message delete failed', {
        error: err.message,
        userId: req.user.userId,
        messageId
      });
      return res.status(500).json({ error: 'Failed to delete message' });
    }
  });

  router.put('/messages/:messageId/reactions', authenticateToken, async (req, res) => {
    const messageId = String(req.params.messageId || '').trim();
    const emoji = readEmoji(req.body?.emoji);
    if (!messageId) {
      return res.status(400).json({ error: 'Message id required' });
    }
    if (!emoji) {
      return res.status(400).json({ error: 'Emoji required' });
    }

    try {
      const targetResult = await query(
        `SELECT id,
                server_id AS "serverId",
                channel_id AS "channelId",
                deleted_at AS "deletedAt"
         FROM messages
         WHERE id = $1
         LIMIT 1`,
        [messageId]
      );
      const target = targetResult.rows[0];
      if (!target) {
        return res.status(404).json({ error: 'Message not found' });
      }
      const serverRole = await ensureUserHasServerAccess(target.serverId, req.user.userId);
      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }
      if (target.deletedAt) {
        return res.status(409).json({ error: 'Deleted messages cannot be reacted to' });
      }

      const inserted = await query(
        `INSERT INTO message_reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING message_id`,
        [messageId, req.user.userId, emoji]
      );

      if (!inserted.rows[0]) {
        await query(
          `DELETE FROM message_reactions
           WHERE message_id = $1
             AND user_id = $2
             AND emoji = $3`,
          [messageId, req.user.userId, emoji]
        );
      }

      const reactionRows = await query(
        `SELECT emoji,
                ARRAY_AGG(user_id::text ORDER BY user_id) AS "userIds"
         FROM message_reactions
         WHERE message_id = $1
         GROUP BY emoji`,
        [messageId]
      );

      const reactions = reactionRows.rows.map((row) => ({ emoji: row.emoji, userIds: row.userIds }));

      broadcastMessage({
        type: 'message_reactions_updated',
        messageId,
        serverId: target.serverId,
        channelId: target.channelId,
        reactions
      });

      return res.json({ success: true, reactions });
    } catch (err) {
      logger.error('Message reaction toggle failed', {
        error: err.message,
        userId: req.user.userId,
        messageId
      });
      return res.status(500).json({ error: 'Failed to update reaction' });
    }
  });

  router.get('/message-links/:messageId', authenticateToken, async (req, res) => {
    const messageId = String(req.params.messageId || '').trim();
    if (!messageId) {
      return res.status(400).json({ error: 'Message id required' });
    }

    try {
      const userId = req.user.userId;
      const serverMessage = await query(
        `SELECT m.id,
                m.server_id AS "serverId",
                m.channel_id AS "channelId",
                s.name AS "serverName",
                c.name AS "channelName"
         FROM messages m
         JOIN servers s ON s.id = m.server_id
         JOIN channels c ON c.id = m.channel_id
         WHERE m.id = $1
         LIMIT 1`,
        [messageId]
      );

      if (serverMessage.rows[0]) {
        const target = serverMessage.rows[0];
        const role = await ensureUserHasServerAccess(target.serverId, userId);
        if (!role) {
          return res.status(404).json({ error: 'Message not found' });
        }

        return res.json({
          messageId,
          kind: 'server',
          serverId: target.serverId,
          channelId: target.channelId,
          serverName: target.serverName,
          channelName: target.channelName
        });
      }

      const dmMessage = await query(
        `SELECT id,
                sender_id AS "senderId",
                recipient_id AS "recipientId"
         FROM direct_messages
         WHERE id = $1
           AND (sender_id = $2 OR recipient_id = $2)
         LIMIT 1`,
        [messageId, userId]
      );

      if (!dmMessage.rows[0]) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const target = dmMessage.rows[0];
      const friendUserId = target.senderId === userId ? target.recipientId : target.senderId;
      const isFriend = await areUsersFriends(userId, friendUserId);
      if (!isFriend) {
        return res.status(404).json({ error: 'Message not found' });
      }

      return res.json({
        messageId,
        kind: 'friend',
        friendUserId
      });
    } catch (err) {
      logger.error('Message link resolve failed', {
        error: err.message,
        userId: req.user.userId,
        messageId
      });
      return res.status(500).json({ error: 'Failed to resolve message link' });
    }
  });
}

module.exports = registerMessageRoutes;
