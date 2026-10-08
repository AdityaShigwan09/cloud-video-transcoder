const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const dbService = require('./services/dbService');
const videoRoutes = require('./routes/videoRoutes');

const app = express();

// Ensure local project directories for storing raw and converted videos exist
const publicDir = path.join(__dirname, '../public');
const uploadsDir = path.join(publicDir, 'uploads');
const processedDir = path.join(publicDir, 'processed');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });

// Global Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Handle favicon requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve static frontend files and local converted video assets
app.use(express.static(publicDir));

// API Routes
app.use('/api', videoRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[API Error]:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(config.env === 'development' ? { stack: err.stack } : {})
  });
});

// Initialize database & start server
async function startServer() {
  await dbService.connect();
  
  app.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(`  Video Transcoding API Server running on port ${config.port}`);
    console.log(`  Frontend UI available at: http://localhost:${config.port}`);
    console.log(`  Converted videos directory: ${processedDir}`);
    console.log(`====================================================`);
  });
}

startServer();
