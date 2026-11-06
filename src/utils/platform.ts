
/**
 * Platform utility for Achour Player
 * Handles environment detection and URL adaptation (Proxy vs Direct)
 */

export const isAndroid = (): boolean => {
  if (typeof window === 'undefined') return false;
  return !!((window as any).AchourNative);
};

export const isAndroidDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return !!((window as any).AchourNative || /android/i.test(ua) || ua.includes('wv') || (ua.includes('android') && ua.includes('version/')));
};

export const isFireTV = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('firetv') || ua.includes('fire tv') || ua.includes('aft') || ua.includes('amazon');
};


/**
 * Transforms a URL based on the environment.
 * For API requests (m3u, xtream, stalker, epg, get), ALWAYS use the proxy route
 * to avoid CORS and Mixed-Content (HTTPS -> HTTP) blocking.
 * Inside Android APK, WebViewClient.shouldInterceptRequest handles /api/proxy/* natively.
 */
export const getPlatformUrl = (type: 'stream' | 'm3u' | 'xtream' | 'stalker' | 'epg' | 'get', rawUrl: string, params: Record<string, string> = {}): string => {
  if (!rawUrl) return '';

  // Stream URLs in Native Android ExoPlayer or Hls.js on Android
  // We prefer direct URLs for video segments to avoid overhead.
  if (type === 'stream' && isAndroid()) {
    return rawUrl;
  }

  // Use proxy route for all API/Data requests.
  const query = new URLSearchParams({ url: rawUrl, ...params });
  const proxyPath = `/api/proxy/${type}?${query.toString()}`;

  // Inside Android APK, we use a virtual domain to ensure the WebViewClient 
  // intercepts the request and performs it natively to bypass CORS/SSL blocks.
  if (isAndroid()) {
    return `https://native.achour.proxy${proxyPath}`;
  }

  return proxyPath;
};



