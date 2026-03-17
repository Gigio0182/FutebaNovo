const APP_VERSION = 'v2026.03.17-4';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }).catch(() => {
      // Silent fail: app works online even if SW registration fails.
    });
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const badge = document.createElement('div');
  badge.className = 'version-badge';
  badge.textContent = APP_VERSION;
  document.body.appendChild(badge);
});
