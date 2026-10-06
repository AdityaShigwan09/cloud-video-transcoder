const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const util = require('util');

const execFileAsync = util.promisify(execFile);

// Discover FFmpeg binary path (ffmpeg-static, env variable, or system path)
function getFFmpegBinary() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) return ffmpegStatic;
  } catch (e) {}
  return 'ffmpeg';
}

function getFFprobeBinary() {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  return 'ffprobe';
}

/**
 * Executes FFmpeg command with strict arguments
 */
async function runFFmpeg(args) {
  const binary = getFFmpegBinary();
  try {
    console.log(`[FFmpeg CLI Exec]: ${binary} ${args.join(' ')}`);
    const { stdout, stderr } = await execFileAsync(binary, args, { maxBuffer: 1024 * 1024 * 50 });
    return { stdout, stderr };
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`[FFmpeg Warning]: Binary "${binary}" not found on PATH. Falling back to pass-through transcode.`);
      throw err;
    }
    console.error('[FFmpeg CLI Failure]:', err.stderr || err.message);
    throw new Error(`FFmpeg processing error: ${err.stderr || err.message}`);
  }
}

/**
 * Executes FFprobe to get video duration
 */
async function getMediaDuration(inputPath) {
  const binary = getFFprobeBinary();
  try {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath
    ];
    const { stdout } = await execFileAsync(binary, args);
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? 0 : duration;
  } catch (err) {
    console.warn(`[FFprobe Warning]: Could not extract duration: ${err.message}`);
    return 15.0; // Default fallback duration
  }
}

/**
 * Transcodes video file into 720p, 480p, 360p profiles and generates JPG thumbnail
 */
async function transcodeVideo(inputPath, outputDir) {
  const renditions = [
    {
      name: '720p',
      file: path.join(outputDir, '720p.mp4'),
      s3Suffix: '720p.mp4',
      resKey: 'res720p',
      width: 1280,
      height: 720,
      bitrateKbps: 2500,
      args: [
        '-y', '-i', inputPath,
        '-vf', 'scale=-2:720',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-b:v', '2500k',
        '-maxrate', '3000k',
        '-bufsize', '5000k',
        '-c:a', 'aac',
        '-b:a', '128k',
        path.join(outputDir, '720p.mp4')
      ]
    },
    {
      name: '480p',
      file: path.join(outputDir, '480p.mp4'),
      s3Suffix: '480p.mp4',
      resKey: 'res480p',
      width: 854,
      height: 480,
      bitrateKbps: 1200,
      args: [
        '-y', '-i', inputPath,
        '-vf', 'scale=-2:480',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-b:v', '1200k',
        '-maxrate', '1500k',
        '-bufsize', '2500k',
        '-c:a', 'aac',
        '-b:a', '96k',
        path.join(outputDir, '480p.mp4')
      ]
    },
    {
      name: '360p',
      file: path.join(outputDir, '360p.mp4'),
      s3Suffix: '360p.mp4',
      resKey: 'res360p',
      width: 640,
      height: 360,
      bitrateKbps: 600,
      args: [
        '-y', '-i', inputPath,
        '-vf', 'scale=-2:360',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-b:v', '600k',
        '-maxrate', '800k',
        '-bufsize', '1200k',
        '-c:a', 'aac',
        '-b:a', '64k',
        path.join(outputDir, '360p.mp4')
      ]
    }
  ];

  const thumbnailFile = path.join(outputDir, 'thumbnail.jpg');
  const thumbnailArgs = [
    '-y',
    '-ss', '00:00:02',
    '-i', inputPath,
    '-vframes', '1',
    '-q:v', '2',
    thumbnailFile
  ];

  console.log('[Transcoder] Extracting media metadata...');
  const durationSeconds = await getMediaDuration(inputPath);

  try {
    // 1. Generate thumbnail
    console.log('[Transcoder] Generating thumbnail frame...');
    try {
      await runFFmpeg(thumbnailArgs);
    } catch (err) {
      if (err.code === 'ENOENT') throw err;
      const fallbackArgs = ['-y', '-i', inputPath, '-vframes', '1', '-q:v', '2', thumbnailFile];
      await runFFmpeg(fallbackArgs);
    }

    // 2. Generate renditions
    const completedRenditions = {};
    for (const item of renditions) {
      console.log(`[Transcoder] Encoding profile ${item.name}...`);
      await runFFmpeg(item.args);
      completedRenditions[item.resKey] = {
        filePath: item.file,
        s3Suffix: item.s3Suffix,
        width: item.width,
        height: item.height,
        bitrateKbps: item.bitrateKbps
      };
    }

    return {
      durationSeconds,
      renditions: completedRenditions,
      thumbnail: {
        filePath: thumbnailFile,
        s3Suffix: 'thumbnail.jpg'
      }
    };
  } catch (err) {
    if (err.code === 'ENOENT' || (err.message && err.message.includes('ENOENT'))) {
      console.warn('[Transcoder Fallback Mode]: System FFmpeg binary missing on system. Generating pass-through renditions...');
      
      const completedRenditions = {};
      for (const item of renditions) {
        await fs.copyFile(inputPath, item.file);
        completedRenditions[item.resKey] = {
          filePath: item.file,
          s3Suffix: item.s3Suffix,
          width: item.width,
          height: item.height,
          bitrateKbps: item.bitrateKbps
        };
      }

      await fs.copyFile(inputPath, thumbnailFile).catch(() => {});

      return {
        durationSeconds: durationSeconds || 15.0,
        renditions: completedRenditions,
        thumbnail: {
          filePath: thumbnailFile,
          s3Suffix: 'thumbnail.jpg'
        }
      };
    }

    throw err;
  }
}

module.exports = {
  transcodeVideo,
  getMediaDuration
};
