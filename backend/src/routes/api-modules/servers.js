const createServerService = require('./server-service');

function registerServerRoutes(router, deps) {
  const {
    authenticateToken,
    query,
    logger,
    uuidv4,
    ensureDefaultWorkspaceForUser,
    shared
  } = deps;

  const {
    normalizeChannelName,
    canManageServer,
    ensureUserHasServerAccess,
    areUsersFriends,
    generateInviteCode,
    getBaseUrl
  } = shared;
  const serverService = createServerService({ query, uuidv4 });

  router.get('/servers', authenticateToken, async (req, res) => {
    try {
      await ensureDefaultWorkspaceForUser(req.user.userId);

      const result = await query(
        `SELECT s.id,
                s.name,
                sp.role,
                s.created_at AS "createdAt"
         FROM servers s
         JOIN server_participants sp
           ON sp.server_id = s.id
         WHERE sp.user_id = $1
         ORDER BY s.created_at ASC`,
        [req.user.userId]
      );

      return res.json(result.rows);
    } catch (err) {
      logger.error('Server list failed', { error: err.message, userId: req.user.userId });
      return res.status(500).json({ error: 'Failed to load servers' });
    }
  });

  router.post('/servers', authenticateToken, async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name || name.length < 2 || name.length > 60) {
        return res.status(400).json({ error: 'Server name must be 2-60 characters' });
      }
      const created = await serverService.createServerWithDefaultChannel({
        name,
        userId: req.user.userId
      });
      return res.status(201).json(created);
    } catch (err) {
      logger.error('Server create failed', { error: err.message, userId: req.user.userId });
      return res.status(500).json({ error: 'Failed to create server' });
    }
  });

  router.get('/servers/:serverId/channels', authenticateToken, async (req, res) => {
    try {
      const { serverId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);

      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }

      const channels = await query(
        `SELECT c.id,
                c.server_id AS "serverId",
                c.name,
                c.description,
                c.type,
                c.position,
                c.created_at AS "createdAt",
                COALESCE(cp.role, 'member') AS "myRole"
         FROM channels c
         LEFT JOIN channel_participants cp
           ON cp.channel_id = c.id
          AND cp.user_id = $2
         WHERE c.server_id = $1
         ORDER BY c.position ASC, c.created_at ASC`,
        [serverId, req.user.userId]
      );

      return res.json({
        serverRole,
        channels: channels.rows
      });
    } catch (err) {
      logger.error('Channel list failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId
      });
      return res.status(500).json({ error: 'Failed to load channels' });
    }
  });

  router.post('/servers/:serverId/channels', authenticateToken, async (req, res) => {
    try {
      const { serverId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);

      if (!serverRole || !canManageServer(serverRole)) {
        return res.status(403).json({ error: 'Only creator/admin can create channels' });
      }

      const rawName = String(req.body?.name || '');
      const name = normalizeChannelName(rawName);
      const description = String(req.body?.description || '').trim().slice(0, 300);

      if (!name || name.length < 2) {
        return res.status(400).json({ error: 'Channel name must contain at least 2 valid characters' });
      }

      const posResult = await query(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM channels WHERE server_id = $1',
        [serverId]
      );

      const channelId = uuidv4();
      const position = Number(posResult.rows[0].next) || 0;

      const inserted = await query(
        `INSERT INTO channels (id, server_id, name, description, type, position, created_by)
         VALUES ($1, $2, $3, $4, 'text', $5, $6)
         RETURNING id,
                   server_id AS "serverId",
                   name,
                   description,
                   type,
                   position,
                   created_at AS "createdAt"`,
        [channelId, serverId, name, description, position, req.user.userId]
      );

      await query(
        `INSERT INTO channel_participants (channel_id, user_id, role)
         VALUES ($1, $2, 'creator')
         ON CONFLICT (channel_id, user_id)
         DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
        [channelId, req.user.userId]
      );

      return res.status(201).json(inserted.rows[0]);
    } catch (err) {
      if (String(err.message).includes('channels_server_id_name_key')) {
        return res.status(409).json({ error: 'Channel name already exists on this server' });
      }

      logger.error('Channel create failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId
      });
      return res.status(500).json({ error: 'Failed to create channel' });
    }
  });

  router.post('/servers/:serverId/invite-links', authenticateToken, async (req, res) => {
    try {
      const { serverId } = req.params;
      const inviterRole = await ensureUserHasServerAccess(serverId, req.user.userId);

      if (!inviterRole || !canManageServer(inviterRole)) {
        return res.status(403).json({ error: 'Только creator/admin может создавать инвайты' });
      }

      const inviteType = String(req.body?.type || 'long_term').trim();
      const targetUserId = req.body?.targetUserId ? String(req.body.targetUserId).trim() : null;
      const oneTime = inviteType === 'one_time';

      if (!['one_time', 'long_term'].includes(inviteType)) {
        return res.status(400).json({ error: 'Тип инвайта должен быть one_time или long_term' });
      }

      if (targetUserId) {
        const isFriend = await areUsersFriends(req.user.userId, targetUserId);
        if (!isFriend) {
          return res.status(403).json({ error: 'Можно отправлять персональную ссылку только друзьям' });
        }
      }

      const code = generateInviteCode();
      const createdInvite = await serverService.createInvite({
        serverId,
        userId: req.user.userId,
        targetUserId,
        inviteType,
        maxUses: oneTime ? 1 : 0,
        code
      });

      const inviteUrl = `${getBaseUrl(req)}/app/?invite=${encodeURIComponent(code)}`;

      return res.status(201).json({
        success: true,
        id: createdInvite.inviteId,
        code: createdInvite.code,
        inviteType: createdInvite.inviteType,
        inviteUrl,
        oneTime: createdInvite.oneTime,
        targetUserId: createdInvite.targetUserId
      });
    } catch (err) {
      logger.error('Invite link create failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId
      });
      return res.status(500).json({ error: 'Не удалось создать ссылку-приглашение' });
    }
  });

  router.get('/invites/:code', authenticateToken, async (req, res) => {
    try {
      const code = String(req.params.code || '').trim();

      const invite = await serverService.loadInviteByCode(code);
      if (!invite) {
        return res.status(404).json({ error: 'Ссылка приглашения не найдена' });
      }

      const now = Date.now();
      const isExpiredByTime = invite.expiresAt ? new Date(invite.expiresAt).getTime() <= now : false;
      const isExpiredByUse = invite.maxUses > 0 && invite.usesCount >= invite.maxUses;
      const wrongUser = invite.targetUserId && invite.targetUserId !== req.user.userId;

      return res.json({
        ...invite,
        isExpired: isExpiredByTime || isExpiredByUse,
        canAccept: !isExpiredByTime && !isExpiredByUse && !wrongUser,
        wrongUser
      });
    } catch (err) {
      logger.error('Invite preview failed', {
        error: err.message,
        userId: req.user.userId,
        code: req.params.code
      });
      return res.status(500).json({ error: 'Не удалось проверить приглашение' });
    }
  });

  router.post('/invites/:code/accept', authenticateToken, async (req, res) => {
    try {
      const code = String(req.params.code || '').trim();
      const userId = req.user.userId;
      const accepted = await serverService.acceptInvite({ code, userId });

      if (accepted.error === 'not_found') {
        return res.status(404).json({ error: 'Ссылка приглашения не найдена' });
      }
      if (accepted.error === 'wrong_user') {
        return res.status(403).json({ error: 'Это персональная ссылка для другого пользователя' });
      }
      if (accepted.error === 'expired') {
        return res.status(410).json({ error: 'Срок действия ссылки истек' });
      }
      if (accepted.error === 'used') {
        return res.status(410).json({ error: 'Ссылка уже использована' });
      }

      return res.json({
        success: true,
        alreadyMember: accepted.alreadyMember,
        server: accepted.server
      });
    } catch (err) {
      logger.error('Invite accept failed', {
        error: err.message,
        userId: req.user.userId,
        code: req.params.code
      });
      return res.status(500).json({ error: 'Не удалось принять приглашение' });
    }
  });
}

module.exports = registerServerRoutes;
