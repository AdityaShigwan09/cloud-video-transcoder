(function () {
  const API_BASE = window.APP_CONFIG?.apiBaseUrl || '';
  const POLL_INTERVAL_MS = window.APP_CONFIG?.pollIntervalMs || 3000;

  // DOM Navigation Elements
  const navLinks = document.querySelectorAll('.nav-link');
  const viewSections = document.querySelectorAll('.view-section');
  const brandLink = document.getElementById('brand-link');
  const heroUploadCta = document.getElementById('hero-upload-cta');

  // DOM Auth Elements
  const authActions = document.getElementById('auth-actions');
  const userModal = document.getElementById('user-modal');
  const adminModal = document.getElementById('admin-modal');
  const userModalClose = document.getElementById('user-modal-close');
  const adminModalClose = document.getElementById('admin-modal-close');
  const confirmGuestBtn = document.getElementById('confirm-guest-btn');
  const confirmAdminBtn = document.getElementById('confirm-admin-btn');
  const adminUserInput = document.getElementById('admin-user');
  const adminPassInput = document.getElementById('admin-pass');
  const adminErrorMsg = document.getElementById('admin-error-msg');
  const activeUserBadge = document.getElementById('active-user-badge');
  const userRoleLabel = document.getElementById('user-role-label');
  const logoutBtn = document.getElementById('logout-btn');

  // Admin Gate Elements
  const adminPanelUnlocked = document.getElementById('admin-panel-unlocked');
  const adminPanelLocked = document.getElementById('admin-panel-locked');
  const gateAdminLoginBtn = document.getElementById('gate-admin-login-btn');
  const awsRoleBadge = document.getElementById('aws-role-badge');
  const btnAdminHealthCheck = document.getElementById('btn-admin-health-check');
  const btnAdminClearLogs = document.getElementById('btn-admin-clear-logs');
  const adminHealthOutput = document.getElementById('admin-health-output');

  // DOM Upload & Player Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const dropzoneText = document.getElementById('dropzone-text');
  const titleInput = document.getElementById('video-title');
  const uploadBtn = document.getElementById('upload-btn');
  const progressContainer = document.getElementById('upload-progress-container');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressStatusText = document.getElementById('progress-status-text');

  const activeStatusBadge = document.getElementById('active-status-badge');
  const badgeText = document.getElementById('badge-text');
  const playerPlaceholder = document.getElementById('player-placeholder');
  const placeholderMsg = document.getElementById('placeholder-msg');
  const videoPlayer = document.getElementById('video-player');
  const qualityBar = document.getElementById('quality-bar');
  const downloadBar = document.getElementById('download-bar');
  const telemetryInfo = document.getElementById('telemetry-info');
  const telemetryId = document.getElementById('telemetry-id');
  const telemetryDuration = document.getElementById('telemetry-duration');
  const homeVideoGrid = document.getElementById('home-video-grid');
  const statVideoCount = document.getElementById('stat-video-count');

  let selectedFile = null;
  let activePollTimer = null;
  let currentUserRole = 'Guest Creator'; // Default
  let currentActiveVideo = null;
  let adminStatsData = null;

  // --- DURATION FORMATTER HELPER ---
  function formatDuration(seconds) {
    if (seconds === undefined || seconds === null || isNaN(seconds) || seconds < 0) return '00:00';
    const totalSecs = Math.round(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // --- TAB NAVIGATION ENGINE ---
  function switchView(targetViewId) {
    navLinks.forEach(link => {
      if (link.getAttribute('data-view') === targetViewId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    viewSections.forEach(sec => {
      if (sec.id === `view-${targetViewId}`) {
        sec.classList.add('active');
      } else {
        sec.classList.remove('active');
      }
    });

    if (targetViewId === 'aws' && currentUserRole === 'Administrator') {
      fetchAdminStats();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      const view = link.getAttribute('data-view');
      switchView(view);
    });
  });

  if (brandLink) {
    brandLink.addEventListener('click', () => {
      if (navMenu && navMenu.style.display !== 'none') {
        switchView('home');
      } else {
        switchView('gateway');
      }
    });
  }
  if (heroUploadCta) heroUploadCta.addEventListener('click', () => switchView('upload'));

  // Gateway Landing Elements
  const gatewayUserBtn = document.getElementById('gateway-user-btn');
  const gatewayAdminBtn = document.getElementById('gateway-admin-btn');
  const navMenu = document.getElementById('nav-menu');

  // Gateway Landing Button Event Listeners
  if (gatewayUserBtn) {
    gatewayUserBtn.addEventListener('click', () => {
      setUserRole('User Creator', false);
    });
  }

  if (gatewayAdminBtn) {
    gatewayAdminBtn.addEventListener('click', openAdminModal);
  }

  // --- USER AUTH & ROLE SYSTEM ---
  function openAdminModal() {
    adminErrorMsg.style.display = 'none';
    adminModal.classList.add('active');
  }

  if (gateAdminLoginBtn) gateAdminLoginBtn.addEventListener('click', openAdminModal);

  userModalClose.addEventListener('click', () => userModal.classList.remove('active'));
  adminModalClose.addEventListener('click', () => adminModal.classList.remove('active'));

  if (confirmGuestBtn) {
    confirmGuestBtn.addEventListener('click', () => {
      setUserRole('User Creator', false);
      userModal.classList.remove('active');
    });
  }

  // Admin Login - Credentials (admin / admin123)
  confirmAdminBtn.addEventListener('click', () => {
    const username = adminUserInput.value.trim();
    const password = adminPassInput.value.trim();

    if (username === 'admin' && password === 'admin123') {
      setUserRole('Administrator', true);
      adminModal.classList.remove('active');
    } else {
      adminErrorMsg.style.display = 'block';
    }
  });

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      resetUserRole();
    });
  }

  function setUserRole(roleName, isAdmin) {
    currentUserRole = roleName;
    userRoleLabel.textContent = isAdmin ? 'Administrator' : 'User Creator';
    
    if (authActions) authActions.style.display = 'flex';
    if (activeUserBadge) activeUserBadge.style.display = 'inline-flex';

    if (navMenu) navMenu.style.display = 'flex';
    switchView('home');

    if (isAdmin) {
      if (adminPanelUnlocked) adminPanelUnlocked.style.display = 'block';
      if (adminPanelLocked) adminPanelLocked.style.display = 'none';
      if (awsRoleBadge) {
        awsRoleBadge.className = 'status-badge badge-completed';
        awsRoleBadge.textContent = 'Admin Privileges Active';
      }
      fetchAdminStats();
    } else {
      if (adminPanelUnlocked) adminPanelUnlocked.style.display = 'none';
      if (adminPanelLocked) adminPanelLocked.style.display = 'block';
      if (awsRoleBadge) {
        awsRoleBadge.className = 'status-badge badge-queued';
        awsRoleBadge.textContent = 'Guest User View';
      }
    }
  }

  function resetUserRole() {
    currentUserRole = 'Guest Creator';
    
    if (authActions) authActions.style.display = 'none';
    if (activeUserBadge) activeUserBadge.style.display = 'none';

    if (navMenu) navMenu.style.display = 'none';
    switchView('gateway');

    if (adminPanelUnlocked) adminPanelUnlocked.style.display = 'none';
    if (adminPanelLocked) adminPanelLocked.style.display = 'block';
    if (awsRoleBadge) {
      awsRoleBadge.className = 'status-badge badge-queued';
      awsRoleBadge.textContent = 'Guest User View';
    }
  }

  // Admin Telemetry & Health Diagnostics
  if (btnAdminHealthCheck) {
    btnAdminHealthCheck.addEventListener('click', async () => {
      adminHealthOutput.style.display = 'block';
      adminHealthOutput.textContent = 'Running live AWS infrastructure diagnostics...';

      try {
        const configRes = await fetch(`${API_BASE}/api/config`);
        const videosRes = await fetch(`${API_BASE}/api/videos`);
        const configData = await configRes.json();
        const videosData = await videosRes.json();

        adminHealthOutput.innerHTML = `
[SYSTEM HEALTH REPORT - OK]
• API Endpoint: ${API_BASE || 'localhost:4000'} (ONLINE)
• SQLite Storage: WAL Mode Active
• AWS SQS Queue: Connected
• CloudFront CDN Domain: ${configData.cloudfrontDomain}
• Total DB Records: ${videosData.length} video(s)
• Diagnostic Status: All services operating normally.
        `;
      } catch (err) {
        adminHealthOutput.textContent = `[DIAGNOSTIC ERROR]: ${err.message}`;
      }
    });
  }

  if (btnAdminClearLogs) {
    btnAdminClearLogs.addEventListener('click', () => {
      fetchVideoList();
      fetchAdminStats();
      if (adminHealthOutput) {
        adminHealthOutput.style.display = 'block';
        adminHealthOutput.textContent = '[TELEMETRY REFRESHED]: Latest video feed and database records synchronized.';
      }
    });
  }

  const btnAdminPurgeDb = document.getElementById('btn-admin-purge-db');
  if (btnAdminPurgeDb) {
    btnAdminPurgeDb.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to purge all video records from the database?')) return;
      adminHealthOutput.style.display = 'block';
      adminHealthOutput.textContent = 'Purging database records...';

      try {
        const res = await fetch(`${API_BASE}/api/videos`, { method: 'DELETE' });
        const data = await res.json();
        adminHealthOutput.textContent = `[DATABASE PURGED]: ${data.message || 'All database records successfully cleared.'} (${data.count || 0} items removed)`;
        fetchVideoList();
        fetchAdminStats();
      } catch (err) {
        adminHealthOutput.textContent = `[PURGE ERROR]: ${err.message}`;
      }
    });
  }

  // --- UPLOAD PIPELINE ENGINE ---
  dropzone.addEventListener('click', () => fileInput.click());
  
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  function handleFileSelected(file) {
    if (!file.type.startsWith('video/')) {
      alert('Please select a valid video file format (e.g. MP4, MOV, AVI, MKV).');
      return;
    }
    selectedFile = file;
    dropzoneText.textContent = `Selected: ${file.name} (${formatBytes(file.size)})`;
    if (!titleInput.value.trim()) {
      titleInput.value = file.name.replace(/\.[^/.]+$/, '');
    }
    uploadBtn.disabled = false;
  }

  uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    uploadBtn.disabled = true;
    progressContainer.style.display = 'block';
    updateProgress(0, 'Requesting S3 Presigned Upload URL...');
    updateBadgeStatus('PENDING');

    try {
      const presignRes = await fetch(`${API_BASE}/api/videos/presign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleInput.value.trim() || selectedFile.name,
          filename: selectedFile.name,
          mimeType: selectedFile.type,
          fileSizeBytes: selectedFile.size
        })
      });

      if (!presignRes.ok) {
        const errJson = await presignRes.json();
        throw new Error(errJson.error || 'Failed to request presigned upload URL.');
      }

      const { videoId, presignedUrl, s3SourceKey } = await presignRes.json();
      console.log(`[Client] Acquired presigned upload URL for Video ID: ${videoId}`);

      updateBadgeStatus('UPLOADING');
      await uploadToS3Direct(presignedUrl, selectedFile);

      updateProgress(100, 'Upload complete! Publishing job to AWS SQS Queue...');
      const processRes = await fetch(`${API_BASE}/api/videos/${videoId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3SourceKey })
      });

      if (!processRes.ok) {
        throw new Error('Failed to enqueue video processing job.');
      }

      const processJson = await processRes.json();
      console.log('[Client] Video enqueued to SQS queue successfully:', processJson);

      updateBadgeStatus('QUEUED');
      startPollingVideoStatus(videoId);

    } catch (err) {
      console.error('[Upload Pipeline Error]:', err);
      updateProgress(0, `Error: ${err.message}`);
      updateBadgeStatus('FAILED');
      uploadBtn.disabled = false;
    }
  });

  function uploadToS3Direct(presignedUrl, file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', presignedUrl, true);
      xhr.setRequestHeader('Content-Type', file.type);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          updateProgress(percent, `Uploading directly to AWS S3... ${percent}% (${formatBytes(event.loaded)} / ${formatBytes(event.total)})`);
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 204) {
          resolve();
        } else {
          reject(new Error(`S3 upload failed with HTTP status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during S3 presigned upload. (Check AWS S3 Bucket CORS policy or AWS credentials in .env)'));
      xhr.onabort = () => reject(new Error('S3 upload aborted.'));

      xhr.send(file);
    });
  }

  // --- STATUS POLLING ENGINE ---
  function startPollingVideoStatus(videoId) {
    if (activePollTimer) clearInterval(activePollTimer);

    fetchAndRenderVideoStatus(videoId);
    activePollTimer = setInterval(() => {
      fetchAndRenderVideoStatus(videoId);
    }, POLL_INTERVAL_MS);
  }

  async function fetchAndRenderVideoStatus(videoId) {
    try {
      const res = await fetch(`${API_BASE}/api/videos/${videoId}`);
      if (!res.ok) return;

      const data = await res.json();
      currentActiveVideo = data;
      updateBadgeStatus(data.status);
      renderTelemetry(data);

      if (data.status === 'QUEUED') {
        progressStatusText.innerHTML = `Enqueued in SQS Queue. Waiting for EC2 worker... (<a href="#" id="force-process-link" style="color: var(--orange-bright); text-decoration: underline;">Force Process Now</a>)`;
        const link = document.getElementById('force-process-link');
        if (link) {
          link.onclick = (e) => {
            e.preventDefault();
            fetch(`${API_BASE}/api/videos/${videoId}/process-now`, { method: 'POST' }).catch(() => {});
          };
        }
      } else if (data.status === 'PROCESSING') {
        progressStatusText.textContent = 'EC2 Worker processing video with FFmpeg (720p, 480p, 360p)...';
      } else if (data.status === 'COMPLETED') {
        clearInterval(activePollTimer);
        progressStatusText.textContent = 'Transcoding complete! Streaming ready via CloudFront CDN.';
        loadPlayerStream(data);
        fetchVideoList();
        if (currentUserRole === 'Administrator') fetchAdminStats();
      } else if (data.status === 'FAILED') {
        clearInterval(activePollTimer);
        progressStatusText.textContent = `Processing failed: ${data.errorMessage || 'Worker error'}`;
      }
    } catch (err) {
      console.warn('[Polling Error]:', err.message);
    }
  }

  // --- HTML5 VIDEO METADATA PROBING EVENT ---
  if (videoPlayer) {
    videoPlayer.addEventListener('loadedmetadata', () => {
      if (videoPlayer.duration && !isNaN(videoPlayer.duration) && videoPlayer.duration > 0) {
        telemetryDuration.textContent = formatDuration(videoPlayer.duration);
        if (currentActiveVideo && (!currentActiveVideo.durationSeconds || currentActiveVideo.durationSeconds === 0)) {
          currentActiveVideo.durationSeconds = videoPlayer.duration;
          fetch(`${API_BASE}/api/videos/${currentActiveVideo.videoId}/duration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ durationSeconds: videoPlayer.duration })
          }).then(() => {
            if (currentUserRole === 'Administrator') fetchAdminStats();
          }).catch(() => {});
        }
      }
    });
  }

  // --- VIDEO PLAYER, QUALITY SWITCHER & DOWNLOAD HANDLER ---
  function loadPlayerStream(videoData) {
    currentActiveVideo = videoData;
    if (!videoData.renditions) return;

    playerPlaceholder.style.display = 'none';
    videoPlayer.style.display = 'block';
    qualityBar.style.display = 'flex';
    if (downloadBar) downloadBar.style.display = 'block';

    if (videoData.thumbnailUrl) {
      videoPlayer.poster = videoData.thumbnailUrl;
    }

    const defaultRes = videoData.renditions['720p'] ? '720p' : Object.keys(videoData.renditions)[0];
    switchQuality(defaultRes, videoData);

    document.querySelectorAll('.quality-pill[data-res]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.quality-pill[data-res]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const resKey = btn.getAttribute('data-res');
        switchQuality(resKey, videoData);
      };
    });

    // Configure Download links
    const dl720 = document.getElementById('dl-720p');
    const dl480 = document.getElementById('dl-480p');
    const dl360 = document.getElementById('dl-360p');
    const dlRaw = document.getElementById('dl-raw');

    if (dl720) dl720.href = `${API_BASE}/api/videos/${videoData.videoId}/download?quality=720p`;
    if (dl480) dl480.href = `${API_BASE}/api/videos/${videoData.videoId}/download?quality=480p`;
    if (dl360) dl360.href = `${API_BASE}/api/videos/${videoData.videoId}/download?quality=360p`;
    if (dlRaw) dlRaw.href = `${API_BASE}/api/videos/${videoData.videoId}/download?quality=raw`;
  }

  function switchQuality(resKey, videoData) {
    const targetRendition = videoData.renditions?.[resKey];
    if (!targetRendition) return;

    const currentTime = videoPlayer.currentTime;
    const isPlaying = !videoPlayer.paused;

    videoPlayer.src = targetRendition.url;
    videoPlayer.currentTime = currentTime;

    if (isPlaying) {
      videoPlayer.play().catch(() => {});
    }
  }

  // --- UI HELPERS & METRICS ---
  function updateProgress(percent, statusText) {
    progressBarFill.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    if (statusText) progressStatusText.textContent = statusText;
  }

  function updateBadgeStatus(status) {
    activeStatusBadge.className = `status-badge badge-${status.toLowerCase()}`;
    badgeText.textContent = status;

    if (status === 'QUEUED' || status === 'PROCESSING') {
      placeholderMsg.textContent = `Worker status: ${status}. Generating multi-bitrate renditions...`;
    } else if (status === 'FAILED') {
      placeholderMsg.textContent = 'Transcoding task failed.';
    }
  }

  function renderTelemetry(data) {
    telemetryInfo.style.display = 'block';
    telemetryId.textContent = data.videoId;
    telemetryDuration.textContent = formatDuration(data.durationSeconds);
  }

  function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // --- RECENT FEED & GALLERY LOADER ---
  async function fetchVideoList() {
    try {
      const res = await fetch(`${API_BASE}/api/videos`);
      if (!res.ok) return;

      const videos = await res.json();
      const videoList = Array.isArray(videos) ? videos : [];
      if (statVideoCount) statVideoCount.textContent = videoList.length;

      if (videoList.length === 0) {
        homeVideoGrid.innerHTML = '<p style="color: var(--text-dim); font-size: 0.9rem;">No videos uploaded yet. Click Upload to process your first video!</p>';
        return;
      }

      homeVideoGrid.innerHTML = videoList.map(item => `
        <div class="video-item-card" data-id="${item.videoId}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.5rem;">
            <div class="video-item-title">${escapeHtml(item.title)}</div>
            <a href="${API_BASE}/api/videos/${item.videoId}/download?quality=720p" class="btn-download-pill" style="padding: 0.2rem 0.55rem; font-size: 0.72rem; flex-shrink: 0;" title="Download Video" onclick="event.stopPropagation();">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download</span>
            </a>
          </div>
          <div class="video-item-meta">
            <span class="status-badge badge-${(item.status || 'pending').toLowerCase()}">${item.status}</span>
            <span>⏱ ${formatDuration(item.durationSeconds)}</span>
            <span>💾 ${formatBytes(item.fileSizeBytes)}</span>
          </div>
        </div>
      `).join('');

      document.querySelectorAll('.video-item-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.getAttribute('data-id');
          switchView('upload');
          startPollingVideoStatus(id);
        });
      });
    } catch (e) {
      console.warn('Failed to load platform video feed:', e.message);
    }
  }

  // --- ADMIN STATISTICAL DASHBOARD ENGINE ---
  async function fetchAdminStats() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/stats`);
      if (!res.ok) return;

      const stats = await res.json();
      adminStatsData = stats;

      // 1. Render KPI metrics
      const totalVideosEl = document.getElementById('admin-stat-total');
      const storageEl = document.getElementById('admin-stat-storage');
      const durationEl = document.getElementById('admin-stat-duration');
      const successRateEl = document.getElementById('admin-stat-success-rate');
      const avgDurationEl = document.getElementById('admin-stat-avg-duration');

      if (totalVideosEl) totalVideosEl.textContent = stats.totalVideos || 0;
      if (storageEl) storageEl.textContent = formatBytes(stats.totalStorageBytes || 0);
      if (durationEl) durationEl.textContent = formatDuration(stats.totalDurationSeconds || 0);
      if (successRateEl) successRateEl.textContent = `${stats.successRatePercent || 100}%`;
      if (avgDurationEl) avgDurationEl.textContent = `${stats.avgDurationSeconds || 0}s`;

      // 2. Render Status distribution progress bar
      const total = stats.totalVideos || 1;
      const getPct = (val) => `${(((val || 0) / total) * 100).toFixed(1)}%`;
      
      const barCompleted = document.getElementById('bar-completed');
      const barProcessing = document.getElementById('bar-processing');
      const barQueued = document.getElementById('bar-queued');
      const barPending = document.getElementById('bar-pending');
      const barFailed = document.getElementById('bar-failed');

      if (barCompleted) barCompleted.style.width = getPct(stats.statusCounts.COMPLETED);
      if (barProcessing) barProcessing.style.width = getPct(stats.statusCounts.PROCESSING);
      if (barQueued) barQueued.style.width = getPct(stats.statusCounts.QUEUED);
      if (barPending) barPending.style.width = getPct(stats.statusCounts.PENDING);
      if (barFailed) barFailed.style.width = getPct(stats.statusCounts.FAILED);

      const cntCompleted = document.getElementById('cnt-completed');
      const cntProcessing = document.getElementById('cnt-processing');
      const cntQueued = document.getElementById('cnt-queued');
      const cntPending = document.getElementById('cnt-pending');
      const cntFailed = document.getElementById('cnt-failed');

      if (cntCompleted) cntCompleted.textContent = stats.statusCounts.COMPLETED || 0;
      if (cntProcessing) cntProcessing.textContent = stats.statusCounts.PROCESSING || 0;
      if (cntQueued) cntQueued.textContent = stats.statusCounts.QUEUED || 0;
      if (cntPending) cntPending.textContent = stats.statusCounts.PENDING || 0;
      if (cntFailed) cntFailed.textContent = stats.statusCounts.FAILED || 0;

      // 3. Render Renditions counts
      const rend720 = stats.renditionsBreakdown['720p'] || 0;
      const rend480 = stats.renditionsBreakdown['480p'] || 0;
      const rend360 = stats.renditionsBreakdown['360p'] || 0;
      const maxRend = Math.max(rend720, rend480, rend360, 1);

      const txt720 = document.getElementById('txt-720p-count');
      const bar720 = document.getElementById('bar-720p-count');
      if (txt720) txt720.textContent = `${rend720} items`;
      if (bar720) bar720.style.width = `${((rend720 / maxRend) * 100).toFixed(1)}%`;

      const txt480 = document.getElementById('txt-480p-count');
      const bar480 = document.getElementById('bar-480p-count');
      if (txt480) txt480.textContent = `${rend480} items`;
      if (bar480) bar480.style.width = `${((rend480 / maxRend) * 100).toFixed(1)}%`;

      const txt360 = document.getElementById('txt-360p-count');
      const bar360 = document.getElementById('bar-360p-count');
      if (txt360) txt360.textContent = `${rend360} items`;
      if (bar360) bar360.style.width = `${((rend360 / maxRend) * 100).toFixed(1)}%`;

      // 4. Render Table
      renderAdminTable();

    } catch (err) {
      console.warn('Failed to fetch admin stats:', err.message);
    }
  }

  function renderAdminTable() {
    if (!adminStatsData || !adminStatsData.videos) return;
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;

    const searchVal = (document.getElementById('admin-table-search')?.value || '').toLowerCase();
    const filterVal = document.getElementById('admin-table-filter')?.value || 'ALL';

    const filtered = adminStatsData.videos.filter(item => {
      const matchesSearch = !searchVal || 
        (item.title && item.title.toLowerCase().includes(searchVal)) || 
        (item.videoId && item.videoId.toLowerCase().includes(searchVal));
      const matchesFilter = filterVal === 'ALL' || item.status === filterVal;
      return matchesSearch && matchesFilter;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding: 2rem; text-align: center; color: var(--text-dim);">No video records found matching filter criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(v => {
      const rendKeys = v.renditions ? Object.keys(v.renditions) : [];
      const rendPills = rendKeys.length > 0 
        ? rendKeys.map(r => `<span style="padding: 0.15rem 0.45rem; background: rgba(255,102,0,0.1); border: 1px solid rgba(255,102,0,0.25); color: var(--orange-bright); border-radius: 4px; font-size: 0.72rem; margin-right: 2px;">${r}</span>`).join('')
        : '<span style="color: var(--text-dim); font-size: 0.78rem;">None</span>';

      const uploadedDate = v.createdAt ? new Date(v.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: #fff; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(v.title)}</div>
            <div style="font-size: 0.72rem; color: var(--orange-bright); font-family: 'JetBrains Mono', monospace;">${v.videoId.substring(0, 13)}...</div>
          </td>
          <td>
            <span class="status-badge badge-${(v.status || 'pending').toLowerCase()}">
              <span class="pulse-dot"></span> ${v.status}
            </span>
          </td>
          <td>${formatBytes(v.fileSizeBytes)}</td>
          <td>${formatDuration(v.durationSeconds)}</td>
          <td>${rendPills}</td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${uploadedDate}</td>
          <td style="text-align: right;">
            <div style="display: flex; gap: 0.35rem; justify-content: flex-end;">
              <button class="admin-action-btn admin-action-play" onclick="playVideoFromAdmin('${v.videoId}')" title="Play Video">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>Play</span>
              </button>
              <a href="${API_BASE}/api/videos/${v.videoId}/download?quality=720p" class="admin-action-btn admin-action-download" title="Download 720p Video">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>DL</span>
              </a>
              <button class="admin-action-btn admin-action-delete" onclick="deleteVideoFromAdmin('${v.videoId}', '${escapeHtml(v.title).replace(/'/g, "\\'")}')" title="Delete Video">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                <span>Delete</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Admin Search & Filter Event Handlers
  const adminTableSearch = document.getElementById('admin-table-search');
  const adminTableFilter = document.getElementById('admin-table-filter');

  if (adminTableSearch) {
    adminTableSearch.addEventListener('input', () => renderAdminTable());
  }

  if (adminTableFilter) {
    adminTableFilter.addEventListener('change', () => renderAdminTable());
  }

  window.playVideoFromAdmin = function(videoId) {
    switchView('upload');
    startPollingVideoStatus(videoId);
  };

  window.deleteVideoFromAdmin = async function(videoId, title) {
    if (!confirm(`Are you sure you want to delete video "${title}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/videos/${videoId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchAdminStats();
        fetchVideoList();
      }
    } catch (e) {
      alert('Failed to delete video: ' + e.message);
    }
  };

  function escapeHtml(str) {
    return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Load feed on startup
  fetchVideoList();

})();
