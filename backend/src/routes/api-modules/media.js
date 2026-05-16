const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const MAX_MEDIA_BYTES = 1610612736; // 1.5 GiB
const MEDIA_STORAGE_DIR = path.resolve(__dirname, '../../storage/media');

function ensureStorageDir() {
  fs.mkdirSync(MEDIA_STORAGE_DIR, { recursive: true });
}

function deriveMediaKey(config) {
  const configured = String(process.env.MEDIA_ENCRYPTION_KEY || '').trim();
  if (configured) {
    const raw = Buffer.from(configured, 'base64');
    if (raw.length === 32) return raw;
    return crypto.createHash('sha256').update(configured, 'utf8').digest();
  }
  const fallback = String(config?.jwt?.secret || 'fallback_media_key');
  return crypto.createHash('sha256').update(`media:${fallback}`, 'utf8').digest();
}

function readFileName(headerValue) {
  const fallback = 'media.bin';
  if (!headerValue || typeof headerValue !== 'string') return fallback;

  try {
    const decoded = decodeURIComponent(headerValue);
    const sanitized = decoded.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    return sanitized || fallback;
  } catch {
    return fallback;
  }
}

function createByteLimitTransform(limitBytes, onCount) {
  let total = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (typeof onCount === 'function') onCount(total);
      if (total > limitBytes) {
        callback(new Error('MEDIA_TOO_LARGE'));
        return;
      }
      callback(null, chunk);
    }
  });
}

function toMediaPayload(row) {
  if (!row?.mediaId) return null;
  return {
    id: row.mediaId,
    fileName: row.mediaName,
    mimeType: row.mediaMimeType,
    sizeBytes: Number(row.mediaSize || 0),
    url: `/api/media/${row.mediaId}`
  };
}

function registerMediaRoutes(router, deps) {
  const { authenticateToken, query, logger, shared, uuidv4, config } = deps;
  const { ensureUserHasServerAccess, areUsersFriends } = shared;
  const mediaKey = deriveMediaKey(config);
  ensureStorageDir();

  router.post('/media/upload', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const mode = String(req.query?.mode || '').trim().toLowerCase();
    const mimeType = String(req.headers['x-file-type'] || 'application/octet-stream').slice(0, 128);
    const fileName = readFileName(req.headers['x-file-name']);
    const declaredSize = Number(req.headers['x-file-size'] || 0);
    const contentLength = Number(req.headers['content-length'] || 0);

    if (declaredSize <= 0 || declaredSize > MAX_MEDIA_BYTES) {
      return res.status(413).json({ error: 'Media size exceeds 1.5GB limit' });
    }
    if (contentLength > 0 && contentLength > MAX_MEDIA_BYTES) {
      return res.status(413).json({ error: 'Media size exceeds 1.5GB limit' });
    }
    if (mode !== 'server' && mode !== 'dm') {
      return res.status(400).json({ error: 'Invalid media upload mode' });
    }

    let serverId = null;
    let channelId = null;
    let peerUserId = null;

    try {
      if (mode === 'server') {
        serverId = String(req.query?.serverId || '').trim();
        channelId = String(req.query?.channelId || '').trim();
        if (!serverId || !channelId) {
          return res.status(400).json({ error: 'Server and channel are required for media upload' });
        }

        const role = await ensureUserHasServerAccess(serverId, userId);
        if (!role) {
          return res.status(403).json({ error: 'No access to this server' });
        }

        const channelCheck = await query(
          `SELECT id
           FROM channels
           WHERE id = $1 AND server_id = $2
           LIMIT 1`,
          [channelId, serverId]
        );
        if (!channelCheck.rows[0]) {
          return res.status(404).json({ error: 'Channel not found in server' });
        }
      } else {
        peerUserId = String(req.query?.friendUserId || '').trim();
        if (!peerUserId) {
          return res.status(400).json({ error: 'Friend id is required for media upload' });
        }
        const isFriend = await areUsersFriends(userId, peerUserId);
        if (!isFriend) {
          return res.status(403).json({ error: 'Direct media upload allowed only for friends' });
        }
      }

      const mediaId = uuidv4();
      const tempPath = path.join(MEDIA_STORAGE_DIR, `${mediaId}.uploading`);
      const finalPath = path.join(MEDIA_STORAGE_DIR, `${mediaId}.bin`);
      const iv = crypto.randomBytes(12);
      const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
      const cipher = crypto.createCipheriv('aes-256-gcm', mediaKey, iv);
      const output = fs.createWriteStream(tempPath, { flags: 'wx' });

      let originalSize = 0;
      let compressedSize = 0;

      const inputCounter = createByteLimitTransform(MAX_MEDIA_BYTES, (bytes) => {
        originalSize = bytes;
      });
      const compressedCounter = createByteLimitTransform(MAX_MEDIA_BYTES * 2, (bytes) => {
        compressedSize = bytes;
      });

      try {
        await pipeline(req, inputCounter, gzip, compressedCounter, cipher, output);
      } catch (error) {
        fs.promises.unlink(tempPath).catch(() => {});
        if (error?.message === 'MEDIA_TOO_LARGE') {
          return res.status(413).json({ error: 'Media size exceeds 1.5GB limit' });
        }
        throw error;
      }

      if (originalSize === 0) {
        fs.promises.unlink(tempPath).catch(() => {});
        return res.status(400).json({ error: 'Empty media payload' });
      }

      const tag = cipher.getAuthTag();
      await fs.promises.rename(tempPath, finalPath);

      await query(
        `INSERT INTO media_files (
           id,
           owner_user_id,
           peer_user_id,
           server_id,
           channel_id,
           original_name,
           mime_type,
           original_size,
           compressed_size,
           storage_path,
           encryption_iv,
           encryption_tag
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          mediaId,
          userId,
          peerUserId,
          serverId,
          channelId,
          fileName,
          mimeType,
          originalSize,
          compressedSize,
          finalPath,
          iv,
          tag
        ]
      );

      return res.status(201).json({
        media: {
          id: mediaId,
          fileName,
          mimeType,
          sizeBytes: originalSize,
          url: `/api/media/${mediaId}`
        }
      });
    } catch (error) {
      logger.error('Media upload failed', {
        error: error.message,
        userId,
        mode
      });
      return res.status(500).json({ error: 'Failed to upload media' });
    }
  });

  router.get('/media/:mediaId', authenticateToken, async (req, res) => {
    const mediaId = String(req.params.mediaId || '').trim();
    const userId = req.user.userId;
    if (!mediaId) {
      return res.status(400).json({ error: 'Media id required' });
    }

    try {
      const mediaResult = await query(
        `SELECT id,
                owner_user_id AS "ownerUserId",
                peer_user_id AS "peerUserId",
                server_id AS "serverId",
                channel_id AS "channelId",
                original_name AS "mediaName",
                mime_type AS "mediaMimeType",
                original_size AS "mediaSize",
                storage_path,
                encryption_iv AS "iv",
                encryption_tag AS "tag"
         FROM media_files
         WHERE id = $1
           AND is_committed = TRUE
         LIMIT 1`,
        [mediaId]
      );

      const mediaRow = mediaResult.rows[0];
      if (!mediaRow) {
        return res.status(404).json({ error: 'Media not found' });
      }

      if (mediaRow.serverId) {
        const role = await ensureUserHasServerAccess(mediaRow.serverId, userId);
        if (!role) {
          return res.status(404).json({ error: 'Media not found' });
        }
      } else {
        if (![mediaRow.ownerUserId, mediaRow.peerUserId].includes(userId)) {
          return res.status(404).json({ error: 'Media not found' });
        }
        const peerUserId = mediaRow.ownerUserId === userId ? mediaRow.peerUserId : mediaRow.ownerUserId;
        if (!peerUserId || !(await areUsersFriends(userId, peerUserId))) {
          return res.status(404).json({ error: 'Media not found' });
        }
      }

      const payload = toMediaPayload({
        mediaId,
        mediaName: mediaRow.mediaName,
        mediaMimeType: mediaRow.mediaMimeType,
        mediaSize: mediaRow.mediaSize
      });

      if (!fs.existsSync(mediaRow.storage_path)) {
        return res.status(404).json({ error: 'Media payload missing' });
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', mediaKey, mediaRow.iv);
      decipher.setAuthTag(mediaRow.tag);
      const gunzip = zlib.createGunzip();

      res.setHeader('Content-Type', payload.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(payload.fileName || 'media.bin')}`);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      await pipeline(fs.createReadStream(mediaRow.storage_path), decipher, gunzip, res);
    } catch (error) {
      logger.error('Media download failed', {
        error: error.message,
        mediaId,
        userId
      });
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Failed to load media' });
      }
      res.destroy(error);
    }
  });
}

module.exports = registerMediaRoutes;
