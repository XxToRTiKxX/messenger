const test = require('node:test');
const assert = require('node:assert/strict');

const createShared = require('../../backend/src/routes/api-modules/shared');

test('shared helpers: base URL, invite code, channel normalization and role checks', () => {
  const shared = createShared({ query: async () => ({ rows: [] }) });

  const req = {
    get: (header) => {
      if (header === 'x-forwarded-proto') return 'http';
      if (header === 'x-forwarded-host') return 'example.test';
      if (header === 'host') return 'fallback.test';
      return undefined;
    }
  };

  assert.equal(shared.getBaseUrl(req), 'http://example.test');

  const invite = shared.generateInviteCode();
  assert.equal(typeof invite, 'string');
  assert.ok(invite.length >= 16);

  assert.equal(shared.normalizeChannelName('  Dev News & Rules  '), 'dev-news--rules');
  assert.equal(shared.canManageServer('creator'), true);
  assert.equal(shared.canManageServer('admin'), true);
  assert.equal(shared.canManageServer('member'), false);

  assert.equal(shared.canManageChannelRoles({ effectiveRole: 'creator' }), true);
  assert.equal(shared.canManageChannelRoles({ effectiveRole: 'admin' }), true);
  assert.equal(shared.canManageChannelRoles({ effectiveRole: 'moderator' }), false);
});

test('shared DB functions: getUserByUsername, areUsersFriends, ensureUserHasServerAccess', async () => {
  const calls = [];
  const shared = createShared({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM users')) return { rows: [{ id: 'u1', username: 'Alice', email: 'a@test' }] };
      if (sql.includes('FROM friendships')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('FROM server_participants')) return { rows: [{ role: 'member' }] };
      return { rows: [] };
    }
  });

  const user = await shared.getUserByUsername('alice');
  const friends = await shared.areUsersFriends('u1', 'u2');
  const role = await shared.ensureUserHasServerAccess('s1', 'u1');

  assert.deepEqual(user, { id: 'u1', username: 'Alice', email: 'a@test' });
  assert.equal(friends, true);
  assert.equal(role, 'member');
  assert.equal(calls.length, 3);
});

test('getChannelContext returns null when channel missing and computes effectiveRole when present', async () => {
  let callIndex = 0;
  const shared = createShared({
    query: async () => {
      callIndex += 1;
      if (callIndex === 1) return { rows: [] };
      return {
        rows: [
          {
            channelId: 'c1',
            serverId: 's1',
            serverRole: 'member',
            channelRole: 'admin'
          }
        ]
      };
    }
  });

  const missing = await shared.getChannelContext('c-missing', 'u1');
  const found = await shared.getChannelContext('c1', 'u1');

  assert.equal(missing, null);
  assert.deepEqual(found, {
    channelId: 'c1',
    serverId: 's1',
    serverRole: 'member',
    channelRole: 'admin',
    hasServerAccess: true,
    effectiveRole: 'admin'
  });
});
