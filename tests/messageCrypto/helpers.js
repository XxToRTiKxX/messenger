const TEST_KEY_ID = 'v1';
const TEST_KEY_BUFFER = Buffer.alloc(32, 7);
const TEST_KEY_B64 = TEST_KEY_BUFFER.toString('base64');

function createLoggerMock() {
  return {
    warn: () => {},
    info: () => {},
    error: () => {}
  };
}

function createConfig(overrides = {}) {
  return {
    message: {
      encryptionKeys: `${TEST_KEY_ID}:${TEST_KEY_B64}`,
      activeKeyId: TEST_KEY_ID,
      ...overrides
    }
  };
}

function normalizeCreatedAt(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function buildServerContext(overrides = {}) {
  return {
    messageId: 'm-server-1',
    serverId: 's-1',
    channelId: 'c-1',
    userId: 'u-1',
    type: 'server_message',
    createdAt: normalizeCreatedAt('2026-01-01T00:00:00.000Z'),
    ...overrides
  };
}

function buildDmContext(overrides = {}) {
  return {
    messageId: 'm-dm-1',
    senderId: 'u-1',
    recipientId: 'u-2',
    type: 'dm_message',
    createdAt: normalizeCreatedAt('2026-01-01T00:00:00.000Z'),
    ...overrides
  };
}

module.exports = {
  TEST_KEY_ID,
  TEST_KEY_BUFFER,
  TEST_KEY_B64,
  createLoggerMock,
  createConfig,
  buildServerContext,
  buildDmContext
};
