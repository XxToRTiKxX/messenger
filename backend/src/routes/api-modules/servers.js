const createServerService = require('./server-service');

const BASE_ROLES = ['creator', 'admin', 'moderator', 'member'];

function safeRoleName(value) {
  return String(value || '').trim().slice(0, 40);
}

function safePermissionMap(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.entries(input).reduce((acc, [key, value]) => {
    acc[String(key).slice(0, 64)] = Boolean(value);
    return acc;
  }, {});
}

function safeCategoryName(value) {
  const cleaned = String(value || '').trim().slice(0, 60);
  return cleaned || 'Общие';
}

async function ensureCategoryExists(query, serverId, categoryName, userId) {
  const normalized = safeCategoryName(categoryName);
  const positionResult = await query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next
     FROM server_categories
     WHERE server_id = $1`,
    [serverId]
  );

  await query(
    `INSERT INTO server_categories (server_id, name, position, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (server_id, name) DO NOTHING`,
    [serverId, normalized, Number(positionResult.rows[0]?.next || 0), userId || null]
  );

  return normalized;
}

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
    getBaseUrl,
    loadUserRoleLabels
  } = shared;
  const serverService = createServerService({ query, uuidv4 });

  router.get('/servers', authenticateToken, async (req, res) => {
    try {
      await ensureDefaultWorkspaceForUser(req.user.userId);

      const result = await query(
        `SELECT s.id,
                s.name,
                s.icon_url AS "iconUrl",
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
      const iconUrl = String(req.body?.iconUrl || '').trim() || null;
      if (!name || name.length < 2 || name.length > 60) {
        return res.status(400).json({ error: 'Server name must be 2-60 characters' });
      }
      const created = await serverService.createServerWithDefaultChannel({
        name,
        iconUrl,
        userId: req.user.userId
      });
      return res.status(201).json(created);
    } catch (err) {
      logger.error('Server create failed', { error: err.message, userId: req.user.userId });
      return res.status(500).json({ error: 'Failed to create server' });
    }
  });

  router.patch('/servers/:serverId/settings', authenticateToken, async (req, res) => {
    try {
      const { serverId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole || !canManageServer(serverRole)) {
        return res.status(403).json({ error: 'Only creator/admin can update server settings' });
      }

      const name = String(req.body?.name || '').trim();
      const iconUrlRaw = req.body?.iconUrl;
      const iconUrl = typeof iconUrlRaw === 'string' ? iconUrlRaw.trim().slice(0, 2_000_000) : null;
      if (!name && iconUrlRaw == null) {
        return res.status(400).json({ error: 'Nothing to update' });
      }
      if (name && (name.length < 2 || name.length > 60)) {
        return res.status(400).json({ error: 'Server name must be 2-60 characters' });
      }

      const updated = await query(
        `UPDATE servers
         SET name = COALESCE(NULLIF($2, ''), name),
             icon_url = CASE WHEN $3::text IS NULL THEN icon_url ELSE NULLIF($3, '') END
         WHERE id = $1
         RETURNING id,
                   name,
                   icon_url AS "iconUrl"`,
        [serverId, name, iconUrlRaw == null ? null : iconUrl]
      );

      if (!updated.rows[0]) {
        return res.status(404).json({ error: 'Server not found' });
      }

      return res.json({ success: true, server: updated.rows[0] });
    } catch (err) {
      logger.error('Server settings update failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId
      });
      return res.status(500).json({ error: 'Failed to update server settings' });
    }
  });

  router.get('/servers/:serverId/categories', authenticateToken, async (req, res) => {
    try {
      const { serverId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }

      await ensureCategoryExists(query, serverId, 'Общие', null);

      const rows = await query(
        `SELECT id, name, position, created_at AS "createdAt"
         FROM server_categories
         WHERE server_id = $1
         ORDER BY position ASC, created_at ASC`,
        [serverId]
      );

      return res.json({ categories: rows.rows });
    } catch (err) {
      logger.error('Server categories load failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId
      });
      return res.status(500).json({ error: 'Failed to load server categories' });
    }
  });

  router.post('/servers/:serverId/categories', authenticateToken, async (req, res) => {
    try {
      const { serverId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);

      if (!serverRole || !canManageServer(serverRole)) {
        return res.status(403).json({ error: 'Only creator/admin can create categories' });
      }

      const name = safeCategoryName(req.body?.name);
      const category = await ensureCategoryExists(query, serverId, name, req.user.userId);

      return res.status(201).json({ success: true, name: category });
    } catch (err) {
      logger.error('Server category create failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId
      });
      return res.status(500).json({ error: 'Failed to create category' });
    }
  });

  router.get('/servers/:serverId/channels', authenticateToken, async (req, res) => {
    try {
      const { serverId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);

      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }

      const roleLabels = await loadUserRoleLabels(serverId, req.user.userId);
      const normalizedRoleLabels = new Set(roleLabels.map((role) => String(role || '').trim()).filter(Boolean));

      const channels = await query(
        `SELECT c.id,
                c.server_id AS "serverId",
                c.name,
                c.category_name AS "categoryName",
                c.description,
                c.type,
                c.position,
                c.created_at AS "createdAt",
                COALESCE(cp.role, 'member') AS "myRole",
                COALESCE(
                  (
                    SELECT ARRAY_AGG(cvr.role_name ORDER BY cvr.role_name)
                    FROM channel_visibility_roles cvr
                    WHERE cvr.channel_id = c.id
                  ),
                  ARRAY[]::text[]
                ) AS "visibleRoles"
         FROM channels c
         LEFT JOIN channel_participants cp
           ON cp.channel_id = c.id
          AND cp.user_id = $2
         WHERE c.server_id = $1
         ORDER BY c.position ASC, c.created_at ASC`,
        [serverId, req.user.userId]
      );

      const canBypassVisibility = serverRole === 'creator' || serverRole === 'admin';
      const filteredChannels = channels.rows.filter((channel) => {
        const allowed = Array.isArray(channel.visibleRoles) ? channel.visibleRoles : [];
        if (canBypassVisibility) return true;
        if (allowed.length === 0) return true;
        return allowed.some((roleName) => normalizedRoleLabels.has(String(roleName || '').trim()));
      });

      return res.json({
        serverRole,
        roleLabels,
        channels: filteredChannels
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
      const type = String(req.body?.type || 'text').trim() === 'voice' ? 'voice' : 'text';
      const categoryName = await ensureCategoryExists(query, serverId, req.body?.categoryName || 'Общие', req.user.userId);

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
        `INSERT INTO channels (id, server_id, name, category_name, description, type, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id,
                   server_id AS "serverId",
                   name,
                   category_name AS "categoryName",
                   description,
                   type,
                   position,
                   created_at AS "createdAt"`,
        [channelId, serverId, name, categoryName, description, type, position, req.user.userId]
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

  router.get('/servers/:serverId/channels/:channelId/visibility', authenticateToken, async (req, res) => {
    try {
      const { serverId, channelId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }

      const channelCheck = await query(
        `SELECT id
         FROM channels
         WHERE id = $1
           AND server_id = $2
         LIMIT 1`,
        [channelId, serverId]
      );
      if (!channelCheck.rows[0]) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const visibility = await query(
        `SELECT role_name AS "roleName"
         FROM channel_visibility_roles
         WHERE channel_id = $1
         ORDER BY role_name ASC`,
        [channelId]
      );

      return res.json({
        channelId,
        roles: visibility.rows.map((row) => row.roleName)
      });
    } catch (err) {
      logger.error('Channel visibility load failed', {
        error: err.message,
        userId: req.user.userId,
        channelId: req.params.channelId
      });
      return res.status(500).json({ error: 'Failed to load channel visibility' });
    }
  });

  router.put('/servers/:serverId/channels/:channelId/visibility', authenticateToken, async (req, res) => {
    try {
      const { serverId, channelId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole || !canManageServer(serverRole)) {
        return res.status(403).json({ error: 'Only creator/admin can update channel visibility' });
      }

      const channelCheck = await query(
        `SELECT id
         FROM channels
         WHERE id = $1
           AND server_id = $2
         LIMIT 1`,
        [channelId, serverId]
      );
      if (!channelCheck.rows[0]) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const rawRoles = Array.isArray(req.body?.roles) ? req.body.roles : [];
      const roles = [...new Set(rawRoles.map((role) => safeRoleName(role)).filter(Boolean))];

      await query('BEGIN');
      try {
        await query('DELETE FROM channel_visibility_roles WHERE channel_id = $1', [channelId]);
        for (const roleName of roles) {
          await query(
            `INSERT INTO channel_visibility_roles (channel_id, role_name)
             VALUES ($1, $2)
             ON CONFLICT (channel_id, role_name) DO NOTHING`,
            [channelId, roleName]
          );
        }
        await query('COMMIT');
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }

      return res.json({ success: true, channelId, roles });
    } catch (err) {
      logger.error('Channel visibility update failed', {
        error: err.message,
        userId: req.user.userId,
        channelId: req.params.channelId
      });
      return res.status(500).json({ error: 'Failed to update channel visibility' });
    }
  });

  router.get('/servers/:serverId/members', authenticateToken, async (req, res) => {
    try {
      const { serverId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }

      const result = await query(
        `SELECT u.id,
                u.username,
                u.email,
                sp.role AS "serverRole",
                COALESCE(
                  (
                    SELECT ARRAY_AGG(sr.id ORDER BY sr.created_at)
                    FROM server_member_roles smr
                    JOIN server_roles sr ON sr.id = smr.role_id
                    WHERE smr.server_id = sp.server_id
                      AND smr.user_id = sp.user_id
                  ),
                  ARRAY[]::uuid[]
                ) AS "roleIds"
         FROM server_participants sp
         JOIN users u ON u.id = sp.user_id
         WHERE sp.server_id = $1
         ORDER BY u.username ASC`,
        [serverId]
      );

      return res.json({ members: result.rows });
    } catch (err) {
      logger.error('Server members load failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId
      });
      return res.status(500).json({ error: 'Failed to load server members' });
    }
  });

  router.get('/servers/:serverId/roles', authenticateToken, async (req, res) => {
    try {
      const { serverId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole) {
        return res.status(403).json({ error: 'No access to this server' });
      }

      const roles = await query(
        `SELECT id,
                name,
                permissions,
                created_by AS "createdBy",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
         FROM server_roles
         WHERE server_id = $1
         ORDER BY created_at ASC`,
        [serverId]
      );

      return res.json({
        baseRoles: BASE_ROLES,
        roles: roles.rows
      });
    } catch (err) {
      logger.error('Server roles load failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId
      });
      return res.status(500).json({ error: 'Failed to load server roles' });
    }
  });

  router.post('/servers/:serverId/roles', authenticateToken, async (req, res) => {
    try {
      const { serverId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole || !canManageServer(serverRole)) {
        return res.status(403).json({ error: 'Only creator/admin can create roles' });
      }

      const name = safeRoleName(req.body?.name);
      if (!name || BASE_ROLES.includes(name.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid role name' });
      }

      const permissions = safePermissionMap(req.body?.permissions);

      const inserted = await query(
        `INSERT INTO server_roles (server_id, name, permissions, created_by)
         VALUES ($1, $2, $3::jsonb, $4)
         RETURNING id,
                   name,
                   permissions,
                   created_by AS "createdBy",
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [serverId, name, JSON.stringify(permissions), req.user.userId]
      );

      return res.status(201).json({ success: true, role: inserted.rows[0] });
    } catch (err) {
      if (String(err.message).includes('server_roles_server_id_name_key')) {
        return res.status(409).json({ error: 'Role with this name already exists' });
      }
      logger.error('Server role create failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId
      });
      return res.status(500).json({ error: 'Failed to create role' });
    }
  });

  router.patch('/servers/:serverId/roles/:roleId', authenticateToken, async (req, res) => {
    try {
      const { serverId, roleId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole || !canManageServer(serverRole)) {
        return res.status(403).json({ error: 'Only creator/admin can update roles' });
      }

      const name = safeRoleName(req.body?.name);
      const permissions = safePermissionMap(req.body?.permissions);

      const updated = await query(
        `UPDATE server_roles
         SET name = COALESCE(NULLIF($3, ''), name),
             permissions = CASE WHEN $4::jsonb = '{}'::jsonb THEN permissions ELSE $4::jsonb END,
             updated_at = NOW()
         WHERE id = $1
           AND server_id = $2
         RETURNING id,
                   name,
                   permissions,
                   created_by AS "createdBy",
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [roleId, serverId, name, JSON.stringify(permissions)]
      );

      if (!updated.rows[0]) {
        return res.status(404).json({ error: 'Role not found' });
      }

      return res.json({ success: true, role: updated.rows[0] });
    } catch (err) {
      if (String(err.message).includes('server_roles_server_id_name_key')) {
        return res.status(409).json({ error: 'Role with this name already exists' });
      }
      logger.error('Server role update failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId,
        roleId: req.params.roleId
      });
      return res.status(500).json({ error: 'Failed to update role' });
    }
  });

  router.delete('/servers/:serverId/roles/:roleId', authenticateToken, async (req, res) => {
    try {
      const { serverId, roleId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole || !canManageServer(serverRole)) {
        return res.status(403).json({ error: 'Only creator/admin can delete roles' });
      }

      const removed = await query(
        `DELETE FROM server_roles
         WHERE id = $1
           AND server_id = $2
         RETURNING id`,
        [roleId, serverId]
      );

      if (!removed.rows[0]) {
        return res.status(404).json({ error: 'Role not found' });
      }

      return res.json({ success: true });
    } catch (err) {
      logger.error('Server role delete failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId,
        roleId: req.params.roleId
      });
      return res.status(500).json({ error: 'Failed to delete role' });
    }
  });

  router.put('/servers/:serverId/members/:userId/roles', authenticateToken, async (req, res) => {
    try {
      const { serverId, userId } = req.params;
      const serverRole = await ensureUserHasServerAccess(serverId, req.user.userId);
      if (!serverRole || !canManageServer(serverRole)) {
        return res.status(403).json({ error: 'Only creator/admin can manage member roles' });
      }

      const roleIds = Array.isArray(req.body?.roleIds)
        ? [...new Set(req.body.roleIds.map((value) => String(value || '').trim()).filter(Boolean))]
        : [];

      const availableRoles = await query(
        `SELECT id
         FROM server_roles
         WHERE server_id = $1`,
        [serverId]
      );
      const availableSet = new Set(availableRoles.rows.map((row) => row.id));
      if (roleIds.some((roleId) => !availableSet.has(roleId))) {
        return res.status(400).json({ error: 'Unknown role id in payload' });
      }

      await query('BEGIN');
      try {
        await query(
          `DELETE FROM server_member_roles
           WHERE server_id = $1
             AND user_id = $2`,
          [serverId, userId]
        );

        for (const roleId of roleIds) {
          await query(
            `INSERT INTO server_member_roles (server_id, user_id, role_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (server_id, user_id, role_id) DO NOTHING`,
            [serverId, userId, roleId]
          );
        }

        await query('COMMIT');
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }

      return res.json({ success: true, roleIds });
    } catch (err) {
      logger.error('Server member roles update failed', {
        error: err.message,
        userId: req.user.userId,
        serverId: req.params.serverId,
        targetUserId: req.params.userId
      });
      return res.status(500).json({ error: 'Failed to update member roles' });
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
