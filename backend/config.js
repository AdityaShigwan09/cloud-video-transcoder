require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  env: process.env.NODE_ENV || 'development',

  // AWS Configuration
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    sessionToken: process.env.AWS_SESSION_TOKEN || '',
    rawBucket: process.env.AWS_RAW_S3_BUCKET || 'my-raw-videos-bucket',
    processedBucket: process.env.AWS_PROCESSED_S3_BUCKET || 'my-processed-videos-bucket',
    sqsQueueUrl: process.env.AWS_SQS_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/123456789012/video-transcode-queue',
    cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN || 'https://d111111abcdef8.cloudfront.net',
    usePresignedGetUrls: process.env.AWS_USE_PRESIGNED_GET_URLS === 'true' || process.env.USE_PRESIGNED_URLS === 'true'
  },

  // Database Configuration
  db: {

    sqlitePath: process.env.SQLITE_DB_PATH || './data/database.sqlite',
    useInMemoryFallback: process.env.USE_IN_MEMORY_DB === 'true'
  },

  // Security / Presign Expiration
  presignedUrlExpiresInSeconds: parseInt(process.env.PRESIGNED_URL_EXPIRES_IN || '900', 10)
};
