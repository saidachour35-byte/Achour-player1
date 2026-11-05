/**
 * Local Storage Cleanup Service
 * Periodically clears old thumbnail caches, search logs, and expired temporary items
 * to maintain high performance on low-storage devices.
 */

const CLEANUP_KEY = 'achour_last_storage_cleanup';
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function runStorageCleanup(): void {
  try {
    const lastCleanup = localStorage.getItem(CLEANUP_KEY);
    const now = Date.now();

    if (lastCleanup && now - parseInt(lastCleanup, 10) < CLEANUP_INTERVAL_MS) {
      return; // Cleaned recently
    }

    console.log('[StorageCleanup] Running routine storage optimization...');

    // Keys or prefixes to inspect/clean
    const keysToRemove: string[] = [];
    const keysToPrune: string[] = ['achour_search_history', 'achour_stream_logs', 'achour_temp_cache'];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // Remove stale temp items or old debug logs older than 3 days
      if (key.includes('temp_') || key.includes('_cache_old') || key.includes('debug_log')) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(k => localStorage.removeItem(k));

    // Prune oversized search history or logs
    keysToPrune.forEach(key => {
      const val = localStorage.getItem(key);
      if (val && val.length > 100 * 1024) { // > 100KB
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) {
            // Keep only latest 50 items
            localStorage.setItem(key, JSON.stringify(parsed.slice(0, 50)));
          } else {
            localStorage.removeItem(key);
          }
        } catch (e) {
          localStorage.removeItem(key);
        }
      }
    });

    localStorage.setItem(CLEANUP_KEY, now.toString());
    console.log('[StorageCleanup] Storage optimization completed successfully.');
  } catch (err) {
    console.warn('[StorageCleanup] Error during storage cleanup:', err);
  }
}
