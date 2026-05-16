const createReactionHelpers = require('./reactions');

function registerMessageRoutes(router, deps) {
  const { authenticateToken, query, logger, shared, uuidv4, broadcastMessage, defaults, messageCrypto } = deps;
  const { ensureUserHasServerAccess, areUsersFriends } = shared;
  const { DEFAULT_SERVER_ID, DEFAULT_CHANNEL_ID } = defaults;
  const { loadMessageReactionsByIds, enrichMessagesWithReactions } = createReactionHelpers(query);
  const DELETED_CONTENT = 'deleted';
  const decryptReplyPreview = (row) => {
    const replyId = row?.replyToMessageId;
    if (!replyId) return null;
    try {
      const decrypted = messageCrypto.decryptContent(row.replyToContent || '', 'server', {
        messageId: replyId,
        serverId: row.replyToServerId,
        channelId: row.replyToChannelId,
        userId: row.replyToUserId,
        createdAt: row.replyToCreatedAt,
        type: row.replyToDeletedAt ? 'server_deleted' : 'server_message'
      });
      return {
        id: replyId,
        username: row.replyToUsername || 'Unknown',
        content: String(decrypted || '').slice(0, 220)
      };
    } catch {
      return {
        id: replyId,
        username: row.replyToUsername || 'Unknown',
        content: '[message unavailable]'
      };
    }
  };
  const decryptServerMessage = (row) => {
    try {
      return {
        ...row,
        media: mapMedia(row),
        replyTo: decryptReplyPreview(row),
        content: messageCrypto.decryptContent(row.content, 'server', {
          messageId: row.id,
          serverId: row.serverId,
          channelId: row.channelId,
          userId: row.userId,
          createdAt: row.timestamp,
          type: row.deletedAt ? 'server_deleted' : 'server_message'
        })
      };
    } catch (error) {
      logger.warn('Message decryption failed, returning placeholder', {
        messageId: row?.id || null,
        serverId: row?.serverId || null,
        channelId: row?.channelId || null,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        ...row,
        media: mapMedia(row),
        replyTo: decryptReplyPreview(row),
        content: '[message unavailable]'
      };
    }
  };
  const mapMedia = (row) => {
    if (!row?.mediaId) return null;
    return {
      id: row.mediaId,
      fileName: row.mediaName,
      mimeType: row.mediaMimeType,
      sizeBytes: Number(row.mediaSize || 0),
      url: `/api/media/${row.mediaId}`
    };
  };

  const readEmoji = (raw) => String(raw || '').trim().slice(0, 24);
  const loadReplyPreviewByMessageId = async (messageId) => {
    const result = await query(
      `SELECT rm.id AS "replyToMessageId",
              rm.content AS "replyToContent",
              rm.server_id AS "replyToServerId",
              rm.channel_id AS "replyToChannelId",
              rm.user_id AS "replyToUserId",
              rm.created_at AS "replyToCreatedAt",
              rm.deleted_at AS "replyToDeletedAt",
              ru.username AS "replyToUsername"
       FROM messages m
       LEFT JOIN messages rm ON rm.id = m.reply_to_message_id
       LEFT JOIN users ru ON ru.id = rm.user_id
       WHERE m.id = $1
       LIMIT 1`,
      [messageId]
    );
    return decryptReplyPreview(result.rows[0] || {});
  };

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
                m.media_id AS "mediaId",
                mf.original_name AS "mediaName",
                mf.mime_type AS "mediaMimeType",
                mf.original_size AS "mediaSize",
                rm.id AS "replyToMessageId",
                rm.content AS "replyToContent",
                rm.server_id AS "replyToServerId",
                rm.channel_id AS "replyToChannelId",
                rm.user_id AS "replyToUserId",
                rm.created_at AS "replyToCreatedAt",
                rm.deleted_at AS "replyToDeletedAt",
                ru.username AS "replyToUsername",
                m.created_at AS "timestamp",
                m.edited_at AS "editedAt",
                m.deleted_at AS "deletedAt"
         FROM messages m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN media_files mf ON mf.id = m.media_id
         LEFT JOIN messages rm ON rm.id = m.reply_to_message_id
         LEFT JOIN users ru ON ru.id = rm.user_id
         WHERE m.server_id = $1
           AND m.channel_id = $2
         ORDER BY m.created_at DESC
         LIMIT 100`,
        [serverId, channelId]
      );

      const decryptedRows = result.rows.reverse().map(decryptServerMessage);
      const messages = await enrichMessagesWithReactions(decryptedRows, loadMessageReactionsByIds);
      return res.json(messages);
    } catch (err) {
      logger.error('Messages fetch failed', {
        error: err.message,
        userId: req.user.userId,
        serverId,
        channelId
      });
      if (err && err.code === 'DECRYPTION_FAILED') {
        logger.warn('Messages fetch fallback to empty list due to decryption failure', {
          userId: req.user.userId,
          serverId,
          channelId
        });
        return res.json([]);
      }
      return res.status(500).json({ error: 'Failed to load messages' });
    }
  });

  router.post('/messages', authenticateToken, async (req, res) => {
    const content = String(req.body?.content || '').trim();
    const mediaId = String(req.body?.mediaId || '').trim() || null;
    const replyToMessageId = String(req.body?.replyToMessageId || '').trim() || null;
    const serverId = String(req.body?.serverId || DEFAULT_SERVER_ID);
    const channelId = String(req.body?.channelId || DEFAULT_CHANNEL_ID);

    if (!content && !mediaId) {
      return res.status(400).json({ error: 'Message content or media required' });
    }
    if (content.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 chars)' });
    }

    try {
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }
      if (serverId === DEFAULT_SERVER_ID && channelId === DEFAULT_CHANNEL_ID && !['creator', 'admin'].includes(serverRole)) {
        return res.status(403).json({ error: 'Этот канал доступен только для чтения' });
      }
      if (serverId === DEFAULT_SERVER_ID && channelId === DEFAULT_CHANNEL_ID && replyToMessageId) {
        return res.status(403).json({ error: 'Ответы отключены в этом канале' });
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

      let media = null;
      if (mediaId) {
        const mediaCheck = await query(
          `SELECT id AS "mediaId",
                  original_name AS "mediaName",
                  mime_type AS "mediaMimeType",
                  original_size AS "mediaSize"
           FROM media_files
           WHERE id = $1
             AND owner_user_id = $2
             AND server_id = $3
             AND channel_id = $4
             AND is_committed = FALSE
           LIMIT 1`,
          [mediaId, req.user.userId, serverId, channelId]
        );
        media = mapMedia(mediaCheck.rows[0]);
        if (!media) {
          return res.status(400).json({ error: 'Invalid media reference for message' });
        }
      }

      let replyTarget = null;
      if (replyToMessageId) {
        const replyCheck = await query(
          `SELECT m.id,
                  m.server_id AS "serverId",
                  m.channel_id AS "channelId",
                  m.user_id AS "userId",
                  m.content,
                  m.created_at AS "timestamp",
                  m.deleted_at AS "deletedAt",
                  u.username
           FROM messages m
           JOIN users u ON u.id = m.user_id
           WHERE m.id = $1
             AND m.server_id = $2
             AND m.channel_id = $3
           LIMIT 1`,
          [replyToMessageId, serverId, channelId]
        );
        replyTarget = replyCheck.rows[0] || null;
        if (!replyTarget) {
          return res.status(400).json({ error: 'Reply target not found in this channel' });
        }
      }

      const messageId = uuidv4();
      const createdAt = new Date().toISOString();
      const encryptedContent = messageCrypto.encryptContent(content, 'server', {
        messageId,
        serverId,
        channelId,
        userId: req.user.userId,
        createdAt,
        type: 'server_message'
      });

      const inserted = await query(
        `INSERT INTO messages (id, user_id, server_id, channel_id, content, media_id, reply_to_message_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id,
                   user_id AS "userId",
                   server_id AS "serverId",
                   channel_id AS "channelId",
                   content,
                   media_id AS "mediaId",
                   reply_to_message_id AS "replyToMessageId",
                   created_at AS "timestamp",
                   edited_at AS "editedAt",
                   deleted_at AS "deletedAt"`,
        [messageId, req.user.userId, serverId, channelId, encryptedContent, mediaId, replyToMessageId, createdAt]
      );

      if (mediaId) {
        await query(
          `UPDATE media_files
           SET is_committed = TRUE,
               committed_at = NOW()
           WHERE id = $1`,
          [mediaId]
        );
      }

      let replyPreview = null;
      if (replyTarget) {
        try {
          replyPreview = {
            id: replyTarget.id,
            username: replyTarget.username,
            content: String(
              messageCrypto.decryptContent(replyTarget.content, 'server', {
                messageId: replyTarget.id,
                serverId: replyTarget.serverId,
                channelId: replyTarget.channelId,
                userId: replyTarget.userId,
                createdAt: replyTarget.timestamp,
                type: replyTarget.deletedAt ? 'server_deleted' : 'server_message'
              })
            ).slice(0, 220)
          };
        } catch {
          replyPreview = {
            id: replyTarget.id,
            username: replyTarget.username,
            content: '[message unavailable]'
          };
        }
      }

      const message = {
        ...decryptServerMessage(inserted.rows[0]),
        username: userResult.rows[0].username,
        replyTo: replyPreview,
        media,
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
                m.created_at AS "timestamp",
                m.media_id AS "mediaId",
                mf.original_name AS "mediaName",
                mf.mime_type AS "mediaMimeType",
                mf.original_size AS "mediaSize",
                u.username
         FROM messages m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN media_files mf ON mf.id = m.media_id
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

      const encryptedContent = messageCrypto.encryptContent(content, 'server', {
        messageId,
        serverId: target.serverId,
        channelId: target.channelId,
        userId: target.userId,
        createdAt: target.timestamp,
        type: 'server_message'
      });

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
                   media_id AS "mediaId",
                   created_at AS "timestamp",
                   edited_at AS "editedAt",
                   deleted_at AS "deletedAt"`,
        [messageId, encryptedContent]
      );

      const messageBase = {
        ...decryptServerMessage(updated.rows[0]),
        username: target.username,
        media: mapMedia(target),
        replyTo: await loadReplyPreviewByMessageId(messageId)
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
                m.created_at AS "timestamp",
                m.media_id AS "mediaId",
                mf.original_name AS "mediaName",
                mf.mime_type AS "mediaMimeType",
                mf.original_size AS "mediaSize",
                u.username
         FROM messages m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN media_files mf ON mf.id = m.media_id
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

      const encryptedDeletedContent = messageCrypto.encryptContent(DELETED_CONTENT, 'server', {
        messageId,
        serverId: target.serverId,
        channelId: target.channelId,
        userId: target.userId,
        createdAt: target.timestamp,
        type: 'server_deleted'
      });

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
                   media_id AS "mediaId",
                   created_at AS "timestamp",
                   edited_at AS "editedAt",
                   deleted_at AS "deletedAt"`,
        [messageId, encryptedDeletedContent]
      );

      const messageBase = {
        ...decryptServerMessage(deleted.rows[0]),
        username: target.username,
        media: mapMedia(target),
        replyTo: await loadReplyPreviewByMessageId(messageId)
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
