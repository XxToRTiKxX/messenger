const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');
const { TextDecoder } = require('util');

const MAX_REPLAY_WINDOW_MS = 60 * 1000;
const MAX_TRACKED_NONCES = 4096;
const RPC_CRYPTO_CONTEXT = 'ws-rpc-v1';
const RPC_CRYPTO_ALGORITHM = 'aes-256-gcm';
const RPC_ECDH_CURVE = 'prime256v1';
const RPC_BINARY_MAGIC = Buffer.from('WSE1', 'ascii');
const RPC_BINARY_VERSION = 1;
const RPC_BINARY_TYPE_REQUEST = 1;
const RPC_BINARY_TYPE_SERVER = 2;
const RPC_BOOTSTRAP_SESSION_ID = 'bootstrap';
const RPC_BOOTSTRAP_ENVELOPE_TYPE = 'ws_bootstrap';
const textDecoder = new TextDecoder('utf-8');

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return null;

  const cookieArray = cookieHeader.split(';');
  for (const cookie of cookieArray) {
    const separator = cookie.indexOf('=');
    if (separator <= 0) continue;
    const name = cookie.slice(0, separator).trim();
    const value = cookie.slice(separator + 1).trim();
    if (!name) continue;
    cookies[name] = value;
  }

  return cookies;
}

function extractAuthToken(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  if (!cookies) return null;
  return cookies.auth_token || null;
}

function isSafeRpcPath(pathname) {
  if (!pathname || typeof pathname !== 'string') return false;
  if (!pathname.startsWith('/')) return false;
  if (pathname.includes('://')) return false;

  return pathname.startsWith('/api/') || pathname.startsWith('/auth/') || pathname.startsWith('/admin/api/');
}

function parseMethod(rawMethod) {
  const method = String(rawMethod || 'GET').toUpperCase();
  if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return method;
  }
  return null;
}

function sendJson(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (typeof ws.__sendStamped !== 'function') {
    return;
  }
  ws.__sendStamped(payload);
}

function isTlsRequest(req, config) {
  if (req.socket && req.socket.encrypted) return true;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || req.headers['x-forwarded-scheme'] || req.headers['x-url-scheme'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwardedProto === 'https' || forwardedProto === 'wss') return true;

  const frontEndHttps = String(req.headers['front-end-https'] || '').toLowerCase();
  if (frontEndHttps === 'on') return true;

  const cfVisitor = String(req.headers['cf-visitor'] || '');
  if (cfVisitor.includes('"scheme":"https"')) return true;

  const origin = String(req.headers.origin || '').toLowerCase();
  if (origin.startsWith('https://')) return true;

  return !config.ws.requireTls;
}

function validateReplayMeta(payload, state) {
  const seq = Number(payload?.seq);
  const ts = Number(payload?.ts);
  const nonce = String(payload?.nonce || '');

  if (!Number.isInteger(seq) || seq <= 0) return false;
  if (!Number.isFinite(ts) || ts <= 0) return false;
  if (!nonce || nonce.length < 12 || nonce.length > 200) return false;

  const now = Date.now();
  if (Math.abs(now - ts) > MAX_REPLAY_WINDOW_MS) return false;
  if (seq <= state.lastSeq) return false;
  if (state.seenNonces.has(nonce)) return false;

  state.lastSeq = seq;
  state.seenNonces.add(nonce);
  if (state.seenNonces.size > MAX_TRACKED_NONCES) {
    const first = state.seenNonces.values().next().value;
    if (first) state.seenNonces.delete(first);
  }

  return true;
}

function readMessageText(rawMessage) {
  if (typeof rawMessage === 'string') return rawMessage;
  if (Buffer.isBuffer(rawMessage)) return textDecoder.decode(rawMessage);
  if (rawMessage instanceof ArrayBuffer) return textDecoder.decode(Buffer.from(rawMessage));
  if (ArrayBuffer.isView(rawMessage)) return textDecoder.decode(Buffer.from(rawMessage.buffer, rawMessage.byteOffset, rawMessage.byteLength));
  return '';
}

function deriveRpcSessionKey(sharedSecret, sessionId) {
  return crypto
    .createHash('sha256')
    .update(sharedSecret)
    .update(':')
    .update(String(sessionId || ''))
    .update(':')
    .update(RPC_CRYPTO_CONTEXT)
    .digest();
}

function deriveBootstrapKey(psk) {
  return crypto
    .createHash('sha256')
    .update('ws-bootstrap:')
    .update(String(psk || ''))
    .digest();
}

function createRpcAad(envelopeType, sessionId, meta = {}) {
  const seq = Number(meta?.seq || 0);
  const ts = Number(meta?.ts || 0);
  const nonce = String(meta?.nonce || '');
  return Buffer.from(
    `${RPC_CRYPTO_CONTEXT};type=${envelopeType};sessionId=${sessionId};seq=${seq};ts=${ts};nonce=${nonce}`,
    'utf8'
  );
}

function encryptRpcPayload(state, payload, envelopeType, meta = {}) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(RPC_CRYPTO_ALGORITHM, state.key, iv);
  const aad = createRpcAad(envelopeType, state.sessionId, meta);
  cipher.setAAD(aad);

  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    type: envelopeType,
    v: 1,
    seq: meta?.seq,
    ts: meta?.ts,
    nonce: meta?.nonce,
    iv: iv.toString('base64url'),
    data: Buffer.concat([encrypted, tag]).toString('base64url')
  };
}

function decryptRpcPayload(state, envelope, envelopeType, meta = {}) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Invalid encrypted envelope');
  }
  if (Number(envelope.v) !== 1) {
    throw new Error('Unsupported encrypted envelope version');
  }

  const iv = Buffer.from(String(envelope.iv || ''), 'base64url');
  const data = Buffer.from(String(envelope.data || ''), 'base64url');
  if (iv.length !== 12 || data.length <= 16) {
    throw new Error('Malformed encrypted envelope');
  }

  const tag = data.subarray(data.length - 16);
  const encrypted = data.subarray(0, data.length - 16);

  const decipher = crypto.createDecipheriv(RPC_CRYPTO_ALGORITHM, state.key, iv);
  const aad = createRpcAad(envelopeType, state.sessionId, meta);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function parseBinaryRpcEnvelope(rawMessage) {
  const buffer = Buffer.isBuffer(rawMessage)
    ? rawMessage
    : rawMessage instanceof ArrayBuffer
      ? Buffer.from(rawMessage)
      : ArrayBuffer.isView(rawMessage)
        ? Buffer.from(rawMessage.buffer, rawMessage.byteOffset, rawMessage.byteLength)
        : null;

  if (!buffer) return null;
  if (buffer.length < 46) return null;
  if (!buffer.subarray(0, 4).equals(RPC_BINARY_MAGIC)) return null;

  const version = buffer.readUInt8(4);
  const envelopeType = buffer.readUInt8(5);
  if (version !== RPC_BINARY_VERSION || envelopeType !== RPC_BINARY_TYPE_REQUEST) return null;

  const seq = buffer.readUInt32BE(6);
  const ts = Number(buffer.readBigUInt64BE(10));
  const nonce = buffer.subarray(18, 34);
  const iv = buffer.subarray(34, 46);
  const data = buffer.subarray(46);

  if (nonce.length !== 16 || iv.length !== 12 || data.length <= 16) return null;

  return {
    seq,
    ts,
    nonce: nonce.toString('base64url'),
    iv,
    data
  };
}

function encryptBinaryPayload(state, payload, envelopeType, binaryType, meta) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(RPC_CRYPTO_ALGORITHM, state.key, iv);
  const aad = createRpcAad(envelopeType, state.sessionId, meta);
  cipher.setAAD(aad);

  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  const nonceBytes = Buffer.from(String(meta?.nonce || ''), 'base64url');
  if (nonceBytes.length !== 16) {
    throw new Error('Invalid nonce length for binary envelope');
  }

  const header = Buffer.alloc(46);
  RPC_BINARY_MAGIC.copy(header, 0);
  header.writeUInt8(RPC_BINARY_VERSION, 4);
  header.writeUInt8(binaryType, 5);
  header.writeUInt32BE(Number(meta?.seq || 0), 6);
  header.writeBigUInt64BE(BigInt(Number(meta?.ts || 0)), 10);
  nonceBytes.copy(header, 18);
  iv.copy(header, 34);

  return Buffer.concat([header, encrypted, tag]);
}

function decryptBinaryRpcPayload(state, envelope, envelopeType, meta = {}) {
  if (!envelope || !Buffer.isBuffer(envelope.iv) || !Buffer.isBuffer(envelope.data)) {
    throw new Error('Invalid binary encrypted envelope');
  }

  const iv = envelope.iv;
  const data = envelope.data;
  if (iv.length !== 12 || data.length <= 16) {
    throw new Error('Malformed binary encrypted envelope');
  }

  const tag = data.subarray(data.length - 16);
  const encrypted = data.subarray(0, data.length - 16);

  const decipher = crypto.createDecipheriv(RPC_CRYPTO_ALGORITHM, state.key, iv);
  const aad = createRpcAad(envelopeType, state.sessionId, meta);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

async function handleRpcRequest(ws, payload, context) {
  const { logger, config, cookieHeader, userId, getAdminToken, setAdminToken } = context;
  const requestId = typeof payload.id === 'string' ? payload.id : null;
  if (!requestId) return;

  const method = parseMethod(payload.method);
  const pathname = typeof payload.path === 'string' ? payload.path : '';

  if (!method || !isSafeRpcPath(pathname)) {
    sendJson(ws, {
      type: 'rpc_response',
      id: requestId,
      status: 400,
      ok: false,
      error: 'Invalid RPC request'
    });
    return;
  }

  try {
    const adminToken = getAdminToken();
    const cookieParts = [];
    if (cookieHeader) cookieParts.push(cookieHeader);
    if (adminToken) cookieParts.push(`admin_token=${adminToken}`);
    const rpcCookieHeader = cookieParts.join('; ');

    const response = await axios({
      method,
      url: `http://127.0.0.1:${config.port}${pathname}`,
      headers: {
        Accept: 'application/json',
        Cookie: rpcCookieHeader,
        'X-WS-RPC': '1'
      },
      data: payload.body,
      validateStatus: () => true,
      timeout: 15000
    });

    const status = Number(response.status || 500);
    const ok = status >= 200 && status < 300;
    const data = status === 204 || typeof response.data === 'undefined' || response.data === '' ? null : response.data;

    let error = null;
    if (!ok) {
      if (data && typeof data === 'object' && typeof data.error === 'string') {
        error = data.error;
      } else if (typeof data === 'string' && data.trim()) {
        error = data;
      } else {
        error = `HTTP ${status}`;
      }
    }

    if (pathname === '/admin/api/login' && method === 'POST' && ok) {
      const login = String(payload?.body?.login || '').trim();
      if (login) {
        const token = jwt.sign(
          {
            role: 'admin',
            login
          },
          config.jwt.secret,
          { expiresIn: config.jwt.expiresIn }
        );
        setAdminToken(token);
      }
    }

    if (pathname === '/admin/api/logout' && method === 'POST' && ok) {
      setAdminToken(null);
    }

    sendJson(ws, {
      type: 'rpc_response',
      id: requestId,
      status,
      ok,
      data,
      error
    });
  } catch (error) {
    logger.error('WebSocket RPC request failed', {
      userId: userId || null,
      method,
      path: pathname,
      error: error.message
    });

    sendJson(ws, {
      type: 'rpc_response',
      id: requestId,
      status: 500,
      ok: false,
      error: 'Internal server error'
    });
  }
}

function setupWebsocketServer(server, { logger, config, onClientsUpdate }) {
  const clients = new Map();
  const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024
  });

  const notifyClientsUpdate = () => {
    if (typeof onClientsUpdate === 'function') {
      onClientsUpdate(clients);
    }
  };

  wss.on('connection', (ws, req) => {
    if (!isTlsRequest(req, config)) {
      logger.warn('Rejected non-TLS WebSocket connection');
      ws.close(4006, 'WSS required');
      return;
    }

    logger.info('WebSocket connection established', {
      ip: req.socket.remoteAddress
    });

    const replayState = {
      lastSeq: 0,
      seenNonces: new Set()
    };
    let outboundSeq = 0;

    const rpcEcdh = crypto.createECDH(RPC_ECDH_CURVE);
    rpcEcdh.generateKeys();
    const bootstrapCryptoState = {
      sessionId: RPC_BOOTSTRAP_SESSION_ID,
      key: deriveBootstrapKey(config.ws.bootstrapPsk)
    };
    const rpcCryptoState = {
      sessionId: crypto.randomUUID(),
      key: null
    };

    ws.__sendStamped = (payload) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      outboundSeq += 1;
      const stampedPayload = {
        ...payload,
        seq: outboundSeq,
        ts: Date.now()
      };

      const activeCryptoState = rpcCryptoState.key ? rpcCryptoState : bootstrapCryptoState;
      const activeEnvelopeType = rpcCryptoState.key ? 'ws_encrypted' : RPC_BOOTSTRAP_ENVELOPE_TYPE;
      if (activeCryptoState.key) {
        const nonceBytes = crypto.randomBytes(16);
        const meta = {
          seq: outboundSeq,
          ts: stampedPayload.ts,
          nonce: nonceBytes.toString('base64url')
        };
        const encryptedBinary = encryptBinaryPayload(
          activeCryptoState,
          stampedPayload,
          activeEnvelopeType,
          RPC_BINARY_TYPE_SERVER,
          meta
        );
        ws.send(encryptedBinary);
        return;
      }

      const serialized = JSON.stringify(stampedPayload);
      ws.send(serialized);
    };

    const cookieHeader = req.headers.cookie || '';
    const authToken = extractAuthToken(cookieHeader);
    let userId = null;
    let username = null;
    let adminToken = null;

    sendJson(ws, {
      type: 'crypto_hello',
      v: 1,
      sessionId: rpcCryptoState.sessionId,
      serverPublicKey: rpcEcdh.getPublicKey().toString('base64url')
    });

    if (authToken) {
      try {
        const decoded = jwt.verify(authToken, config.jwt.secret);
        userId = decoded.userId;
        username = decoded.username;

        const userKey = String(userId);
        const userConnections = clients.get(userKey) || new Set();
        userConnections.add(ws);
        clients.set(userKey, userConnections);
        notifyClientsUpdate();

        logger.info('WebSocket authenticated', { userId });

        sendJson(ws, {
          type: 'authenticated',
          userId,
          username
        });
      } catch (err) {
        logger.error('WebSocket authentication failed', {
          error: err.message
        });
        ws.close(4002, 'Authentication failed');
        return;
      }
    } else {
      logger.debug('WebSocket connected without auth token');
    }

    ws.on('message', (rawMessage) => {
      const binaryEnvelope = parseBinaryRpcEnvelope(rawMessage);
      if (binaryEnvelope) {
        if (!validateReplayMeta(binaryEnvelope, replayState)) {
          ws.close(4008, 'Replay detected');
          return;
        }

        let decryptedPayload;
        const meta = {
          seq: binaryEnvelope.seq,
          ts: binaryEnvelope.ts,
          nonce: binaryEnvelope.nonce
        };
        try {
          if (rpcCryptoState.key) {
            decryptedPayload = decryptBinaryRpcPayload(rpcCryptoState, binaryEnvelope, 'rpc_encrypted', meta);
          }
        } catch (_error) {
          decryptedPayload = null;
        }
        if (!decryptedPayload) {
          try {
            decryptedPayload = decryptBinaryRpcPayload(bootstrapCryptoState, binaryEnvelope, RPC_BOOTSTRAP_ENVELOPE_TYPE, meta);
          } catch {
            decryptedPayload = null;
          }
        }
        if (!decryptedPayload || typeof decryptedPayload !== 'object') {
          ws.close(4003, 'Protocol error');
          return;
        }

        if (decryptedPayload.type === 'crypto_client_hello') {
          try {
            const clientPublicKey = Buffer.from(String(decryptedPayload.clientPublicKey || ''), 'base64url');
            if (!clientPublicKey.length) {
              ws.close(4003, 'Protocol error');
              return;
            }
            const sharedSecret = rpcEcdh.computeSecret(clientPublicKey);
            rpcCryptoState.key = deriveRpcSessionKey(sharedSecret, rpcCryptoState.sessionId);
            sendJson(ws, {
              type: 'crypto_ready',
              v: 1
            });
          } catch (error) {
            logger.warn('WebSocket crypto handshake failed', {
              error: error.message
            });
            ws.close(4003, 'Protocol error');
          }
          return;
        }

        if (decryptedPayload.type !== 'rpc_request') {
          ws.close(4003, 'Protocol error');
          return;
        }
        if (!rpcCryptoState.key) {
          ws.close(4009, 'Encryption required');
          return;
        }

        void handleRpcRequest(ws, decryptedPayload, {
          logger,
          config,
          cookieHeader,
          userId,
          getAdminToken: () => adminToken,
          setAdminToken: (nextToken) => {
            adminToken = nextToken || null;
          }
        });
        return;
      }

      let payload = null;
      try {
        payload = JSON.parse(readMessageText(rawMessage));
      } catch {
        ws.close(4003, 'Protocol error');
        return;
      }

      if (!payload || typeof payload !== 'object') return;

      if (payload.type === 'crypto_client_hello' || payload.type === 'rpc_request' || payload.type === 'rpc_encrypted') {
        ws.close(4009, 'Encryption required');
        return;
      }

      logger.debug('WebSocket message received', {
        userId: userId || null,
        type: payload.type || 'unknown'
      });
    });

    ws.on('close', () => {
      logger.info('WebSocket connection closed', {
        userId: userId || null
      });
      if (userId) {
        const userKey = String(userId);
        const userConnections = clients.get(userKey);
        if (userConnections instanceof Set) {
          userConnections.delete(ws);
          if (userConnections.size === 0) {
            clients.delete(userKey);
          } else {
            clients.set(userKey, userConnections);
          }
          notifyClientsUpdate();
        }
      }
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error', {
        userId: userId || null,
        error: error.message
      });
    });
  });

  notifyClientsUpdate();
  return { wss, clients };
}

module.exports = setupWebsocketServer;
