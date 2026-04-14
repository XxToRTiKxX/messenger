function registerChannelRoutes(router, deps) {
  const { authenticateToken, query, logger, shared } = deps;
  const { VALID_CHANNEL_ROLES, getChannelContext, canManageChannelRoles } = shared;

  router.get('/channels/:channelId/participants', authenticateToken, async (req, res) => {
    try {
      const context = await getChannelContext(req.params.channelId, req.user.userId);

      if (!context) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      if (!context.hasServerAccess) {
        return res.status(403).json({ error: 'No access to this channel' });
      }

      const participants = await query(
        `SELECT u.id,
                u.username,
                u.email,
                COALESCE(cp.role, 'member') AS role,
                (cp.user_id IS NOT NULL) AS "hasChannelRole"
         FROM users u
         JOIN server_participants sp
           ON sp.user_id = u.id
          AND sp.server_id = $1
         LEFT JOIN channel_participants cp
           ON cp.channel_id = $2
          AND cp.user_id = u.id
         WHERE u.registration_status = 'active'
           AND u.is_approved = TRUE
         ORDER BY u.username ASC`,
        [context.serverId, context.channelId]
      );

      return res.json({
        channelId: context.channelId,
        serverId: context.serverId,
        myRole: context.effectiveRole,
        participants: participants.rows
      });
    } catch (err) {
      logger.error('Channel participants load failed', {
        error: err.message,
        userId: req.user.userId,
        channelId: req.params.channelId
      });
      return res.status(500).json({ error: 'Failed to load channel participants' });
    }
  });

  router.put('/channels/:channelId/participants/:userId/role', authenticateToken, async (req, res) => {
    try {
      const { channelId, userId: targetUserId } = req.params;
      const nextRole = String(req.body?.role || '').trim().toLowerCase();

      if (!VALID_CHANNEL_ROLES.has(nextRole)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      const context = await getChannelContext(channelId, req.user.userId);
      if (!context) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      if (!context.hasServerAccess) {
        return res.status(403).json({ error: 'No access to this channel' });
      }

      if (!canManageChannelRoles(context)) {
        return res.status(403).json({ error: 'Only creator/admin can edit channel roles' });
      }

      const targetResult = await query(
        `SELECT u.id,
                u.username,
                sp.role AS "serverRole",
                COALESCE(cp.role, 'member') AS "channelRole"
         FROM users u
         LEFT JOIN server_participants sp
           ON sp.user_id = u.id
          AND sp.server_id = $1
         LEFT JOIN channel_participants cp
           ON cp.user_id = u.id
          AND cp.channel_id = $2
         WHERE u.id = $3
         LIMIT 1`,
        [context.serverId, channelId, targetUserId]
      );

      const target = targetResult.rows[0];
      if (!target || !target.serverRole) {
        return res.status(404).json({ error: 'Target user is not in this server' });
      }

      if (context.effectiveRole === 'admin') {
        if (['creator', 'admin'].includes(nextRole)) {
          return res.status(403).json({ error: 'Admin cannot assign creator/admin roles' });
        }
        if (['creator', 'admin'].includes(target.channelRole) || ['creator', 'admin'].includes(target.serverRole)) {
          return res.status(403).json({ error: 'Admin cannot modify creator/admin users' });
        }
      }

      if (targetUserId === req.user.userId && nextRole !== 'creator') {
        const ownerCountResult = await query(
          `SELECT COUNT(*)::int AS total
           FROM channel_participants
           WHERE channel_id = $1
             AND role = 'creator'`,
          [channelId]
        );

        const ownersTotal = ownerCountResult.rows[0]?.total || 0;
        if (context.effectiveRole === 'creator' && ownersTotal <= 1) {
          return res.status(400).json({ error: 'Нельзя снять роль creator у единственного создателя канала' });
        }
      }

      await query(
        `INSERT INTO channel_participants (channel_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, user_id)
         DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
        [channelId, targetUserId, nextRole]
      );

      return res.json({
        success: true,
        channelId,
        userId: targetUserId,
        role: nextRole
      });
    } catch (err) {
      logger.error('Channel role update failed', {
        error: err.message,
        userId: req.user.userId,
        channelId: req.params.channelId,
        targetUserId: req.params.userId
      });
      return res.status(500).json({ error: 'Failed to update channel role' });
    }
  });
}

module.exports = registerChannelRoutes;
