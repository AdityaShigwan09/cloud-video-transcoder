# Scalable Asynchronous Video Transcoding & Streaming Platform

A high-performance, event-driven video processing and streaming engine designed for enterprise cloud environments. Built using AWS S3, AWS SQS, Dockerized Node.js Worker Nodes with FFmpeg, AWS CloudFront with Origin Access Control (OAC), Express.js Backend API, and a Vanilla HTML/CSS/JS frontend UI.

---

## Architectural Topology & Data Flow

```
[ Client Browser ]
      │
      │ 1. POST /api/videos/presign-upload (Request Presigned SigV4 URL)
      ▼
[ Express API Server ] ──(DB Record: PENDING)
      │
      │ 2. Return Presigned URL
      ▼
[ Client Browser ] ──(Direct XHR PUT Upload with Byte Progress)──► [ AWS S3 Raw Bucket ]
      │                                                                  │
      │ 3. POST /api/videos/:id/process (Notify Upload Complete)          │
      ▼                                                                  │
[ Express API Server ]                                                   │
      │                                                                  │
      │ 4. Send Job Message                                              │
      ▼                                                                  │
[ AWS SQS Queue ]                                                        │
      │                                                                  │
      │ 5. Long-Polling ReceiveMessage                                   │
      ▼                                                                  │
[ EC2 Worker Node (Docker + FFmpeg) ] ◄──(Download Raw Video)─────────────┘
      │
      │ 6. FFmpeg Transcode (720p, 480p, 360p + JPG Thumbnail)
      │
      │ 7. Upload Processed Renditions & Thumbnail
      ▼
[ AWS S3 Processed Bucket ] ◄──(Origin Access Control OAC)── [ AWS CloudFront CDN ]
      │                                                               │
      │ 8. Update DB State to COMPLETED                                │ 9. Serve Global Stream
      ▼                                                               ▼
[ Express API / Database ] ◄──(Poll GET /api/videos/:id)─── [ Client HTML5 Player ]
```

---

## Key Features

1. **Direct-to-S3 Presigned Ingestion**: Solves API bottlenecking by uploading raw videos directly from the user's browser to S3 via SigV4 signed URLs.
2. **Accurate Upload Progress**: Native `XMLHttpRequest` progress tracking showing real-time upload percentage and transfer speeds.
3. **Decoupled Worker Architecture**: Microservice background worker deployed on Dockerized EC2 instances using long-polling to extract jobs from SQS.
4. **Adaptive Transcoding Profiles**: FFmpeg H.264 / AAC encoding into 720p (HD), 480p (SD), and 360p (Mobile) resolution streams plus poster thumbnail extraction.
5. **Robust Heartbeat & Memory Safety**: Automatic SQS visibility extension during long transcoding jobs, zero memory leaks, and local `/tmp` workspace cleanup.
6. **Global Streaming via CloudFront OAC**: Secure distribution via AWS CloudFront CDN using Origin Access Control (OAC).

---

## Directory Layout

```
.
├── aws/
│   ├── iam-worker-policy.json    # Minimal IAM policy for worker node
│   ├── sqs-config.json           # SQS Queue & Dead-Letter Queue (DLQ) settings
│   └── s3-lifecycle.json         # S3 Raw Bucket cleanup lifecycle policy
├── backend/
│   ├── config.js                 # Environment configuration loader
│   ├── models/
│   │   └── Video.js              # Mongoose DB Model & DTO formatter
│   ├── routes/
│   │   └── videoRoutes.js        # Presigned URLs, SQS publish & status API
│   ├── services/
│   │   ├── awsService.js         # S3 & SQS SDK wrapper
│   │   └── dbService.js          # MongoDB connection with in-memory fallback
│   ├── package.json
│   └── server.js                 # Express API server entry point
├── worker/
│   ├── Dockerfile                # Production multi-stage Alpine Dockerfile with FFmpeg
│   ├── index.js                  # Worker process lifecycle & signal handling
│   ├── transcoder.js             # FFmpeg CLI execution engine
│   ├── workerService.js          # SQS consumer loop & S3 file management
│   └── package.json
├── public/
│   ├── app.js                    # Vanilla JS XHR direct uploader & player controller
│   ├── config.js                 # Client runtime configuration
│   ├── index.html                # Responsive UI layout
│   └── styles.css                # Custom glassmorphic design system
└── README.md
```

---

## Quick Start & Local Execution

### 1. Install Dependencies
```bash
# Install backend API dependencies
cd backend
npm install

# Install worker dependencies
cd ../worker
npm install
```

### 2. Start the Backend API Server
```bash
cd backend
npm start
```
The API server will launch at **`http://localhost:4000`**. You can open this URL directly in your browser to access the frontend client interface!

### 3. Start the Background Transcoding Worker
Ensure `ffmpeg` and `ffprobe` are installed on your system PATH, then run:
```bash
cd worker
npm start
```

---

## Docker Worker Deployment (AWS EC2)

Build and run the worker image on an AWS EC2 instance:

```bash
cd worker
docker build -t video-transcoder-worker .
docker run -d \
  --name video-worker \
  -e AWS_REGION="us-east-1" \
  -e AWS_RAW_S3_BUCKET="my-raw-videos-bucket" \
  -e AWS_PROCESSED_S3_BUCKET="my-processed-videos-bucket" \
  -e AWS_SQS_QUEUE_URL="https://sqs.us-east-1.amazonaws.com/123456789012/video-transcode-queue" \
  -e API_BASE_URL="http://YOUR-API-HOST:4000/api" \
  video-transcoder-worker
```

---

## AWS Infrastructure Setup Checklist

1. **S3 Raw Bucket (`my-raw-videos-bucket`)**:
   - Enable CORS configuration allowing `PUT`, `POST`, `GET` from your domain.
   - Attach lifecycle policy from `aws/s3-lifecycle.json` to clean up uploads after 7 days.
2. **S3 Processed Bucket (`my-processed-videos-bucket`)**:
   - Keep bucket private.
   - Configure Bucket Policy to grant read access only to CloudFront via Origin Access Control (OAC).
3. **AWS SQS Queue (`video-transcode-queue`)**:
   - Set Visibility Timeout to **600 seconds (10 minutes)**.
   - Attach Dead-Letter Queue (DLQ) redrive policy with `maxReceiveCount: 3`.
4. **AWS CloudFront Distribution**:
   - Set origin to `my-processed-videos-bucket.s3.amazonaws.com`.
   - Enable Origin Access Control (OAC).

---

## License
MIT License
