type WsEventPayload = Record<string, unknown> & { type?: string };

type WsRpcRequest = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
};

type WsRpcEnvelope = WsRpcRequest & {
  type: 'rpc_request';
  id: string;
  seq: number;
  ts: number;
  nonce: string;
};

type WsRpcEncryptedResponseEnvelope = {
  type: 'rpc_encrypted_response';
  v: 1;
  iv: string;
  data: string;
};

type WsCryptoHelloEnvelope = {
  type: 'crypto_hello';
  v: 1;
  sessionId: string;
  serverPublicKey: string;
};

type WsCryptoReadyEnvelope = {
  type: 'crypto_ready';
  v: 1;
};

type WsRpcResponse = {
  type: 'rpc_response';
  id: string;
  status?: number;
  ok?: boolean;
  data?: unknown;
  error?: unknown;
};

type PendingRequest = {
  resolve: (value: WsRpcResponse) => void;
  reject: (reason?: unknown) => void;
  timer: number;
};

type EventListener = (payload: WsEventPayload) => void;

const REQUEST_TIMEOUT_MS = 15000;
const RPC_CRYPTO_HANDSHAKE_TIMEOUT_MS = 5000;
const RPC_CRYPTO_CONTEXT = 'ws-rpc-v1';
const RPC_BINARY_MAGIC = 'WSE1';
const RPC_BINARY_VERSION = 1;
const RPC_BINARY_TYPE_REQUEST = 1;
const RPC_BINARY_TYPE_SERVER = 2;
const RPC_BOOTSTRAP_SESSION_ID = 'bootstrap';
const RPC_BOOTSTRAP_ENVELOPE_TYPE = 'ws_bootstrap';
const WS_BOOTSTRAP_PSK = import.meta.env.VITE_WS_BOOTSTRAP_PSK || 'dev-ws-bootstrap-psk';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

class WsClient {
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: number | null = null;
  private listeners = new Set<EventListener>();
  private pending = new Map<string, PendingRequest>();
  private reconnectDelayMs = 1000;
  private preferredPath: '/ws' | '/' = '/';
  private outboundSeq = 0;
  private rpcCryptoKey: CryptoKey | null = null;
  private rpcCryptoSessionId: string | null = null;
  private rpcCryptoReadyPromise: Promise<void> | null = null;
  private resolveRpcCryptoReady: (() => void) | null = null;
  private rejectRpcCryptoReady: ((reason?: unknown) => void) | null = null;
  private cryptoHelloHandled = false;
  private bootstrapCryptoKey: CryptoKey | null = null;

  async connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<void>(async (resolve, reject) => {
      try {
        await this.ensureBootstrapKey();
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        if (protocol !== 'wss:' && !this.isLocalhost()) {
          throw new Error('WSS is required');
        }
        const baseUrl = `${protocol}//${window.location.host}`;
        const paths: Array<'/ws' | '/'> = this.preferredPath === '/' ? ['/', '/ws'] : ['/ws', '/'];
        let lastError: Error | null = null;

        for (const path of paths) {
          try {
            const ws = await this.openSocket(`${baseUrl}${path}`);
            this.socket = ws;
            this.preferredPath = path;
            this.connecting = null;
            this.reconnectDelayMs = 1000;
            resolve();
            return;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error('WebSocket connection failed');
          }
        }

        this.connecting = null;
        reject(lastError || new Error('WebSocket connection failed'));
      } catch (error) {
        this.connecting = null;
        reject(error instanceof Error ? error : new Error('WebSocket connection failed'));
      }
    });

    return this.connecting;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    void this.connect().catch(() => {
      // Next request/reconnect cycle will retry.
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  async request(request: WsRpcRequest): Promise<WsRpcResponse> {
    await this.connect();
    await this.waitForRpcCrypto();

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const id = this.generateRequestId();
    const meta = this.nextOutboundMeta();
    const payload: WsRpcEnvelope = {
      type: 'rpc_request',
      id,
      method: String(request.method || 'GET').toUpperCase(),
      path: request.path,
      headers: request.headers,
      body: request.body,
      seq: meta.seq,
      ts: meta.ts,
      nonce: meta.nonce
    };

    const responsePromise = new Promise<WsRpcResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('WebSocket request timeout'));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
    });

    const encrypted = await this.encryptRpcRequestBinary(payload, meta);
    this.socket.send(encrypted);
    return responsePromise;
  }

  private async handleMessage(raw: unknown, source: WebSocket): Promise<void> {
    if (this.socket !== source) return;

    const binaryEnvelope = this.parseBinaryEnvelope(raw);
    if (binaryEnvelope) {
      if (binaryEnvelope.type !== RPC_BINARY_TYPE_SERVER) return;
      const decrypted = await this.decryptBinaryInboundPayload(binaryEnvelope);
      if (!decrypted) return;
      if ((decrypted as { type?: unknown }).type === 'crypto_hello') {
        await this.handleCryptoHello(decrypted as WsCryptoHelloEnvelope);
        return;
      }
      if ((decrypted as { type?: unknown }).type === 'crypto_ready') {
        this.handleCryptoReady(decrypted as WsCryptoReadyEnvelope);
        return;
      }
      this.dispatchPayload(decrypted);
      return;
    }

    const text = await this.readMessageText(raw);
    if (!text) return;

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return;
    }

    if (!payload || typeof payload !== 'object') return;

    if ((payload as { type?: unknown }).type === 'crypto_hello') {
      await this.handleCryptoHello(payload as WsCryptoHelloEnvelope);
      return;
    }

    if ((payload as { type?: unknown }).type === 'crypto_ready') {
      this.handleCryptoReady(payload as WsCryptoReadyEnvelope);
      return;
    }

    if ((payload as { type?: unknown }).type === 'rpc_encrypted_response') {
      payload = await this.decryptRpcResponse(payload as WsRpcEncryptedResponseEnvelope);
      if (!payload) return;
    }

    this.dispatchPayload(payload);
  }

  private handleClose(code: number, source: WebSocket): void {
    if (this.socket !== source) return;
    this.socket = null;
    this.connecting = null;
    this.failRpcCryptoHandshake(new Error('WebSocket disconnected'));

    this.pending.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('WebSocket disconnected'));
    });
    this.pending.clear();

    if (code === 4001 || code === 4002) {
      window.location.href = '/auth/';
      return;
    }

    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 10000);
        if (this.reconnectTimer != null) {
          window.clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          void this.connect().catch(() => {
            // Retry loop continues with exponential backoff.
          });
        }, this.reconnectDelayMs);
      });
    }, this.reconnectDelayMs);
  }

  private generateRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private generateNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
  }

  private nextOutboundMeta(): { seq: number; ts: number; nonce: string } {
    this.outboundSeq += 1;
    return {
      seq: this.outboundSeq,
      ts: Date.now(),
      nonce: this.generateNonce()
    };
  }

  private isLocalhost(): boolean {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  private openSocket(url: string): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url);

      const cleanup = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
      };

      const onOpen = () => {
        cleanup();
        this.resetRpcCryptoHandshake();
        ws.binaryType = 'arraybuffer';
        ws.addEventListener('message', (event) => {
          void this.handleMessage(event.data, ws);
        });
        ws.addEventListener('close', (event) => {
          this.handleClose(event.code, ws);
        });
        resolve(ws);
      };

      const onError = () => {
        cleanup();
        try {
          ws.close();
        } catch {
          // Ignore close errors for failed handshake.
        }
        reject(new Error('WebSocket connection failed'));
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
    });
  }

  private async readMessageText(raw: unknown): Promise<string> {
    if (typeof raw === 'string') return raw;
    if (raw instanceof ArrayBuffer) {
      return textDecoder.decode(new Uint8Array(raw));
    }
    if (raw instanceof Blob) {
      return raw.text();
    }
    return '';
  }

  private resetRpcCryptoHandshake(): void {
    this.rpcCryptoKey = null;
    this.rpcCryptoSessionId = null;
    this.cryptoHelloHandled = false;
    this.outboundSeq = 0;
    this.rpcCryptoReadyPromise = new Promise<void>((resolve, reject) => {
      this.resolveRpcCryptoReady = resolve;
      this.rejectRpcCryptoReady = reject;
    });
  }

  private async ensureBootstrapKey(): Promise<void> {
    if (this.bootstrapCryptoKey) return;
    const material = textEncoder.encode(`ws-bootstrap:${WS_BOOTSTRAP_PSK}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', material));
    this.bootstrapCryptoKey = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  private completeRpcCryptoHandshake(): void {
    if (!this.rpcCryptoKey || !this.rpcCryptoSessionId) return;
    if (this.resolveRpcCryptoReady) {
      this.resolveRpcCryptoReady();
      this.resolveRpcCryptoReady = null;
      this.rejectRpcCryptoReady = null;
    }
  }

  private failRpcCryptoHandshake(reason: unknown): void {
    this.rpcCryptoKey = null;
    this.rpcCryptoSessionId = null;
    this.cryptoHelloHandled = false;
    if (this.rejectRpcCryptoReady) {
      this.rejectRpcCryptoReady(reason);
      this.resolveRpcCryptoReady = null;
      this.rejectRpcCryptoReady = null;
    }
  }

  private async waitForRpcCrypto(): Promise<void> {
    if (this.rpcCryptoKey && this.rpcCryptoSessionId) return;
    if (!this.rpcCryptoReadyPromise) {
      throw new Error('RPC encryption is not initialized');
    }

    let timeoutId = 0;
    try {
      await Promise.race([
        this.rpcCryptoReadyPromise,
        new Promise<void>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error('RPC encryption handshake timeout'));
          }, RPC_CRYPTO_HANDSHAKE_TIMEOUT_MS);
        })
      ]);
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }

    if (!this.rpcCryptoKey || !this.rpcCryptoSessionId) {
      throw new Error('RPC encryption handshake failed');
    }
  }

  private async handleCryptoHello(payload: WsCryptoHelloEnvelope): Promise<void> {
    if (payload.v !== 1 || typeof payload.sessionId !== 'string' || typeof payload.serverPublicKey !== 'string') {
      this.failRpcCryptoHandshake(new Error('Invalid crypto handshake payload'));
      return;
    }
    if (this.cryptoHelloHandled) return;
    this.cryptoHelloHandled = true;
    try {
      this.rpcCryptoSessionId = payload.sessionId;
      const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const serverPublicKey = await crypto.subtle.importKey(
        'raw',
        base64UrlToBytes(payload.serverPublicKey),
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
      );
      const sharedBits = await crypto.subtle.deriveBits(
        {
          name: 'ECDH',
          public: serverPublicKey
        },
        keyPair.privateKey,
        256
      );
      const shared = new Uint8Array(sharedBits);
      const salted = concatUint8Arrays([
        shared,
        textEncoder.encode(':'),
        textEncoder.encode(payload.sessionId),
        textEncoder.encode(':'),
        textEncoder.encode(RPC_CRYPTO_CONTEXT)
      ]);
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', salted));
      this.rpcCryptoKey = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
      const clientPublicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        this.failRpcCryptoHandshake(new Error('WebSocket is not connected'));
        return;
      }
      await this.ensureBootstrapKey();
      if (!this.bootstrapCryptoKey) {
        throw new Error('Bootstrap key is not initialized');
      }
      const meta = this.nextOutboundMeta();
      const encrypted = await this.encryptBinaryPayload(
        this.bootstrapCryptoKey,
        RPC_BOOTSTRAP_SESSION_ID,
        RPC_BOOTSTRAP_ENVELOPE_TYPE,
        RPC_BINARY_TYPE_REQUEST,
        {
          type: 'crypto_client_hello',
          v: 1,
          clientPublicKey: bytesToBase64Url(new Uint8Array(clientPublicKeyRaw))
        },
        meta
      );
      this.socket.send(encrypted);
    } catch (error) {
      this.failRpcCryptoHandshake(error instanceof Error ? error : new Error('RPC encryption handshake failed'));
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.close(4003, 'Protocol error');
      }
    }
  }

  private async encryptRpcRequestBinary(payload: WsRpcEnvelope, meta: { seq: number; ts: number; nonce: string }): Promise<ArrayBuffer> {
    if (!this.rpcCryptoKey || !this.rpcCryptoSessionId) {
      throw new Error('RPC encryption key is not ready');
    }
    return this.encryptBinaryPayload(
      this.rpcCryptoKey,
      this.rpcCryptoSessionId,
      'rpc_encrypted',
      RPC_BINARY_TYPE_REQUEST,
      payload,
      meta
    );
  }

  private async encryptBinaryPayload(
    key: CryptoKey,
    sessionId: string,
    envelopeType: string,
    binaryType: number,
    payload: unknown,
    meta: { seq: number; ts: number; nonce: string }
  ): Promise<ArrayBuffer> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const nonceBytes = base64UrlToBytes(meta.nonce);
    const aad = textEncoder.encode(
      `${RPC_CRYPTO_CONTEXT};type=${envelopeType};sessionId=${sessionId};seq=${meta.seq};ts=${meta.ts};nonce=${meta.nonce}`
    );
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, textEncoder.encode(JSON.stringify(payload)))
    );

    const header = new Uint8Array(46);
    header.set(textEncoder.encode(RPC_BINARY_MAGIC), 0);
    header[4] = RPC_BINARY_VERSION;
    header[5] = binaryType;

    const view = new DataView(header.buffer);
    view.setUint32(6, meta.seq, false);
    view.setBigUint64(10, BigInt(meta.ts), false);

    if (nonceBytes.length !== 16) {
      throw new Error('Nonce length is invalid');
    }
    header.set(nonceBytes, 18);
    header.set(iv, 34);

    return concatUint8Arrays([header, encrypted]).buffer;
  }

  private parseBinaryEnvelope(raw: unknown): {
    type: number;
    seq: number;
    ts: number;
    nonce: string;
    iv: Uint8Array;
    data: Uint8Array;
  } | null {
    if (!(raw instanceof ArrayBuffer)) return null;
    const bytes = new Uint8Array(raw);
    if (bytes.length < 46) return null;
    const magic = textDecoder.decode(bytes.subarray(0, 4));
    if (magic !== RPC_BINARY_MAGIC) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint8(4);
    const type = view.getUint8(5);
    if (version !== RPC_BINARY_VERSION) return null;
    const seq = view.getUint32(6, false);
    const tsBig = view.getBigUint64(10, false);
    const ts = Number(tsBig);
    const nonceBytes = bytes.subarray(18, 34);
    const iv = bytes.subarray(34, 46);
    const data = bytes.subarray(46);
    if (nonceBytes.length !== 16 || iv.length !== 12 || data.length <= 16) return null;

    return {
      type,
      seq,
      ts,
      nonce: bytesToBase64Url(nonceBytes),
      iv: new Uint8Array(iv),
      data: new Uint8Array(data)
    };
  }

  private async decryptBinaryInboundPayload(envelope: {
    seq: number;
    ts: number;
    nonce: string;
    iv: Uint8Array;
    data: Uint8Array;
  }): Promise<unknown | null> {
    const candidates: Array<{ key: CryptoKey | null; sessionId: string; envelopeType: string }> = [];
    if (this.rpcCryptoKey && this.rpcCryptoSessionId) {
      candidates.push({
        key: this.rpcCryptoKey,
        sessionId: this.rpcCryptoSessionId,
        envelopeType: 'ws_encrypted'
      });
    }
    if (this.bootstrapCryptoKey) {
      candidates.push({
        key: this.bootstrapCryptoKey,
        sessionId: RPC_BOOTSTRAP_SESSION_ID,
        envelopeType: RPC_BOOTSTRAP_ENVELOPE_TYPE
      });
    }

    for (const candidate of candidates) {
      if (!candidate.key) continue;
      try {
        const aad = textEncoder.encode(
          `${RPC_CRYPTO_CONTEXT};type=${candidate.envelopeType};sessionId=${candidate.sessionId};seq=${envelope.seq};ts=${envelope.ts};nonce=${envelope.nonce}`
        );
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: envelope.iv, additionalData: aad },
          candidate.key,
          envelope.data
        );
        return JSON.parse(textDecoder.decode(new Uint8Array(plain)));
      } catch {
        // Try next key/context candidate.
      }
    }

    return null;
  }

  private async decryptRpcResponse(payload: WsRpcEncryptedResponseEnvelope): Promise<WsRpcResponse | null> {
    if (payload.v !== 1) return null;
    if (!this.rpcCryptoKey || !this.rpcCryptoSessionId) return null;
    try {
      const iv = base64UrlToBytes(payload.iv);
      const data = base64UrlToBytes(payload.data);
      const aad = textEncoder.encode(
        `${RPC_CRYPTO_CONTEXT};type=rpc_encrypted_response;sessionId=${this.rpcCryptoSessionId};seq=0;ts=0;nonce=`
      );
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, this.rpcCryptoKey, data);
      return JSON.parse(textDecoder.decode(new Uint8Array(plain))) as WsRpcResponse;
    } catch {
      return null;
    }
  }

  private dispatchPayload(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;

    const message = payload as WsRpcResponse;
    if (message.type === 'rpc_response' && typeof message.id === 'string') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      window.clearTimeout(pending.timer);
      this.pending.delete(message.id);
      pending.resolve(message);
      return;
    }

    this.listeners.forEach((listener) => {
      try {
        listener(payload as WsEventPayload);
      } catch {
        // Event listener errors should not break websocket processing.
      }
    });
  }

  private handleCryptoReady(payload: WsCryptoReadyEnvelope): void {
    if (payload.v !== 1) {
      this.failRpcCryptoHandshake(new Error('Invalid crypto ready payload'));
      return;
    }
    this.completeRpcCryptoHandshake();
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    const part = bytes.subarray(index, Math.min(index + chunk, bytes.length));
    binary += String.fromCharCode(...part);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

export const wsClient = new WsClient();
