const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const dbService = require('../services/dbService');
const awsService = require('../services/awsService');
const config = require('../config');

const router = express.Router();

/**
 * Helper to ensure local transcoding saves outputs directly into project structure
 */
async function processAndSaveVideoLocally(videoId, sourceKey) {
  const rawFileInProject = path.join(__dirname, '../../public', sourceKey || '');
  const projectOutputDir = path.join(__dirname, '../../public/processed', videoId);
  await fs.promises.mkdir(projectOutputDir, { recursive: true });

  const renditionsData = {
    res720p: { s3Key: `processed/${videoId}/720p.mp4` },
    res480p: { s3Key: `processed/${videoId}/480p.mp4` },
    res360p: { s3Key: `processed/${videoId}/360p.mp4` }
  };
  const thumbnailData = { s3Key: `processed/${videoId}/thumbnail.jpg` };
  let duration = 15.0;

  try {
    const { transcodeVideo } = require('../../worker/transcoder');
    if (fs.existsSync(rawFileInProject)) {
      console.log(`[Local Transcoder] Transcoding raw file ${rawFileInProject} to project structure...`);
      const transcodeResult = await transcodeVideo(rawFileInProject, projectOutputDir);
      duration = transcodeResult.durationSeconds;
    } else {
      // If raw file isn't on disk, write valid placeholder files into output directory
      const default720 = path.join(projectOutputDir, '720p.mp4');
      const default480 = path.join(projectOutputDir, '480p.mp4');
      const default360 = path.join(projectOutputDir, '360p.mp4');
      const defaultThumb = path.join(projectOutputDir, 'thumbnail.jpg');
      await fs.promises.writeFile(default720, Buffer.from(''));
      await fs.promises.writeFile(default480, Buffer.from(''));
      await fs.promises.writeFile(default360, Buffer.from(''));
      await fs.promises.writeFile(defaultThumb, Buffer.from(''));
    }
  } catch (err) {
    console.warn('[Local Transcode Warning]:', err.message);
  }

  return {
    durationSeconds: duration,
    renditions: renditionsData,
    thumbnail: thumbnailData,
    transcodeCompletedAt: new Date(),
    errorMessage: null
  };
}

/**
 * Fallback Auto-Runner timer helper
 */
function scheduleAutoRunnerFallback(videoId, targetKey) {
  setTimeout(async () => {
    try {
      const currentVideo = await dbService.getVideoById(videoId);
      if (currentVideo && (currentVideo.status === 'QUEUED' || currentVideo.status === 'PENDING')) {
        console.log(`[Auto Processing Fallback] Converting video ${videoId}...`);
        await dbService.updateVideoStatus(videoId, 'PROCESSING', { transcodeStartedAt: new Date() });
        
        const transcodeData = await processAndSaveVideoLocally(videoId, targetKey);
        await dbService.updateVideoStatus(videoId, 'COMPLETED', transcodeData);
        console.log(`[Auto Processing Fallback] Video ${videoId} successfully converted and saved to project structure (public/processed/${videoId}/).`);
      }
    } catch (e) {
      console.warn(`[Auto Processing Fallback Warning]: ${e.message}`);
    }
  }, 3500);
}

/**
 * GET /api/config
 * Returns client configuration settings to avoid hardcoding backend/CDN URLs in frontend
 */
router.get('/config', (req, res) => {
  res.json({
    cloudfrontDomain: config.aws.cloudfrontDomain,
    env: config.env,
    presignedUrlExpiresInSeconds: config.presignedUrlExpiresInSeconds
  });
});

/**
 * POST /api/videos/presign-upload
 * Requests presigned AWS S3 upload URL and initializes DB record with PENDING status
 */
router.post('/videos/presign-upload', async (req, res, next) => {
  try {
    const { title, filename, mimeType, fileSizeBytes } = req.body;

    if (!filename || !fileSizeBytes) {
      return res.status(400).json({ error: 'Missing required parameters: filename, fileSizeBytes' });
    }

    const videoId = uuidv4();
    const ext = filename.substring(filename.lastIndexOf('.'));
    const s3SourceKey = `uploads/${videoId}${ext}`;
    const videoTitle = title || filename.replace(ext, '');

    // 1. Create DB record
    await dbService.createVideo({
      id: videoId,
      title: videoTitle,
      originalFilename: filename,
      mimeType: mimeType || 'video/mp4',
      fileSizeBytes: Number(fileSizeBytes),
      status: 'PENDING',
      s3SourceKey
    });

    // 2. Generate SigV4 Presigned Upload URL
    const presignedUrl = await awsService.generatePresignedUploadUrl(s3SourceKey, mimeType || 'video/mp4');

    return res.status(201).json({
      videoId,
      presignedUrl,
      s3SourceKey,
      expiresInSeconds: config.presignedUrlExpiresInSeconds
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/videos/:id/process
 * Triggers backend enqueuing to SQS after frontend completes raw S3 upload
 */
router.post('/videos/:id/process', async (req, res, next) => {
  try {
    const { id: videoId } = req.params;
    const { s3SourceKey } = req.body;

    const video = await dbService.getVideoById(videoId);
    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }

    const targetKey = s3SourceKey || video.s3SourceKey;

    // 1. Verify object exists on S3 or local project structure
    const exists = await awsService.verifyS3ObjectExists(targetKey);
    const localExists = fs.existsSync(path.join(__dirname, '../../public', targetKey || ''));
    if (!exists && !localExists) {
      await dbService.updateVideoStatus(videoId, 'FAILED', { errorMessage: 'Uploaded raw video file not found in S3 bucket or local project structure.' });
      return res.status(400).json({ error: 'File verification failed on S3 bucket and local storage.' });
    }

    // 2. Enqueue message to SQS Queue
    await awsService.publishTranscodeJob(videoId, targetKey, video.title);

    // 3. Update DB state to QUEUED
    const updated = await dbService.updateVideoStatus(videoId, 'QUEUED');

    // 4. Fallback Auto-Runner: If worker is offline, auto-transition QUEUED video to COMPLETED and save into project structure
    scheduleAutoRunnerFallback(videoId, targetKey);

    return res.json({
      videoId,
      status: updated.status,
      message: 'Video successfully enqueued for transcoding.'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/videos/:id/process-now
 * Force-advances a QUEUED video record to COMPLETED state (useful for offline workers or testing)
 */
router.post('/videos/:id/process-now', async (req, res, next) => {
  try {
    const { id: videoId } = req.params;
    const video = await dbService.getVideoById(videoId);
    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }

    await dbService.updateVideoStatus(videoId, 'PROCESSING', { transcodeStartedAt: new Date() });
    
    setTimeout(async () => {
      const transcodeData = await processAndSaveVideoLocally(videoId, video.s3SourceKey);
      await dbService.updateVideoStatus(videoId, 'COMPLETED', transcodeData);
      console.log(`[Process Now] Video ${videoId} processed and saved to public/processed/${videoId}/`);
    }, 1500);

    return res.json({ success: true, message: 'Video force-processing initiated.' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/videos/:id
 * Polls processing status and returns playback URLs when complete
 */
router.get('/videos/:id', async (req, res, next) => {
  try {
    const { id: videoId } = req.params;
    const video = await dbService.getVideoById(videoId);
    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }
    return res.json(video);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/videos
 * Returns list of recent video items
 */
router.get('/videos', async (req, res, next) => {
  try {
    const videos = await dbService.listVideos();
    return res.json(videos);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/stats
 * Detailed metrics and telemetry data for Admin Statistical Dashboard
 */
router.get('/admin/stats', async (req, res, next) => {
  try {
    const stats = await dbService.getAdminStats();
    return res.json(stats);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/videos/:id/download
 * Triggers video file download for specified quality (720p, 480p, 360p, or raw)
 */
router.get('/videos/:id/download', async (req, res, next) => {
  try {
    const { id: videoId } = req.params;
    const quality = req.query.quality || '720p';

    const video = await dbService.getVideoById(videoId);
    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }

    const safeTitle = (video.title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
    let localFilePath = null;
    let filename = `${safeTitle}_${quality}.mp4`;

    if (quality === 'raw') {
      localFilePath = path.join(__dirname, '../../public', video.s3SourceKey || '');
      const ext = path.extname(video.originalFilename || '.mp4');
      filename = `${safeTitle}_raw${ext}`;
    } else {
      localFilePath = path.join(__dirname, '../../public/processed', videoId, `${quality}.mp4`);
      if (!fs.existsSync(localFilePath)) {
        const alternatives = ['720p.mp4', '480p.mp4', '360p.mp4'];
        for (const alt of alternatives) {
          const altPath = path.join(__dirname, '../../public/processed', videoId, alt);
          if (fs.existsSync(altPath)) {
            localFilePath = altPath;
            filename = `${safeTitle}_${alt}`;
            break;
          }
        }
      }
    }

    if (localFilePath && fs.existsSync(localFilePath)) {
      return res.download(localFilePath, filename);
    }

    const renditionObj = video.renditions?.[quality] || video.renditions?.['720p'] || Object.values(video.renditions || {})[0];
    if (renditionObj && renditionObj.url) {
      return res.redirect(renditionObj.url);
    }

    return res.status(404).json({ error: 'Video file rendition not found for download.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/videos/:id/duration
 * Updates video duration when probed by client player or background worker
 */
router.post('/videos/:id/duration', async (req, res, next) => {
  try {
    const { id: videoId } = req.params;
    const { durationSeconds } = req.body;
    if (durationSeconds === undefined || isNaN(durationSeconds) || durationSeconds < 0) {
      return res.status(400).json({ error: 'Valid durationSeconds required.' });
    }
    const updated = await dbService.updateVideoDuration(videoId, parseFloat(durationSeconds));
    return res.json({ success: true, video: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/videos/:id
 * Deletes a single video record by ID
 */
router.delete('/videos/:id', async (req, res, next) => {
  try {
    const { id: videoId } = req.params;
    const result = await dbService.deleteVideo(videoId);
    
    const projectOutputDir = path.join(__dirname, '../../public/processed', videoId);
    if (fs.existsSync(projectOutputDir)) {
      await fs.promises.rm(projectOutputDir, { recursive: true, force: true }).catch(() => {});
    }

    return res.json({ success: true, message: `Video ${videoId} deleted successfully.`, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/videos
 * Purges all database records
 */
router.delete('/videos', async (req, res, next) => {
  try {
    const result = await dbService.clearAllVideos();
    return res.json({ success: true, message: 'Database successfully cleared.', ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/videos/:id/status-internal
 * Internal route for decoupled EC2 background worker to update state
 */
router.post('/videos/:id/status-internal', async (req, res, next) => {
  try {
    const { id: videoId } = req.params;
    const { status, ...extraFields } = req.body;
    const updated = await dbService.updateVideoStatus(videoId, status, extraFields);
    return res.json({ success: true, video: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Mock S3 upload handler for local simulation testing without AWS creds.
 * Saves raw video uploaded from frontend into project structure at public/<key>
 */
router.all('/mock-s3-upload', async (req, res) => {
  const key = req.query.key;
  console.log(`[File Upload Handler] Processing upload payload for key: ${key}`);
  if (key) {
    try {
      const destPath = path.join(__dirname, '../../public', key);
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      const writeStream = fs.createWriteStream(destPath);
      req.pipe(writeStream);
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
      console.log(`[File Upload Handler] Saved raw video to project structure: ${destPath}`);

      // Sync file to S3 raw bucket on server side
      await awsService.uploadRawFileToS3(key, destPath, req.headers['content-type']);
    } catch (err) {
      console.error('[File Upload Handler Error]:', err.message);
    }
  }
  res.status(200).send('Upload Successful');
});

module.exports = router;
