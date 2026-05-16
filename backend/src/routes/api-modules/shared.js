const crypto = require('crypto');

const VALID_CHANNEL_ROLES = new Set(['creator', 'owner', 'admin', 'moderator', 'member', 'muted']);
const ROLE_POWER = {
  muted: 1,
  member: 2,
  owner: 2,
  moderator: 3,
  admin: 4,
  creator: 5
};

function createShared({ query, config }) {
  function getBaseUrl(req) {
    const proto = (req.get('x-forwarded-proto') || 'https').split(',')[0].trim();
    const configuredDomain = String(config?.domain || '').trim();
    const configuredHost = configuredDomain.replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
    const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
    const requestHost = String(req.get('host') || '').trim();
    const host = configuredHost && configuredHost !== 'localhost' ? configuredHost : (forwardedHost || requestHost);
    return `${proto}://${host}`;
  }

  function generateInviteCode() {
    return crypto.randomBytes(12).toString('base64url');
  }

  function normalizeChannelName(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40);
  }

  function getEffectiveRole(serverRole, channelRole) {
    const sr = ROLE_POWER[serverRole] || 0;
    const cr = ROLE_POWER[channelRole] || 0;
    return sr >= cr ? serverRole : channelRole;
  }

  function canManageServer(role) {
    return role === 'creator' || role === 'admin';
  }

  function canManageChannelRoles(context) {
    return context.effectiveRole === 'creator' || context.effectiveRole === 'admin';
  }

  async function getUserByUsername(username) {
    const result = await query(
      `SELECT id, username, email
       FROM users
       WHERE lower(username) = lower($1)
         AND registration_status = 'active'
         AND is_approved = TRUE
       LIMIT 1`,
      [username]
    );
    return result.rows[0] || null;
  }

  async function areUsersFriends(userIdA, userIdB) {
    const result = await query(
      `SELECT 1
       FROM friendships
       WHERE status = 'accepted'
         AND (
           (requester_id = $1 AND addressee_id = $2)
           OR
           (requester_id = $2 AND addressee_id = $1)
         )
       LIMIT 1`,
      [userIdA, userIdB]
    );
    return !!result.rows[0];
  }

  async function getChannelContext(channelId, requesterUserId) {
    const result = await query(
      `SELECT c.id AS "channelId",
              c.server_id AS "serverId",
              COALESCE(sp.role, 'none') AS "serverRole",
              COALESCE(cp.role, 'member') AS "channelRole"
       FROM channels c
       LEFT JOIN server_participants sp
         ON sp.server_id = c.server_id
        AND sp.user_id = $2
       LEFT JOIN channel_participants cp
         ON cp.channel_id = c.id
        AND cp.user_id = $2
       WHERE c.id = $1
       LIMIT 1`,
      [channelId, requesterUserId]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      ...row,
      hasServerAccess: row.serverRole !== 'none',
      effectiveRole: getEffectiveRole(row.serverRole, row.channelRole)
    };
  }

  async function ensureUserHasServerAccess(serverId, userId) {
    const accessResult = await query(
      `SELECT role
       FROM server_participants
       WHERE server_id = $1 AND user_id = $2
       LIMIT 1`,
      [serverId, userId]
    );

    if (!accessResult.rows[0]) {
      return null;
    }

    return accessResult.rows[0].role;
  }

  async function loadUserRoleLabels(serverId, userId) {
    const serverRole = await ensureUserHasServerAccess(serverId, userId);
    if (!serverRole) return [];
    const roleResult = await query(
      `SELECT sr.name
       FROM server_member_roles smr
       JOIN server_roles sr
         ON sr.id = smr.role_id
       WHERE smr.server_id = $1
         AND smr.user_id = $2
       ORDER BY sr.created_at ASC`,
      [serverId, userId]
    );
    return [...new Set([serverRole, ...roleResult.rows.map((row) => row.name).filter(Boolean)])];
  }

  return {
    VALID_CHANNEL_ROLES,
    ROLE_POWER,
    getBaseUrl,
    generateInviteCode,
    normalizeChannelName,
    canManageServer,
    canManageChannelRoles,
    getUserByUsername,
    areUsersFriends,
    getChannelContext,
    ensureUserHasServerAccess,
    loadUserRoleLabels
  };
}

module.exports = createShared;
