# Multi-Stage Dockerfile for Decoupled EC2 Transcoding Worker
# Stage 1: Build & install dependencies
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Final minimal execution image with FFmpeg
FROM node:20-alpine

# Install FFmpeg, FFprobe, and bash shell for signal handling
RUN apk add --no-cache ffmpeg bash

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source code
COPY . .

# Set production environment
ENV NODE_ENV=production

# Run under non-root node user for security
USER node

# Health check to ensure worker process remains alive
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD pgrep node || exit 1

CMD ["node", "index.js"]
