const revokedTokens = new Map();

function decodeJwtExpiryMs(token) {
  try {
    const payloadPart = String(token || '').split('.')[1];
    if (!payloadPart) return null;
    const json = Buffer.from(payloadPart, 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp) || exp <= 0) return null;
    return exp * 1000;
  } catch {
    return null;
  }
}

function cleanupExpired(nowMs = Date.now()) {
  revokedTokens.forEach((expiresAt, token) => {
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
      revokedTokens.delete(token);
    }
  });
}

function revokeToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return;
  cleanupExpired();
  const expiresAt = decodeJwtExpiryMs(normalized) || Date.now() + 24 * 60 * 60 * 1000;
  revokedTokens.set(normalized, expiresAt);
}

function isTokenRevoked(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return false;
  const expiresAt = revokedTokens.get(normalized);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    revokedTokens.delete(normalized);
    return false;
  }
  return true;
}

module.exports = {
  revokeToken,
  isTokenRevoked
};
