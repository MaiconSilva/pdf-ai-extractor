'use strict';

function createLogger(debug = false) {
  return {
    debug(...args) {
      if (debug) {
        console.log('[pdf-ai-extractor]', ...args);
      }
    },
    info(...args) {
      if (debug) {
        console.info('[pdf-ai-extractor]', ...args);
      }
    },
    warn(...args) {
      if (debug) {
        console.warn('[pdf-ai-extractor]', ...args);
      }
    },
    error(...args) {
      if (debug) {
        console.error('[pdf-ai-extractor]', ...args);
      }
    },
  };
}

module.exports = { createLogger };
