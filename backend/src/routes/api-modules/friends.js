const { v4: uuidv4 } = require('uuid');
const createReactionHelpers = require('./reactions');

function registerFriendRoutes(router, deps) {
  const { authenticateToken, query, logger, shared, broadcastMessage } = deps;
  const { getUserByUsername, areUsersFriends } = shared;
  const { loadDirectMessageReactionsByIds, enrichMessagesWithReactions } = createReactionHelpers(query);
  const DELETED_CONTENT = 'deleted';

  router.get('/friends', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.userId;

      const friendsResult = await query(
        `SELECT f.id,
                'accepted' AS status,
                u.id AS "userId",
                u.username,
                u.email,
                f.updated_at AS "updatedAt"
         FROM friendships f
         JOIN users u
           ON u.id = CASE
             WHEN f.requester_id = $1 THEN f.addressee_id
             ELSE f.requester_id
           END
         WHERE (f.requester_id = $1 OR f.addressee_id = $1)
           AND f.status = 'accepted'
         ORDER BY u.username ASC`,
        [userId]
      );

      const incomingResult = await query(
        `SELECT f.id,
                f.status,
                u.id AS "userId",
                u.username,
                u.email,
                f.created_at AS "createdAt"
         FROM friendships f
         JOIN users u ON u.id = f.requester_id
         WHERE f.addressee_id = $1
           AND f.status = 'pending'
         ORDER BY f.created_at DESC`,
        [userId]
      );

      const outgoingResult = await query(
        `SELECT f.id,
                f.status,
                u.id AS "userId",
                u.username,
                u.email,
                f.created_at AS "createdAt"
         FROM friendships f
         JOIN users u ON u.id = f.addressee_id
         WHERE f.requester_id = $1
           AND f.status = 'pending'
         ORDER BY f.created_at DESC`,
        [userId]
      );

      return res.json({
        friends: friendsResult.rows,
        incoming: incomingResult.rows,
        outgoing: outgoingResult.rows
      });
    } catch (err) {
      logger.error('Friends fetch failed', { error: err.message, userId: req.user.userId });
      return res.status(500).json({ error: 'Failed to load friends' });
    }
  });

  router.post('/friends/request', authenticateToken, async (req, res) => {
    try {
      const requesterId = req.user.userId;
      const username = String(req.body?.username || '').trim();

      if (!username || username.length < 3 || username.length > 32) {
        return res.status(400).json({ error: 'Укажите корректный username' });
      }

      const target = await getUserByUsername(username);
      if (!target) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }

      if (target.id === requesterId) {
        return res.status(400).json({ error: 'Нельзя добавить себя в друзья' });
      }

      const existingResult = await query(
        `SELECT id, requester_id AS "requesterId", addressee_id AS "addresseeId", status
         FROM friendships
         WHERE (requester_id = $1 AND addressee_id = $2)
            OR (requester_id = $2 AND addressee_id = $1)
         LIMIT 1`,
        [requesterId, target.id]
      );

      const existing = existingResult.rows[0];
      if (!existing) {
        const id = uuidv4();
        await query(
          `INSERT INTO friendships (id, requester_id, addressee_id, status)
           VALUES ($1, $2, $3, 'pending')`,
          [id, requesterId, target.id]
        );
        broadcastMessage(
          { type: 'friends_updated' },
          { recipientUserIds: [requesterId, target.id] }
        );
        return res.status(201).json({ success: true, id, status: 'pending' });
      }

      if (existing.status === 'accepted') {
        return res.status(409).json({ error: 'Пользователь уже у вас в друзьях' });
      }

      if (existing.status === 'pending') {
        if (existing.requesterId === requesterId) {
          return res.status(409).json({ error: 'Заявка уже отправлена' });
        }

        await query(
          `UPDATE friendships
           SET status = 'accepted',
               updated_at = NOW()
           WHERE id = $1`,
          [existing.id]
        );
        broadcastMessage(
          { type: 'friends_updated' },
          { recipientUserIds: [existing.requesterId, existing.addresseeId] }
        );
        return res.json({ success: true, id: existing.id, status: 'accepted', autoAccepted: true });
      }

      await query(
        `UPDATE friendships
         SET requester_id = $2,
             addressee_id = $3,
             status = 'pending',
             updated_at = NOW()
         WHERE id = $1`,
        [existing.id, requesterId, target.id]
      );
      broadcastMessage(
        { type: 'friends_updated' },
        { recipientUserIds: [requesterId, target.id] }
      );

      return res.json({ success: true, id: existing.id, status: 'pending' });
    } catch (err) {
      logger.error('Friend request failed', { error: err.message, userId: req.user.userId });
      return res.status(500).json({ error: 'Не удалось отправить заявку в друзья' });
    }
  });

  router.post('/friends/:friendshipId/accept', authenticateToken, async (req, res) => {
    try {
      const { friendshipId } = req.params;
      const userId = req.user.userId;

      const result = await query(
        `UPDATE friendships
         SET status = 'accepted',
             updated_at = NOW()
         WHERE id = $1
           AND addressee_id = $2
           AND status = 'pending'
         RETURNING id,
                   requester_id AS "requesterId",
                   addressee_id AS "addresseeId"`,
        [friendshipId, userId]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Заявка не найдена или уже обработана' });
      }

      broadcastMessage(
        { type: 'friends_updated' },
        { recipientUserIds: [result.rows[0].requesterId, result.rows[0].addresseeId] }
      );
      return res.json({ success: true, id: friendshipId, status: 'accepted' });
    } catch (err) {
      logger.error('Friend accept failed', {
        error: err.message,
        userId: req.user.userId,
        friendshipId: req.params.friendshipId
      });
      return res.status(500).json({ error: 'Не удалось принять заявку' });
    }
  });

  router.post('/friends/:friendshipId/reject', authenticateToken, async (req, res) => {
    try {
      const { friendshipId } = req.params;
      const userId = req.user.userId;

      const result = await query(
        `UPDATE friendships
         SET status = 'rejected',
             updated_at = NOW()
         WHERE id = $1
           AND addressee_id = $2
           AND status = 'pending'
         RETURNING id,
                   requester_id AS "requesterId",
                   addressee_id AS "addresseeId"`,
        [friendshipId, userId]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Заявка не найдена или уже обработана' });
      }

      broadcastMessage(
        { type: 'friends_updated' },
        { recipientUserIds: [result.rows[0].requesterId, result.rows[0].addresseeId] }
      );
      return res.json({ success: true, id: friendshipId, status: 'rejected' });
    } catch (err) {
      logger.error('Friend reject failed', {
        error: err.message,
        userId: req.user.userId,
        friendshipId: req.params.friendshipId
      });
      return res.status(500).json({ error: 'Не удалось отклонить заявку' });
    }
  });

  router.get('/friends/:friendUserId/messages', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const friendUserId = String(req.params.friendUserId || '').trim();

    try {
      const isFriend = await areUsersFriends(userId, friendUserId);
      if (!isFriend) {
        return res.status(403).json({ error: 'Личный чат доступен только с друзьями' });
      }

      const result = await query(
        `SELECT dm.id,
                dm.sender_id AS "senderId",
                dm.recipient_id AS "recipientId",
                su.username AS "senderUsername",
                ru.username AS "recipientUsername",
                dm.content,
                dm.created_at AS "timestamp",
                dm.edited_at AS "editedAt",
                dm.deleted_at AS "deletedAt"
         FROM direct_messages dm
         JOIN users su ON su.id = dm.sender_id
         JOIN users ru ON ru.id = dm.recipient_id
         WHERE (dm.sender_id = $1 AND dm.recipient_id = $2)
            OR (dm.sender_id = $2 AND dm.recipient_id = $1)
         ORDER BY dm.created_at DESC
         LIMIT 100`,
        [userId, friendUserId]
      );

      const messages = await enrichMessagesWithReactions(result.rows.reverse(), loadDirectMessageReactionsByIds);
      return res.json(messages);
    } catch (err) {
      logger.error('Direct messages fetch failed', { error: err.message, userId, friendUserId });
      return res.status(500).json({ error: 'Не удалось загрузить личные сообщения' });
    }
  });

  router.post('/friends/:friendUserId/messages', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const friendUserId = String(req.params.friendUserId || '').trim();
    const content = String(req.body?.content || '').trim();

    if (!content) {
      return res.status(400).json({ error: 'Message content required' });
    }
    if (content.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 chars)' });
    }

    try {
      const isFriend = await areUsersFriends(userId, friendUserId);
      if (!isFriend) {
        return res.status(403).json({ error: 'Личный чат доступен только с друзьями' });
      }

      const messageId = uuidv4();
      const inserted = await query(
        `INSERT INTO direct_messages (id, sender_id, recipient_id, content)
         VALUES ($1, $2, $3, $4)
         RETURNING id,
                   sender_id AS "senderId",
                   recipient_id AS "recipientId",
                   content,
                   created_at AS "timestamp",
                   edited_at AS "editedAt",
                   deleted_at AS "deletedAt"`,
        [messageId, userId, friendUserId, content]
      );

      const message = {
        ...inserted.rows[0],
        reactions: []
      };
      broadcastMessage(
        {
          type: 'direct_message_new',
          message
        },
        { recipientUserIds: [userId, friendUserId] }
      );

      return res.status(201).json({
        success: true,
        message
      });
    } catch (err) {
      logger.error('Direct message save failed', { error: err.message, userId, friendUserId });
      return res.status(500).json({ error: 'Не удалось отправить личное сообщение' });
    }
  });

  router.patch('/friends/:friendUserId/messages/:messageId', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const friendUserId = String(req.params.friendUserId || '').trim();
    const messageId = String(req.params.messageId || '').trim();
    const content = String(req.body?.content || '').trim();

    if (!content) {
      return res.status(400).json({ error: 'Message content required' });
    }
    if (content.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 chars)' });
    }

    try {
      const isFriend = await areUsersFriends(userId, friendUserId);
      if (!isFriend) {
        return res.status(403).json({ error: 'Личный чат доступен только с друзьями' });
      }

      const existing = await query(
        `SELECT id,
                sender_id AS "senderId",
                recipient_id AS "recipientId",
                deleted_at AS "deletedAt"
         FROM direct_messages
         WHERE id = $1
         LIMIT 1`,
        [messageId]
      );

      const target = existing.rows[0];
      if (!target) {
        return res.status(404).json({ error: 'Сообщение не найдено' });
      }
      if (target.senderId !== userId) {
        return res.status(403).json({ error: 'Можно редактировать только свои сообщения' });
      }
      if (![target.senderId, target.recipientId].includes(friendUserId)) {
        return res.status(403).json({ error: 'Сообщение не относится к этому диалогу' });
      }
      if (target.deletedAt) {
        return res.status(409).json({ error: 'Удаленное сообщение нельзя редактировать' });
      }

      const updated = await query(
        `UPDATE direct_messages
         SET content = $2,
             edited_at = NOW()
         WHERE id = $1
         RETURNING id,
                   sender_id AS "senderId",
                   recipient_id AS "recipientId",
                   content,
                   created_at AS "timestamp",
                   edited_at AS "editedAt",
                   deleted_at AS "deletedAt"`,
        [messageId, content]
      );

      const [message] = await enrichMessagesWithReactions(updated.rows, loadDirectMessageReactionsByIds);
      broadcastMessage(
        {
          type: 'direct_message_updated',
          message
        },
        { recipientUserIds: [userId, friendUserId] }
      );
      return res.json({ success: true, message });
    } catch (err) {
      logger.error('Direct message edit failed', { error: err.message, userId, friendUserId, messageId });
      return res.status(500).json({ error: 'Не удалось отредактировать личное сообщение' });
    }
  });

  router.delete('/friends/:friendUserId/messages/:messageId', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const friendUserId = String(req.params.friendUserId || '').trim();
    const messageId = String(req.params.messageId || '').trim();

    try {
      const isFriend = await areUsersFriends(userId, friendUserId);
      if (!isFriend) {
        return res.status(403).json({ error: 'Личный чат доступен только с друзьями' });
      }

      const existing = await query(
        `SELECT id,
                sender_id AS "senderId",
                recipient_id AS "recipientId"
         FROM direct_messages
         WHERE id = $1
         LIMIT 1`,
        [messageId]
      );

      const target = existing.rows[0];
      if (!target) {
        return res.status(404).json({ error: 'Сообщение не найдено' });
      }
      if (target.senderId !== userId) {
        return res.status(403).json({ error: 'Можно удалять только свои сообщения' });
      }
      if (![target.senderId, target.recipientId].includes(friendUserId)) {
        return res.status(403).json({ error: 'Сообщение не относится к этому диалогу' });
      }

      const deleted = await query(
        `UPDATE direct_messages
         SET content = $2,
             deleted_at = NOW()
         WHERE id = $1
         RETURNING id,
                   sender_id AS "senderId",
                   recipient_id AS "recipientId",
                   content,
                   created_at AS "timestamp",
                   edited_at AS "editedAt",
                   deleted_at AS "deletedAt"`,
        [messageId, DELETED_CONTENT]
      );

      const [message] = await enrichMessagesWithReactions(deleted.rows, loadDirectMessageReactionsByIds);
      broadcastMessage(
        {
          type: 'direct_message_deleted',
          message
        },
        { recipientUserIds: [userId, friendUserId] }
      );
      return res.json({ success: true, message });
    } catch (err) {
      logger.error('Direct message delete failed', { error: err.message, userId, friendUserId, messageId });
      return res.status(500).json({ error: 'Не удалось удалить личное сообщение' });
    }
  });

  router.put('/friends/:friendUserId/messages/:messageId/reactions', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const friendUserId = String(req.params.friendUserId || '').trim();
    const messageId = String(req.params.messageId || '').trim();
    const emoji = String(req.body?.emoji || '').trim().slice(0, 24);

    if (!messageId) {
      return res.status(400).json({ error: 'Message id required' });
    }
    if (!emoji) {
      return res.status(400).json({ error: 'Emoji required' });
    }

    try {
      const isFriend = await areUsersFriends(userId, friendUserId);
      if (!isFriend) {
        return res.status(403).json({ error: 'Личный чат доступен только с друзьями' });
      }

      const targetResult = await query(
        `SELECT id,
                sender_id AS "senderId",
                recipient_id AS "recipientId",
                deleted_at AS "deletedAt"
         FROM direct_messages
         WHERE id = $1
         LIMIT 1`,
        [messageId]
      );

      const target = targetResult.rows[0];
      if (!target) {
        return res.status(404).json({ error: 'Сообщение не найдено' });
      }
      if (![target.senderId, target.recipientId].includes(userId)) {
        return res.status(404).json({ error: 'Сообщение не найдено' });
      }
      if (![target.senderId, target.recipientId].includes(friendUserId)) {
        return res.status(403).json({ error: 'Сообщение не относится к этому диалогу' });
      }
      if (target.deletedAt) {
        return res.status(409).json({ error: 'Удаленное сообщение нельзя реагировать' });
      }

      const inserted = await query(
        `INSERT INTO direct_message_reactions (direct_message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING direct_message_id`,
        [messageId, userId, emoji]
      );

      if (!inserted.rows[0]) {
        await query(
          `DELETE FROM direct_message_reactions
           WHERE direct_message_id = $1
             AND user_id = $2
             AND emoji = $3`,
          [messageId, userId, emoji]
        );
      }

      const reactionRows = await query(
        `SELECT emoji,
                ARRAY_AGG(user_id::text ORDER BY user_id) AS "userIds"
         FROM direct_message_reactions
         WHERE direct_message_id = $1
         GROUP BY emoji`,
        [messageId]
      );

      const reactions = reactionRows.rows.map((row) => ({ emoji: row.emoji, userIds: row.userIds }));
      broadcastMessage(
        {
          type: 'direct_message_reactions_updated',
          messageId,
          senderId: target.senderId,
          recipientId: target.recipientId,
          reactions
        },
        { recipientUserIds: [target.senderId, target.recipientId] }
      );
      return res.json({ success: true, reactions });
    } catch (err) {
      logger.error('Direct message reaction toggle failed', { error: err.message, userId, friendUserId, messageId });
      return res.status(500).json({ error: 'Не удалось обновить реакцию' });
    }
  });
}

module.exports = registerFriendRoutes;
