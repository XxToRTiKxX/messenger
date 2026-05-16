// messageCrypto.refactored.js

const crypto = require('crypto');

// ============================================================================
// 1. Константы (устранение магических чисел)
// ============================================================================
const ENVELOPE_PREFIX = 'enc:v3';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const MAC_LENGTH = 32;
const PADDED_PLAINTEXT_LENGTH = 4096;
const MAX_NONCE_CACHE_SIZE = 50000;  // предотвращает утечку памяти
const MAX_NONCE_ATTEMPTS = 8;        // попыток генерации уникального nonce

// ============================================================================
// 2. Собственные ошибки (вынесены на уровень модуля)
// ============================================================================
class DecryptionError extends Error {
  constructor() {
    super('DECRYPTION_FAILED');
    this.code = 'DECRYPTION_FAILED';
  }
}

// ============================================================================
// 3. Чистые утилиты (без побочных эффектов, легко тестировать)
// ============================================================================
function normalizeKeyMaterial(encoded) {
  const direct = Buffer.from(encoded, 'base64');
  if (direct.length === 32) return direct;
  
  // fallback для устаревших ключей (без логирования внутри)
  return crypto.createHash('sha256').update(encoded, 'utf8').digest();
}

function normalizeCreatedAt(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function packPlainText(content) {
  const bytes = Buffer.from(String(content || ''), 'utf8');
  if (bytes.length > PADDED_PLAINTEXT_LENGTH - 2) {
    throw new Error('Message exceeds encrypted payload size limit');
  }

  const payload = Buffer.alloc(PADDED_PLAINTEXT_LENGTH);
  payload.writeUInt16BE(bytes.length, 0);
  bytes.copy(payload, 2);
  
  if (bytes.length + 2 < PADDED_PLAINTEXT_LENGTH) {
    crypto.randomFillSync(payload, bytes.length + 2);
  }
  return payload;
}

function unpackPlainText(payload) {
  if (!Buffer.isBuffer(payload) || payload.length !== PADDED_PLAINTEXT_LENGTH) {
    throw new DecryptionError();
  }
  const length = payload.readUInt16BE(0);
  if (length < 0 || length > PADDED_PLAINTEXT_LENGTH - 2) {
    throw new DecryptionError();
  }
  return payload.subarray(2, 2 + length).toString('utf8');
}

// ============================================================================
// 4. Построение AAD (устранено дублирование)
// ============================================================================
function buildAadString(scope, context) {
  const commonFields = {
    scope: scope,
    messageId: String(context?.messageId || '')
  };

  // Серверный или DM контекст
  if (scope === 'server') {
    commonFields.serverId = String(context?.serverId || '');
    commonFields.channelId = String(context?.channelId || '');
    commonFields.userId = String(context?.userId || '');
  } else {
    commonFields.senderId = String(context?.senderId || '');
    commonFields.recipientId = String(context?.recipientId || '');
  }

  commonFields.type = String(context?.type || '');
  const createdAt = normalizeCreatedAt(context?.createdAt);
  if (createdAt) commonFields.createdAt = createdAt;

  return Buffer.from(
    Object.entries(commonFields)
      .map(([k, v]) => `${k}=${v}`)
      .join(';'),
    'utf8'
  );
}

function buildDerivationChecksum(scope, context) {
  const createdAt = normalizeCreatedAt(context?.createdAt);
  const parts = [
    `scope=${String(scope || '')}`,
    `messageId=${String(context?.messageId || '')}`,
    `type=${String(context?.type || '')}`,
    `createdAt=${createdAt}`
  ];

  if (scope === 'server') {
    parts.push(`serverId=${String(context?.serverId || '')}`);
    parts.push(`channelId=${String(context?.channelId || '')}`);
    parts.push(`userId=${String(context?.userId || '')}`);
  } else {
    parts.push(`senderId=${String(context?.senderId || '')}`);
    parts.push(`recipientId=${String(context?.recipientId || '')}`);
  }

  return crypto.createHash('sha256').update(parts.join(';'), 'utf8').digest();
}

function derivePerMessageKeys(keys, scope, context) {
  const checksum = buildDerivationChecksum(scope, context);
  const encKey = crypto
    .createHmac('sha256', keys.encKey)
    .update(Buffer.concat([Buffer.from('enc:v3:'), checksum]))
    .digest();
  const macKey = crypto
    .createHmac('sha256', keys.macKey)
    .update(Buffer.concat([Buffer.from('mac:v3:'), checksum]))
    .digest();

  return { encKey, macKey };
}

// ============================================================================
// 5. KeyRing — управление ключами (выделенная ответственность)
// ============================================================================
class KeyRing {
  constructor(keyConfig, logger) {
    this.keys = new Map();
    this.activeKeyId = '';
    this.logger = logger;
    
    this._parseKeyring(keyConfig);
  }

  _parseKeyring(rawConfig) {
    const source = String(rawConfig || '').trim();
    if (!source) return;

    source
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(entry => {
        const separator = entry.indexOf(':');
        if (separator <= 0) return;
        
        const keyId = entry.slice(0, separator).trim();
        const encoded = entry.slice(separator + 1).trim();
        if (!keyId || !encoded) return;

        const encKey = normalizeKeyMaterial(encoded);
        const macKey = crypto
          .createHash('sha256')
          .update(Buffer.concat([Buffer.from('mac:'), encKey]))
          .digest();
        
        this.keys.set(keyId, { encKey, macKey });
      });
  }

  setActiveKeyId(keyId) {
    if (!this.keys.has(keyId)) {
      throw new Error(`Active key "${keyId}" not found in keyring`);
    }
    this.activeKeyId = keyId;
  }

  get(keyId) {
    return this.keys.get(keyId);
  }

  getActive() {
    return this.get(this.activeKeyId);
  }

  getActiveKeyId() {
    return this.activeKeyId;
  }

  has(keyId) {
    return this.keys.has(keyId);
  }
}

// ============================================================================
// 6. NonceManager — управление уникальными nonce (без мутаций на уровне модуля)
// ============================================================================
class NonceManager {
  constructor() {
    this.usedNonces = new Map(); // keyId -> Set<nonceToken>
  }

  reserve(keyId) {
    const nonceSet = this.usedNonces.get(keyId) || new Set();
    
    for (let attempt = 0; attempt < MAX_NONCE_ATTEMPTS; attempt++) {
      const iv = crypto.randomBytes(IV_LENGTH);
      const nonceToken = iv.toString('base64url');
      
      if (!nonceSet.has(nonceToken)) {
        nonceSet.add(nonceToken);
        
        // Ограничиваем размер кэша
        if (nonceSet.size > MAX_NONCE_CACHE_SIZE) {
          const first = nonceSet.values().next().value;
          if (first) nonceSet.delete(first);
        }
        
        this.usedNonces.set(keyId, nonceSet);
        return iv;
      }
    }
    
    throw new Error('Failed to allocate unique nonce');
  }

  // Для тестирования
  reset(keyId = null) {
    if (keyId) {
      this.usedNonces.delete(keyId);
    } else {
      this.usedNonces.clear();
    }
  }
}

// ============================================================================
// 7. EnvelopeParser — парсинг и валидация конвертов (выделенная логика)
// ============================================================================
class EnvelopeParser {
  static parseV3(raw) {
    const parts = raw.split(':');
    if (parts.length !== 7) throw new DecryptionError();

    return {
      version: parts[0],
      keyId: parts[2],
      iv: Buffer.from(parts[3], 'base64url'),
      encrypted: Buffer.from(parts[4], 'base64url'),
      tag: Buffer.from(parts[5], 'base64url'),
      mac: Buffer.from(parts[6], 'base64url')
    };
  }

  static validateLengths(iv, tag, mac = null) {
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      throw new DecryptionError();
    }
    if (mac !== null && mac.length !== MAC_LENGTH) {
      throw new DecryptionError();
    }
  }
}

// ============================================================================
// 8. CryptoOperations — низкоуровневые крипто-операции
// ============================================================================
class CryptoOperations {
  static computeMac(macKey, aad, keyId, iv, encrypted, tag) {
    return crypto
      .createHmac('sha256', macKey)
      .update(Buffer.concat([
        Buffer.from(ENVELOPE_PREFIX),
        Buffer.from(keyId),
        aad,
        iv,
        encrypted,
        tag
      ]))
      .digest();
  }

  static encrypt(encKey, plainText, iv, aad) {
    const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    cipher.setAAD(aad);
    
    const encrypted = Buffer.concat([cipher.update(plainText), cipher.final()]);
    const tag = cipher.getAuthTag();
    
    return { encrypted, tag };
  }

  static decrypt(encKey, encrypted, iv, aad, tag) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}

// ============================================================================
// 9. MessageCryptoService — основная бизнес-логика
// ============================================================================
class MessageCryptoService {
  constructor(keyRing, nonceManager) {
    this.keyRing = keyRing;
    this.nonceManager = nonceManager;
  }

  encrypt(plainText, scope, context) {
    const contextType = String(context?.type || '').trim();
    const createdAt = normalizeCreatedAt(context?.createdAt);
    
    if (!contextType || !createdAt) {
      throw new Error('Encryption context missing required fields');
    }

    const activeKeys = this.keyRing.getActive();
    const keyId = this.keyRing.getActiveKeyId();
    const iv = this.nonceManager.reserve(keyId);
    
    const aad = buildAadString(scope, { ...context, type: contextType, createdAt });
    const { encKey, macKey } = derivePerMessageKeys(activeKeys, scope, {
      ...context,
      type: contextType,
      createdAt
    });
    const packedPlain = packPlainText(plainText);
    
    const { encrypted, tag } = CryptoOperations.encrypt(encKey, packedPlain, iv, aad);
    const mac = CryptoOperations.computeMac(macKey, aad, keyId, iv, encrypted, tag);
    
    return `${ENVELOPE_PREFIX}:${keyId}:${iv.toString('base64url')}:${encrypted.toString('base64url')}:${tag.toString('base64url')}:${mac.toString('base64url')}`;
  }

  decrypt(storedValue, scope, context) {
    const raw = String(storedValue || '');
    if (!raw.startsWith('enc:')) return raw;

    try {
      if (raw.startsWith(`${ENVELOPE_PREFIX}:`)) {
        return this._decryptV3(raw, scope, context);
      }
      throw new DecryptionError();
    } catch (error) {
      if (error instanceof DecryptionError) throw error;
      throw new DecryptionError();
    }
  }

  _decryptV3(raw, scope, context) {
    const envelope = EnvelopeParser.parseV3(raw);
    EnvelopeParser.validateLengths(envelope.iv, envelope.tag, envelope.mac);

    const baseKeys = this.keyRing.get(envelope.keyId);
    if (!baseKeys) throw new DecryptionError();

    const aad = buildAadString(scope, context);
    const { encKey, macKey } = derivePerMessageKeys(baseKeys, scope, context);
    const expectedMac = CryptoOperations.computeMac(
      macKey, aad, envelope.keyId, envelope.iv, envelope.encrypted, envelope.tag
    );

    if (!crypto.timingSafeEqual(expectedMac, envelope.mac)) {
      throw new DecryptionError();
    }

    const plain = CryptoOperations.decrypt(
      encKey, envelope.encrypted, envelope.iv, aad, envelope.tag
    );

    return unpackPlainText(plain);
  }

  shouldReencrypt(storedValue) {
    const raw = String(storedValue || '');
    if (raw.startsWith(`${ENVELOPE_PREFIX}:`)) {
      return false;
    }
    return true;
  }
}

// ============================================================================
// 10. MessageMigrator — выделенная логика миграции (упрощена)
// ============================================================================
class MessageMigrator {
  constructor(cryptoService, logger) {
    this.cryptoService = cryptoService;
    this.logger = logger;
  }

  async migrateStoredMessages(query, options = {}) {
    const batchSize = Number(options.batchSize || 200);
    let totalMigrated = 0;

    totalMigrated += await this._migrateTable('messages', 'server', query, batchSize);
    totalMigrated += await this._migrateTable('direct_messages', 'dm', query, batchSize);
    
    return totalMigrated;
  }

  async _migrateTable(tableName, scope, query, batchSize) {
    let migrated = 0;
    let offset = 0;

    while (true) {
      const sql = this._getSelectQuery(scope);
      const rows = await query(sql, [batchSize, offset]);
      
      if (!rows.rows.length) break;

      for (const row of rows.rows) {
        const migratedOne = await this._tryMigrateOne(row, scope, tableName, query);
        if (migratedOne) migrated++;
      }

      offset += rows.rows.length;
    }

    return migrated;
  }

  _getSelectQuery(scope) {
    if (scope === 'server') {
      return `SELECT id, user_id AS "userId", server_id AS "serverId", 
                     channel_id AS "channelId", content, created_at AS "createdAt",
                     deleted_at AS "deletedAt"
              FROM messages
              ORDER BY created_at ASC, id ASC
              LIMIT $1 OFFSET $2`;
    }
    
    return `SELECT id, sender_id AS "senderId", recipient_id AS "recipientId",
                   content, created_at AS "createdAt", deleted_at AS "deletedAt"
            FROM direct_messages
            ORDER BY created_at ASC, id ASC
            LIMIT $1 OFFSET $2`;
  }

  async _tryMigrateOne(row, scope, tableName, query) {
    const type = this._determineMessageType(scope, row.deletedAt);
    const context = this._buildMessageContext(scope, row, type);
    
    let decrypted;
    try {
      decrypted = this.cryptoService.decrypt(row.content, scope, context);
    } catch (err) {
      this.logger.error('Message re-encryption failed (decryption error)', {
        table: tableName,
        messageId: row.id
      });
      return false;
    }

    if (!this.cryptoService.shouldReencrypt(row.content)) return false;
    
    const reencrypted = this.cryptoService.encrypt(decrypted, scope, context);
    await query(`UPDATE ${tableName} SET content = $2 WHERE id = $1`, [row.id, reencrypted]);
    
    return true;
  }

  _determineMessageType(scope, deletedAt) {
    if (deletedAt) {
      return scope === 'server' ? 'server_deleted' : 'dm_deleted';
    }
    return scope === 'server' ? 'server_message' : 'dm_message';
  }

  _buildMessageContext(scope, row, type) {
    const base = {
      messageId: row.id,
      createdAt: row.createdAt,
      type
    };

    if (scope === 'server') {
      return {
        ...base,
        serverId: row.serverId,
        channelId: row.channelId,
        userId: row.userId
      };
    }
    
    return {
      ...base,
      senderId: row.senderId,
      recipientId: row.recipientId
    };
  }
}

// ============================================================================
// 11. Фабрика (публичный API) — обратно-совместимый вход
// ============================================================================
function createMessageCrypto(config, logger) {
  const keyRing = new KeyRing(config?.message?.encryptionKeys, logger);
  const activeKeyId = String(config?.message?.activeKeyId || '').trim();
  
  if (!activeKeyId || !keyRing.has(activeKeyId)) {
    throw new Error('Message encryption active key is not configured');
  }
  keyRing.setActiveKeyId(activeKeyId);
  
  const nonceManager = new NonceManager();
  const cryptoService = new MessageCryptoService(keyRing, nonceManager);
  const migrator = new MessageMigrator(cryptoService, logger);
  
  return {
    encryptContent: cryptoService.encrypt.bind(cryptoService),
    decryptContent: cryptoService.decrypt.bind(cryptoService),
    shouldReencrypt: cryptoService.shouldReencrypt.bind(cryptoService),
    migrateStoredMessages: migrator.migrateStoredMessages.bind(migrator),
    DecryptionError
  };
}

module.exports = {
  createMessageCrypto,
  DecryptionError,
  KeyRing,
  NonceManager,
  MessageCryptoService,
  MessageMigrator
};
