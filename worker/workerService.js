const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } = require('@aws-sdk/client-sqs');
const { transcodeVideo } = require('./transcoder');

// Load environment configuration
const REGION = process.env.AWS_REGION || 'us-east-1';
const SQS_QUEUE_URL = process.env.AWS_SQS_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/291827353919/CloudStreamJobQueue';
const RAW_BUCKET = process.env.AWS_RAW_S3_BUCKET || 'video-processing2';
const PROCESSED_BUCKET = process.env.AWS_PROCESSED_S3_BUCKET || 'video-processing01';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000/api';

const awsClientConfig = { region: REGION };
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  const creds = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  };
  if (process.env.AWS_SESSION_TOKEN) {
    creds.sessionToken = process.env.AWS_SESSION_TOKEN;
  }
  awsClientConfig.credentials = creds;
}

const s3Client = new S3Client(awsClientConfig);
const sqsClient = new SQSClient(awsClientConfig);

class WorkerService {
  constructor() {
    this.isRunning = false;
  }

  async start() {
    this.isRunning = true;
    console.log(`[Worker] Started background processing engine.`);
    console.log(`[Worker] Polling SQS Queue: ${SQS_QUEUE_URL}`);

    while (this.isRunning) {
      try {
        await this.pollQueue();
      } catch (err) {
        console.error('[Worker Loop Error]:', err.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  stop() {
    console.log('[Worker] Shutting down worker polling loop...');
    this.isRunning = false;
  }

  async pollQueue() {
    const receiveParams = {
      QueueUrl: SQS_QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20, // SQS Long-polling
      VisibilityTimeout: 600 // 10 minutes initial visibility timeout
    };

    let response;
    try {
      response = await sqsClient.send(new ReceiveMessageCommand(receiveParams));
    } catch (err) {
      // If AWS credentials are absent in local test mode
      if (err.name === 'UnrecognizedClientException' || err.message.includes('credentials')) {
        console.log('[Worker Simulation] Waiting for SQS messages (No AWS credentials found)...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        return;
      }
      throw err;
    }

    if (!response.Messages || response.Messages.length === 0) {
      return;
    }

    const message = response.Messages[0];
    console.log(`[Worker] Received job message ID: ${message.MessageId}`);

    let jobData;
    try {
      jobData = JSON.parse(message.Body);
    } catch (e) {
      console.error('[Worker] Corrupt SQS message JSON body:', message.Body);
      await this.deleteSqsMessage(message.ReceiptHandle);
      return;
    }

    const { videoId, s3SourceKey } = jobData;
    if (!videoId || !s3SourceKey) {
      console.error('[Worker] Missing videoId or s3SourceKey in message payload:', jobData);
      await this.deleteSqsMessage(message.ReceiptHandle);
      return;
    }

    // Heartbeat timer to extend SQS visibility timeout every 2 minutes during long encoding jobs
    const heartbeatTimer = setInterval(async () => {
      try {
        console.log(`[Worker Heartbeat] Extending visibility timeout for video ${videoId}...`);
        await sqsClient.send(new ChangeMessageVisibilityCommand({
          QueueUrl: SQS_QUEUE_URL,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout: 300 // Add another 5 minutes
        }));
      } catch (hbErr) {
        console.warn(`[Worker Heartbeat Warning]: ${hbErr.message}`);
      }
    }, 120000);

    const workDir = path.join(os.tmpdir(), `transcode-${videoId}-${Date.now()}`);

    try {
      // 1. Update status to PROCESSING
      await this.updateVideoState(videoId, 'PROCESSING', { transcodeStartedAt: new Date() });

      // 2. Create local disk workspace directory
      await fs.mkdir(workDir, { recursive: true });

      // 3. Download raw video from S3
      const ext = path.extname(s3SourceKey) || '.mp4';
      const localRawFile = path.join(workDir, `raw${ext}`);
      console.log(`[Worker] Downloading S3 object s3://${RAW_BUCKET}/${s3SourceKey} -> ${localRawFile}...`);
      await this.downloadS3File(RAW_BUCKET, s3SourceKey, localRawFile);

      // 4. Perform FFmpeg Transcoding
      console.log(`[Worker] Running FFmpeg transcoding for video ${videoId}...`);
      const transcodeResult = await transcodeVideo(localRawFile, workDir);

      // 5. Save converted video artifacts directly into project structure (public/processed/<videoId>)
      const projectOutputDir = path.join(__dirname, '../public/processed', videoId);
      await fs.mkdir(projectOutputDir, { recursive: true });

      console.log(`[Worker] Saving processed artifacts to project structure (${projectOutputDir}) and S3 bucket ${PROCESSED_BUCKET}...`);
      const s3Prefix = `processed/${videoId}`;
      const renditionsS3Data = {};

      for (const [key, item] of Object.entries(transcodeResult.renditions)) {
        const destKey = `${s3Prefix}/${item.s3Suffix}`;
        const localDestPath = path.join(projectOutputDir, item.s3Suffix);
        await fs.copyFile(item.filePath, localDestPath);
        console.log(`[Worker] Saved converted video to project structure: public/processed/${videoId}/${item.s3Suffix}`);

        try {
          await this.uploadFileToS3(PROCESSED_BUCKET, destKey, item.filePath, 'video/mp4');
        } catch (s3Err) {
          console.warn(`[Worker S3 Upload Notice]: ${s3Err.message}`);
        }

        renditionsS3Data[key] = {
          s3Key: destKey,
          width: item.width,
          height: item.height,
          bitrateKbps: item.bitrateKbps
        };
      }

      // Save and Upload thumbnail
      const thumbnailDestKey = `${s3Prefix}/${transcodeResult.thumbnail.s3Suffix}`;
      const localThumbnailPath = path.join(projectOutputDir, transcodeResult.thumbnail.s3Suffix);
      await fs.copyFile(transcodeResult.thumbnail.filePath, localThumbnailPath);
      console.log(`[Worker] Saved thumbnail to project structure: public/processed/${videoId}/${transcodeResult.thumbnail.s3Suffix}`);

      try {
        await this.uploadFileToS3(PROCESSED_BUCKET, thumbnailDestKey, transcodeResult.thumbnail.filePath, 'image/jpeg');
      } catch (s3Err) {
        console.warn(`[Worker S3 Upload Notice]: ${s3Err.message}`);
      }

      // 6. Update database record state to COMPLETED
      await this.updateVideoState(videoId, 'COMPLETED', {
        durationSeconds: transcodeResult.durationSeconds,
        renditions: renditionsS3Data,
        thumbnail: { s3Key: thumbnailDestKey },
        transcodeCompletedAt: new Date(),
        errorMessage: null
      });

      // 7. Delete message from SQS Queue
      await this.deleteSqsMessage(message.ReceiptHandle);
      console.log(`[Worker Success] Video ${videoId} successfully transcoded, saved to project structure, and SQS message deleted.`);

    } catch (err) {
      console.error(`[Worker Failure] Failed to transcode video ${videoId}:`, err);
      await this.updateVideoState(videoId, 'FAILED', {
        errorMessage: err.message || 'Transcoding worker error'
      });
      // SQS message is NOT deleted here so it can retry or land in DLQ after MaxReceiveCount
    } finally {
      clearInterval(heartbeatTimer);
      // 8. Strict local workspace directory cleanup
      await this.cleanupDirectory(workDir);
    }
  }

  async downloadS3File(bucket, key, localFilePath) {
    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const response = await s3Client.send(command);
      const writeStream = fsSync.createWriteStream(localFilePath);
      await new Promise((resolve, reject) => {
        response.Body.pipe(writeStream)
          .on('finish', resolve)
          .on('error', reject);
      });
    } catch (err) {
      const localProjectPath = path.join(__dirname, '../public', key);
      if (fsSync.existsSync(localProjectPath)) {
        console.log(`[Worker] Using local raw video file from project structure: ${localProjectPath}`);
        await fs.copyFile(localProjectPath, localFilePath);
        return;
      }
      throw err;
    }
  }

  async uploadFileToS3(bucket, key, localFilePath, contentType) {
    const fileBuffer = await fs.readFile(localFilePath);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType
    });
    await s3Client.send(command);
  }

  async deleteSqsMessage(receiptHandle) {
    try {
      await sqsClient.send(new DeleteMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        ReceiptHandle: receiptHandle
      }));
    } catch (err) {
      console.error('[Worker] Failed to delete SQS message:', err.message);
    }
  }

  async updateVideoState(videoId, status, extraData = {}) {
    console.log(`[Worker State Update] Video ${videoId} -> ${status}`);
    try {
      const httpModule = API_BASE_URL.startsWith('https') ? require('https') : require('http');
      const url = new URL(`${API_BASE_URL}/videos/${videoId}/status-internal`);
      const body = JSON.stringify({ status, ...extraData });

      const req = httpModule.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      });
      req.on('error', (e) => console.warn(`[Worker State Callback Warning]: ${e.message}`));
      req.write(body);
      req.end();
    } catch (e) {
      console.warn(`[Worker State Callback Error]: ${e.message}`);
    }
  }

  async cleanupDirectory(dirPath) {
    try {
      if (fsSync.existsSync(dirPath)) {
        await fs.rm(dirPath, { recursive: true, force: true });
        console.log(`[Worker Disk Cleanup] Cleaned up temporary directory: ${dirPath}`);
      }
    } catch (err) {
      console.warn(`[Worker Cleanup Warning]: Failed to delete ${dirPath}: ${err.message}`);
    }
  }
}

module.exports = new WorkerService();
