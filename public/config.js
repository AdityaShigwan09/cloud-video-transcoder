// Runtime Environment Configuration
window.APP_CONFIG = {
  // Base URL for the Express API server (leave blank to auto-detect current origin)
  apiBaseUrl: window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
    ? ''
    : 'http://localhost:4000',
  
  // Status polling frequency in milliseconds
  pollIntervalMs: 3000
};
