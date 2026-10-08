const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const config = require('../config');

// In-Memory store fallback if SQLite storage cannot be initialized
const inMemoryVideos = new Map();

class DbService {
  constructor() {
    this.db = null;
    this.isConnected = false;
  }

  async connect() {
    return new Promise((resolve) => {
      try {
        const dbPath = path.resolve(config.db.sqlitePath);
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new sqlite3.Database(dbPath, (err) => {
          if (err) {
            console.warn(`[DB] SQLite connection failed: ${err.message}. Falling back to memory mode.`);
            this.isConnected = false;
            return resolve(false);
          }

          this.isConnected = true;
          console.log(`[DB] Connected successfully to SQLite database at ${dbPath}`);

          // Enable Write-Ahead Logging (WAL) for optimized concurrency
          this.db.run('PRAGMA journal_mode = WAL;');

          const createTableQuery = `
            CREATE TABLE IF NOT EXISTS videos (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              originalFilename TEXT NOT NULL,
              mimeType TEXT NOT NULL,
              fileSizeBytes INTEGER NOT NULL,
              status TEXT NOT NULL DEFAULT 'PENDING',
              s3SourceKey TEXT NOT NULL,
              durationSeconds REAL DEFAULT 0,
              thumbnail TEXT,
              renditions TEXT,
              errorMessage TEXT,
              uploadStartedAt TEXT,
              transcodeStartedAt TEXT,
              transcodeCompletedAt TEXT,
              createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
              updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
            );
          `;

          this.db.run(createTableQuery, (tableErr) => {
            if (tableErr) {
              console.error('[DB] Failed to initialize SQLite table:', tableErr.message);
            } else {
              console.log('[DB] SQLite table "videos" initialized and ready.');
            }
            resolve(true);
          });
        });
      } catch (err) {
        console.warn(`[DB] SQLite initialization error: ${err.message}. Using memory mode.`);
        this.isConnected = false;
        resolve(false);
      }
    });
  }

  async createVideo(videoData) {
    if (!this.isConnected) {
      return this.createVideoInMemory(videoData);
    }
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      const sql = `
        INSERT INTO videos (
          id, title, originalFilename, mimeType, fileSizeBytes, status, s3SourceKey,
          durationSeconds, thumbnail, renditions, errorMessage, uploadStartedAt, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        videoData.id,
        videoData.title,
        videoData.originalFilename,
        videoData.mimeType,
        videoData.fileSizeBytes,
        videoData.status || 'PENDING',
        videoData.s3SourceKey,
        0,
        null,
        null,
        null,
        now,
        now,
        now
      ];

      this.db.run(sql, params, async (err) => {
        if (err) return reject(err);
        try {
          const formatted = await DbService.formatDTO({
            id: videoData.id,
            title: videoData.title,
            originalFilename: videoData.originalFilename,
            mimeType: videoData.mimeType,
            fileSizeBytes: videoData.fileSizeBytes,
            status: videoData.status || 'PENDING',
            s3SourceKey: videoData.s3SourceKey,
            durationSeconds: 0,
            thumbnail: null,
            renditions: null,
            errorMessage: null,
            createdAt: now,
            updatedAt: now
          });
          resolve(formatted);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async getVideoById(videoId) {
    if (!this.isConnected) {
      return this.getVideoByIdInMemory(videoId);
    }
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM videos WHERE id = ?`;
      this.db.get(sql, [videoId], async (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        try {
          const formatted = await DbService.formatDTO(row);
          resolve(formatted);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async updateVideoStatus(videoId, status, extraFields = {}) {
    if (!this.isConnected) {
      return this.updateVideoStatusInMemory(videoId, status, extraFields);
    }

    const existing = await new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM videos WHERE id = ?`, [videoId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!existing) return null;

    let updatedThumbnail = existing.thumbnail;
    let updatedRenditions = existing.renditions;
    let updatedDuration = existing.durationSeconds;
    let updatedErrorMessage = existing.errorMessage;
    let updatedTranscodeStartedAt = existing.transcodeStartedAt;
    let updatedTranscodeCompletedAt = existing.transcodeCompletedAt;

    if (extraFields.thumbnail !== undefined) {
      updatedThumbnail = typeof extraFields.thumbnail === 'object' ? JSON.stringify(extraFields.thumbnail) : extraFields.thumbnail;
    }
    if (extraFields.renditions !== undefined) {
      updatedRenditions = typeof extraFields.renditions === 'object' ? JSON.stringify(extraFields.renditions) : extraFields.renditions;
    }
    if (extraFields.durationSeconds !== undefined) {
      updatedDuration = extraFields.durationSeconds;
    }
    if (extraFields.errorMessage !== undefined) {
      updatedErrorMessage = extraFields.errorMessage;
    }
    if (extraFields.transcodeStartedAt !== undefined) {
      updatedTranscodeStartedAt = new Date(extraFields.transcodeStartedAt).toISOString();
    }
    if (extraFields.transcodeCompletedAt !== undefined) {
      updatedTranscodeCompletedAt = new Date(extraFields.transcodeCompletedAt).toISOString();
    }

    const now = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE videos SET
          status = ?,
          durationSeconds = ?,
          thumbnail = ?,
          renditions = ?,
          errorMessage = ?,
          transcodeStartedAt = COALESCE(?, transcodeStartedAt),
          transcodeCompletedAt = COALESCE(?, transcodeCompletedAt),
          updatedAt = ?
        WHERE id = ?
      `;

      this.db.run(sql, [
        status,
        updatedDuration,
        updatedThumbnail,
        updatedRenditions,
        updatedErrorMessage,
        updatedTranscodeStartedAt,
        updatedTranscodeCompletedAt,
        now,
        videoId
      ], (err) => {
        if (err) return reject(err);
        this.getVideoById(videoId).then(resolve).catch(reject);
      });
    });
  }

  async listVideos() {
    if (!this.isConnected) {
      return this.listVideosInMemory();
    }
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM videos ORDER BY createdAt DESC LIMIT 50`;
      this.db.all(sql, [], async (err, rows) => {
        if (err) return reject(err);
        try {
          const list = await Promise.all(rows.map(row => DbService.formatDTO(row)));
          resolve(list);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async clearAllVideos() {
    inMemoryVideos.clear();
    if (!this.isConnected) {
      return { success: true, count: 0 };
    }
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM videos`;
      this.db.run(sql, [], function (err) {
        if (err) return reject(err);
        resolve({ success: true, count: this.changes || 0 });
      });
    });
  }

  async deleteVideo(videoId) {
    inMemoryVideos.delete(videoId);
    if (!this.isConnected) {
      return { success: true, id: videoId };
    }
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM videos WHERE id = ?`;
      this.db.run(sql, [videoId], function (err) {
        if (err) return reject(err);
        resolve({ success: true, count: this.changes || 0, id: videoId });
      });
    });
  }

  async updateVideoDuration(videoId, durationSeconds) {
    if (!this.isConnected) {
      const record = inMemoryVideos.get(videoId);
      if (record) {
        record.durationSeconds = durationSeconds;
        inMemoryVideos.set(videoId, record);
      }
      return record ? await DbService.formatDTO({ ...record, id: record.id }) : null;
    }
    const now = new Date().toISOString();
    return new Promise((resolve, reject) => {
      const sql = `UPDATE videos SET durationSeconds = ?, updatedAt = ? WHERE id = ?`;
      this.db.run(sql, [durationSeconds, now, videoId], (err) => {
        if (err) return reject(err);
        this.getVideoById(videoId).then(resolve).catch(reject);
      });
    });
  }

  async getAdminStats() {
    const videos = await this.listVideos();
    const totalVideos = videos.length;

    const statusCounts = { PENDING: 0, UPLOADING: 0, QUEUED: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 };
    let totalStorageBytes = 0;
    let totalDurationSeconds = 0;
    const renditionsBreakdown = { '720p': 0, '480p': 0, '360p': 0 };

    videos.forEach(v => {
      if (statusCounts[v.status] !== undefined) {
        statusCounts[v.status]++;
      }
      totalStorageBytes += Number(v.fileSizeBytes || 0);
      totalDurationSeconds += Number(v.durationSeconds || 0);

      if (v.renditions) {
        if (v.renditions['720p']) renditionsBreakdown['720p']++;
        if (v.renditions['480p']) renditionsBreakdown['480p']++;
        if (v.renditions['360p']) renditionsBreakdown['360p']++;
      }
    });

    const successRate = totalVideos > 0
      ? Number(((statusCounts.COMPLETED / totalVideos) * 100).toFixed(1))
      : 100;

    const avgDuration = totalVideos > 0
      ? Number((totalDurationSeconds / totalVideos).toFixed(1))
      : 0;

    return {
      totalVideos,
      statusCounts,
      totalStorageBytes,
      totalDurationSeconds,
      avgDurationSeconds: avgDuration,
      successRatePercent: successRate,
      renditionsBreakdown,
      videos
    };
  }

  static async formatDTO(row) {
    const hasAwsCreds = Boolean((config.aws.accessKeyId && config.aws.secretAccessKey) || process.env.NODE_ENV === 'production' || process.env.USE_REAL_AWS === 'true');
    let cdnBase = config.aws.cloudfrontDomain ? config.aws.cloudfrontDomain.replace(/\/$/, '') : '';

    const isPlaceholderCdn = !cdnBase || cdnBase.includes('d111111abcdef8.cloudfront.net') || cdnBase.includes('my-raw-videos-bucket') || cdnBase === 'video-processing01';
    if (isPlaceholderCdn && !hasAwsCreds) {
      cdnBase = '';
    } else if (cdnBase && !cdnBase.startsWith('http://') && !cdnBase.startsWith('https://')) {
      if (cdnBase.includes('.')) {
        cdnBase = `https://${cdnBase}`;
      } else {
        cdnBase = `https://${cdnBase}.s3.${config.aws.region || 'us-east-1'}.amazonaws.com`;
      }
    }

    const buildUrl = async (s3Key) => {
      if (!s3Key) return null;
      if (s3Key.startsWith('http://') || s3Key.startsWith('https://')) return s3Key;
      const cleanKey = s3Key.replace(/^\/+/, '');

      const usePresignedGet = config.aws.usePresignedGetUrls || (hasAwsCreds && (!cdnBase || cdnBase.includes('.s3.') || cdnBase.includes('s3.amazonaws.com')));

      if (hasAwsCreds && usePresignedGet) {
        try {
          const awsService = require('./awsService');
          const signedUrl = await awsService.generatePresignedDownloadUrl(cleanKey);
          if (signedUrl) return signedUrl;
        } catch (e) {
          console.warn('[DB] Failed to generate presigned GET URL, falling back to static URL:', e.message);
        }
      }

      return cdnBase ? `${cdnBase}/${cleanKey}` : `/${cleanKey}`;
    };

    let renditionsObj = null;
    if (row.renditions) {
      try {
        renditionsObj = typeof row.renditions === 'string' ? JSON.parse(row.renditions) : row.renditions;
      } catch (e) { }
    }

    let thumbnailObj = null;
    if (row.thumbnail) {
      try {
        thumbnailObj = typeof row.thumbnail === 'string' ? JSON.parse(row.thumbnail) : row.thumbnail;
      } catch (e) { }
    }

    const formattedRenditions = {};
    if (renditionsObj) {
      if (renditionsObj.res720p?.s3Key) {
        formattedRenditions['720p'] = {
          url: await buildUrl(renditionsObj.res720p.s3Key),
          width: 1280,
          height: 720
        };
      }
      if (renditionsObj.res480p?.s3Key) {
        formattedRenditions['480p'] = {
          url: await buildUrl(renditionsObj.res480p.s3Key),
          width: 854,
          height: 480
        };
      }
      if (renditionsObj.res360p?.s3Key) {
        formattedRenditions['360p'] = {
          url: await buildUrl(renditionsObj.res360p.s3Key),
          width: 640,
          height: 360
        };
      }
    }

    return {
      videoId: row.id,
      title: row.title,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      fileSizeBytes: row.fileSizeBytes,
      status: row.status,
      s3SourceKey: row.s3SourceKey,
      durationSeconds: row.durationSeconds || 0,
      thumbnailUrl: await buildUrl(thumbnailObj?.s3Key),
      renditions: Object.keys(formattedRenditions).length > 0 ? formattedRenditions : null,
      errorMessage: row.errorMessage || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  // --- In-Memory Fallback Methods ---
  async createVideoInMemory(videoData) {
    const record = {
      ...videoData,
      createdAt: new Date(),
      updatedAt: new Date(),
      durationSeconds: 0,
      errorMessage: null,
      renditions: null,
      thumbnail: null
    };
    inMemoryVideos.set(videoData.id, record);
    return await DbService.formatDTO({
      ...record,
      id: record.id
    });
  }

  async getVideoByIdInMemory(videoId) {
    const record = inMemoryVideos.get(videoId);
    return record ? await DbService.formatDTO({ ...record, id: record.id }) : null;
  }

  async updateVideoStatusInMemory(videoId, status, extraFields = {}) {
    const record = inMemoryVideos.get(videoId);
    if (!record) return null;
    const updated = {
      ...record,
      status,
      updatedAt: new Date(),
      ...extraFields
    };
    inMemoryVideos.set(videoId, updated);
    return await DbService.formatDTO({ ...updated, id: updated.id });
  }

  async listVideosInMemory() {
    const list = Array.from(inMemoryVideos.values());
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return await Promise.all(list.map(item => DbService.formatDTO({ ...item, id: item.id })));
  }
}

module.exports = new DbService();
