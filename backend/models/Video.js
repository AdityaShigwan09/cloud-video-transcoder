const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  originalFilename: { type: String, required: true },
  mimeType: { type: String, required: true },
  fileSizeBytes: { type: Number, required: true },
  status: {
    type: String,
    enum: ['PENDING', 'UPLOADING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'PENDING',
    index: true
  },
  s3SourceKey: { type: String, required: true },
  renditions: {
    res720p: { s3Key: String, cdnUrl: String, width: Number, height: Number, bitrateKbps: Number },
    res480p: { s3Key: String, cdnUrl: String, width: Number, height: Number, bitrateKbps: Number },
    res360p: { s3Key: String, cdnUrl: String, width: Number, height: Number, bitrateKbps: Number }
  },
  thumbnail: {
    s3Key: String,
    cdnUrl: String
  },
  durationSeconds: { type: Number, default: 0 },
  errorMessage: { type: String, default: null },
  uploadStartedAt: { type: Date, default: Date.now },
  transcodeStartedAt: { type: Date },
  transcodeCompletedAt: { type: Date }
}, { timestamps: true });

// Convert Mongoose doc to clean API DTO
videoSchema.methods.toDTO = function(cloudfrontDomain) {
  const cdnBase = cloudfrontDomain ? cloudfrontDomain.replace(/\/$/, '') : '';
  
  const formattedRenditions = {};
  if (this.renditions) {
    if (this.renditions.res720p?.s3Key) {
      formattedRenditions['720p'] = {
        url: `${cdnBase}/${this.renditions.res720p.s3Key}`,
        width: 1280,
        height: 720
      };
    }
    if (this.renditions.res480p?.s3Key) {
      formattedRenditions['480p'] = {
        url: `${cdnBase}/${this.renditions.res480p.s3Key}`,
        width: 854,
        height: 480
      };
    }
    if (this.renditions.res360p?.s3Key) {
      formattedRenditions['360p'] = {
        url: `${cdnBase}/${this.renditions.res360p.s3Key}`,
        width: 640,
        height: 360
      };
    }
  }

  return {
    videoId: this.id,
    title: this.title,
    originalFilename: this.originalFilename,
    mimeType: this.mimeType,
    fileSizeBytes: this.fileSizeBytes,
    status: this.status,
    s3SourceKey: this.s3SourceKey,
    durationSeconds: this.durationSeconds,
    thumbnailUrl: this.thumbnail?.s3Key ? `${cdnBase}/${this.thumbnail.s3Key}` : null,
    renditions: Object.keys(formattedRenditions).length > 0 ? formattedRenditions : null,
    errorMessage: this.errorMessage,
    createdAt: this.createdAt || this.uploadStartedAt,
    updatedAt: this.updatedAt
  };
};

module.exports = mongoose.model('Video', videoSchema);
