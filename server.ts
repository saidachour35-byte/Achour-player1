import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from "@google/genai";
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Configure global agents for IPTV streaming (bypass self-signed/expired certs on IPTV servers)
const insecureHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  checkServerIdentity: () => undefined
});
const defaultHttpAgent = new http.Agent({
  keepAlive: true
});

axios.defaults.httpsAgent = insecureHttpsAgent;
axios.defaults.httpAgent = defaultHttpAgent;

// Gemini Initialization
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const IPTV_USER_AGENTS = [
  'TiviMate/4.7.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003)',
  'IPTVSmartersPro/3.1.5 (Linux; Android 12)',
  'ExoPlayerLib/2.18.7',
  'Android/Media3/1.1.1',
  'VLC/3.0.20 LibVLC/3.0.20',
  'Lavf/60.3.100',
  'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 MAG200/2.0.2',
  'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/76.0.3809.146 TV Safari/537.36',
  'AppleCoreMedia/1.0.0.19G69 (Apple TV; U; CPU OS 15_6 like Mac OS X)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
];

function getSafeHttpStatus(status?: number, defaultStatus = 502): number {
  if (typeof status === 'number' && status >= 200 && status <= 599) {
    return status;
  }
  return defaultStatus;
}

// IPTV Proxies
app.get('/api/proxy/m3u', async (req, res) => {
  const rawUrl = (req.query.url || req.query.link) as string | undefined;
  if (!rawUrl) {
    return res.status(400).json({ error: 'Missing m3u url parameter' });
  }

  let sanitizedUrl = rawUrl.trim();
  if (sanitizedUrl.includes('github.com/') && sanitizedUrl.includes('/blob/')) {
    sanitizedUrl = sanitizedUrl.replace('github.com/', 'raw.githubusercontent.com/').replace('/blob/', '/');
  }
  if (!sanitizedUrl.startsWith('http://') && !sanitizedUrl.startsWith('https://')) {
    sanitizedUrl = 'http://' + sanitizedUrl;
  }

  let lastStatus = 500;
  let lastErrMsg = '';

  for (const ua of IPTV_USER_AGENTS) {
    try {
      const response = await axios.get(sanitizedUrl, {
        timeout: 25000,
        responseType: 'text',
        headers: {
          'User-Agent': ua,
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Iptv-User-Agent': 'IPTVSmarters'
        },
        maxRedirects: 10,
        validateStatus: () => true // Allow handling non-standard statuses (e.g. 884)
      });

      lastStatus = response.status;
      const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      const hasM3USignature = text.includes('#EXTM3U') || text.includes('#EXTINF') || (text.includes('http') && text.length > 20);

      if (hasM3USignature || (response.status >= 200 && response.status < 300)) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(response.data);
      }

      lastErrMsg = `Upstream status ${response.status}`;
    } catch (err: any) {
      lastErrMsg = err.message || 'Request failed';
      lastStatus = err.response?.status || lastStatus;
    }
  }

  const is884 = lastStatus === 884 || lastErrMsg.includes('884');
  const isConnRefused = lastErrMsg.includes('ECONNREFUSED');
  const isTimeout = lastErrMsg.includes('timeout') || lastErrMsg.includes('ETIMEDOUT');

  console.warn(`[M3U Proxy] ${sanitizedUrl} returned status ${lastStatus} (${lastErrMsg})`);

  const safeStatus = getSafeHttpStatus(lastStatus, 502);
  res.status(safeStatus).json({
    error: is884 
      ? 'Upstream IPTV server connection limit reached or account expired (Code 884)' 
      : isConnRefused
        ? 'IPTV Server refused connection. The server might be down or blocking the IP.'
        : isTimeout
          ? 'IPTV Server timed out. The connection is too slow.'
          : 'Failed to fetch M3U playlist from IPTV provider',
    upstreamStatus: lastStatus,
    message: lastErrMsg
  });
});

app.get('/api/proxy/xtream', async (req, res) => {
  let rawHost = (req.query.url || req.query.portal || req.query.host) as string | undefined;
  let username = req.query.username as string | undefined;
  let password = req.query.password as string | undefined;
  let action = req.query.action as string | undefined;

  if (rawHost) {
    try {
      const uObj = new URL(rawHost.startsWith('http') ? rawHost : 'http://' + rawHost);
      const u = uObj.searchParams.get('username');
      const p = uObj.searchParams.get('password');
      const a = uObj.searchParams.get('action');
      if (u && !username) username = u;
      if (p && !password) password = p;
      if (a && !action) action = a;

      uObj.searchParams.forEach((val, key) => {
        if (key !== 'username' && key !== 'password' && key !== 'action' && key !== 'url' && val) {
          if (!req.query[key]) {
            (req.query as any)[key] = val;
          }
        }
      });
    } catch (e) {}
  }

  if (!rawHost || username === undefined || password === undefined) {
    return res.status(400).json({ 
      error: 'Missing parameters', 
      received: { host: !!rawHost, username: username !== undefined, password: password !== undefined } 
    });
  }

  let sanitizedUrl = rawHost.trim().replace(/\/+$/, '');
  sanitizedUrl = sanitizedUrl.replace(/\/(player_api|get|index)\.php.*$/i, '').replace(/\/c\/?$/i, '').replace(/\?.*$/, '').replace(/\/+$/, '');
  if (!sanitizedUrl.startsWith('http://') && !sanitizedUrl.startsWith('https://')) {
    sanitizedUrl = 'http://' + sanitizedUrl;
  }

  let additionalParams = '';
  if (action && action !== 'auth' && action !== 'login') {
    additionalParams += `&action=${encodeURIComponent(action.trim())}`;
  }

  const reservedParams = new Set(['url', 'portal', 'host', 'username', 'password', 'action']);
  for (const [key, val] of Object.entries(req.query)) {
    if (!reservedParams.has(key) && val !== undefined && val !== '') {
      additionalParams += `&${encodeURIComponent(key)}=${encodeURIComponent(String(val).trim())}`;
    }
  }

  const targetUrls = [
    `${sanitizedUrl}/player_api.php?username=${encodeURIComponent(username.trim())}&password=${encodeURIComponent(password.trim())}${additionalParams}`,
    `${sanitizedUrl}/get.php?username=${encodeURIComponent(username.trim())}&password=${encodeURIComponent(password.trim())}${additionalParams}`,
    `${sanitizedUrl}/index.php?username=${encodeURIComponent(username.trim())}&password=${encodeURIComponent(password.trim())}${additionalParams}`
  ];

  let lastStatus = 500;
  let lastErrMsg = '';

  const primaryUas = [
    'IPTVSmartersPro/3.1.5 (Linux; Android 12)',
    'TiviMate/4.7.0 (Linux; Android 11; SHIELD Android TV)',
    'ExoPlayerLib/2.18.7'
  ];

  for (const targetUrl of targetUrls) {
    for (const ua of primaryUas) {
      try {
        console.log(`[Xtream Proxy] Requesting: ${targetUrl} (Action: ${action || 'auth'})`);
        const response = await axios.get(targetUrl, { 
          timeout: 20000,
          headers: { 
            'User-Agent': ua,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
            'X-Requested-With': 'com.nathnetwork.iptvsmarters',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive'
          },
          validateStatus: (status) => (status >= 200 && status < 400) || status === 884
        });

        lastStatus = response.status;
        
        let rawData = response.data;
        if (typeof rawData === 'string') {
          const trimmed = rawData.trim();
          if (trimmed.startsWith('<')) {
            console.warn(`[Xtream Proxy] Upstream returned HTML (status ${response.status}) instead of JSON for action ${action}`);
            if (response.status === 403) {
              lastErrMsg = 'Forbidden: Server blocked access or IP/User-Agent (403)';
            } else if (response.status === 429) {
              lastErrMsg = 'Too Many Requests: Rate limited (429)';
            } else {
              lastErrMsg = 'Upstream server returned HTML block or error page';
            }
            continue;
          }
          try { rawData = JSON.parse(rawData); } catch(e) {}
        }

        if (rawData && typeof rawData === 'object') {
          return res.json(rawData);
        }
        
        lastErrMsg = `Invalid data format`;
      } catch (error: any) {
        lastStatus = error.response?.status || 500;
        lastErrMsg = error.message;

        if (lastStatus === 429 || lastStatus === 403) {
          console.warn(`[Xtream Proxy] Status ${lastStatus} encountered. Delaying before retry...`);
          await new Promise(resolve => setTimeout(resolve, 2500));
          continue;
        }
        
        console.error(`[Xtream Proxy Error] Action: ${action}, Status: ${lastStatus}, Msg: ${lastErrMsg}`);
      }
    }
  }

  const is884 = lastStatus === 884 || lastErrMsg.includes('884');
  const isConnRefused = lastErrMsg.includes('ECONNREFUSED');
  const isTimeout = lastErrMsg.includes('timeout') || lastErrMsg.includes('ETIMEDOUT');

  console.warn(`[Xtream Proxy] ${sanitizedUrl} returned status ${lastStatus} (${lastErrMsg})`);

  const safeStatus = getSafeHttpStatus(lastStatus, 502);
  res.status(safeStatus).json({ 
    error: is884 
      ? 'Xtream provider rejected connection (Status 884: Max connections reached or expired)' 
      : isConnRefused
        ? 'Xtream Server refused connection. The server might be down or blocking the IP.'
        : isTimeout
          ? 'Xtream Server timed out. The connection is too slow.'
          : 'Failed to fetch from Xtream provider', 
    upstreamStatus: lastStatus, 
    message: lastErrMsg 
  });
});

app.get('/api/proxy/stalker', async (req, res) => {
  const rawHost = (req.query.url || req.query.portal) as string | undefined;
  const action = req.query.action as string | undefined;
  const type = req.query.type as string | undefined;
  const mac = (req.query.mac || req.query.macAddress || '00:1A:79:00:00:01') as string;

  if (!rawHost) {
    return res.status(400).json({ error: 'Missing portal url' });
  }

  let sanitizedUrl = rawHost.trim().replace(/\/+$/, '');
  if (!sanitizedUrl.startsWith('http://') && !sanitizedUrl.startsWith('https://')) {
    sanitizedUrl = 'http://' + sanitizedUrl;
  }

  let stalkerBase = sanitizedUrl;
  if (!stalkerBase.includes('/server/load.php') && !stalkerBase.includes('load.php')) {
    stalkerBase = `${stalkerBase}/server/load.php`;
  }

  const currentAction = action || 'handshake';
  const currentType = type || (currentAction === 'handshake' || currentAction === 'get_profile' ? 'stb' : 'itv');
  const targetUrl = `${stalkerBase}?type=${encodeURIComponent(currentType)}&action=${encodeURIComponent(currentAction)}`;

  try {
    const response = await axios.get(targetUrl, { 
      timeout: 18000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200/2.0.2 Safari/533.3',
        'X-User-Agent': 'Model: MAG250; Link: WiFi',
        'Cookie': `mac=${encodeURIComponent(mac.trim())}; stb_lang=en; timezone=Europe%2FBerlin;`
      },
      validateStatus: () => true
    });

    if (response.status >= 200 && response.status < 300) {
      return res.json(response.data);
    }
    if (response.data) {
      return res.json(response.data);
    }

    const safeStatus = getSafeHttpStatus(response.status, 502);
    res.status(safeStatus).json({ error: 'Stalker portal returned non-200 status', upstreamStatus: response.status });
  } catch (error: any) {
    const lastStatus = error.response?.status || 500;
    console.warn(`[Stalker Proxy] ${sanitizedUrl} error: ${error.message}`);
    const safeStatus = getSafeHttpStatus(lastStatus, 502);
    res.status(safeStatus).json({ error: 'Failed to fetch from Stalker Portal', message: error.message, upstreamStatus: lastStatus });
  }
});

// Playlist Validator Endpoint
app.post('/api/validate/playlist', async (req, res) => {
  const { type, url, host, username, password, macAddress } = req.body;
  
  try {
    if (type === 'xtream') {
      const serverHost = url || host;
      if (!serverHost || !username || !password) {
        return res.status(400).json({ valid: false, message: 'Missing Xtream credentials' });
      }

      let sanitizedUrl = serverHost.trim().replace(/\/+$/, '');
      sanitizedUrl = sanitizedUrl.replace(/\/(player_api|get|index)\.php.*$/i, '').replace(/\/c\/?$/i, '').replace(/\?.*$/, '').replace(/\/+$/, '');
      if (!sanitizedUrl.startsWith('http://') && !sanitizedUrl.startsWith('https://')) {
        sanitizedUrl = 'http://' + sanitizedUrl;
      }

      const testUrl = `${sanitizedUrl}/player_api.php?username=${encodeURIComponent(username.trim())}&password=${encodeURIComponent(password.trim())}`;
      const response = await axios.get(testUrl, {
        timeout: 20000,
        headers: { 
          'User-Agent': 'IPTVSmartersPro/2.2.1 (Linux; Android 11)',
          'Accept': 'application/json, text/plain, */*'
        },
        maxRedirects: 10,
        httpsAgent: insecureHttpsAgent,
        httpAgent: defaultHttpAgent,
        validateStatus: (status) => (status >= 200 && status < 400) || status === 884
      });

      if (response.status === 884) {
        return res.json({
          valid: false,
          upstreamStatus: 884,
          message: 'السيرفر رفض الاتصال (كود 884: تجاوز الحد الأقصى للأجهزة المتصلة أو انتهاء الاشتراك) / Server rejected connection (Status 884: Concurrent connections limit reached or account expired)'
        });
      }

      let data = response.data;
      if (typeof data === 'string') {
        const trimmed = data.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            data = JSON.parse(trimmed);
          } catch (e) {}
        }
      }

      if (data && data.user_info) {
        const isAuth = data.user_info.auth === 1 || data.user_info.status === 'Active';
        return res.json({
          valid: isAuth,
          userInfo: data.user_info,
          serverInfo: data.server_info,
          message: isAuth ? 'Authentication successful' : (data.user_info.message || 'Account expired or invalid')
        });
      }
      return res.json({ valid: response.status >= 200 && response.status < 300, data });
    } else if (type === 'm3u') {
      if (!url) return res.status(400).json({ valid: false, message: 'Missing M3U URL' });
      let sanitizedUrl = url.trim();
      if (!sanitizedUrl.startsWith('http://') && !sanitizedUrl.startsWith('https://')) {
        sanitizedUrl = 'http://' + sanitizedUrl;
      }
      const response = await axios.get(sanitizedUrl, {
        timeout: 20000,
        headers: { 'User-Agent': 'IPTVSmartersPro/2.2.1 (Linux; Android 11)' },
        validateStatus: () => true
      });

      if (response.status === 884) {
        return res.json({
          valid: false,
          upstreamStatus: 884,
          message: 'السيرفر رفض الرابط (كود 884: تجاوز الحد الأقصى للمشاهدة المتزامنة أو انتهاء الرابط) / Stream limit exceeded or link expired (Code 884)'
        });
      }

      const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      const isM3U = text.includes('#EXTM3U') || text.includes('#EXTINF') || text.includes('http');
      const channelCount = (text.match(/#EXTINF:/g) || []).length;
      return res.json({ valid: isM3U, channelCount, message: isM3U ? `Found ${channelCount} channels` : 'Invalid M3U format' });
    } else if (type === 'stalker') {
      const portal = url || host;
      if (!portal || !macAddress) return res.status(400).json({ valid: false, message: 'Missing Portal URL or MAC Address' });
      let sanitizedUrl = portal.trim().replace(/\/+$/, '');
      if (!sanitizedUrl.startsWith('http://') && !sanitizedUrl.startsWith('https://')) {
        sanitizedUrl = 'http://' + sanitizedUrl;
      }
      let stalkerBase = sanitizedUrl;
      if (!stalkerBase.includes('/server/load.php') && !stalkerBase.includes('load.php')) {
        stalkerBase = `${stalkerBase}/server/load.php`;
      }
      const response = await axios.get(`${stalkerBase}?type=stb&action=handshake`, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200/2.0.2 Safari/533.3',
          'Cookie': `mac=${encodeURIComponent(macAddress.trim())};`
        },
        validateStatus: () => true
      });
      return res.json({ valid: response.status >= 200 && response.status < 300, data: response.data, message: 'Portal responded' });
    }
    res.status(400).json({ valid: false, message: 'Unsupported playlist type' });
  } catch (err: any) {
    res.status(500).json({ valid: false, message: err.message || 'Validation failed' });
  }
});

const VPN_REGION_PROFILES: Record<string, { name: string; ipPrefix: string; userAgent: string }> = {
  nl: { name: 'Netherlands (Amsterdam Edge Node)', ipPrefix: '185.220.101.', userAgent: 'TiviMate/4.7.0 (Linux; Android 11; SHIELD Android TV)' },
  de: { name: 'Germany (Frankfurt Relay Node)', ipPrefix: '194.36.191.', userAgent: 'IPTVSmartersPro/3.1.5 (Linux; Android 12)' },
  uk: { name: 'United Kingdom (London Gateway)', ipPrefix: '178.62.198.', userAgent: 'VLC/3.0.20 LibVLC/3.0.20' },
  us: { name: 'United States (East Coast Node)', ipPrefix: '198.51.100.', userAgent: 'AppleCoreMedia/1.0.0.19G69 (Apple TV)' },
  ae: { name: 'United Arab Emirates (Dubai Fast Node)', ipPrefix: '185.125.190.', userAgent: 'Mozilla/5.0 (SMART-TV; Tizen 6.0)' },
  auto: { name: 'Auto Best Node (Smart Relay)', ipPrefix: '185.220.101.', userAgent: 'TiviMate/4.7.0 (Linux; Android 11)' }
};

app.get('/api/proxy/stream', async (req, res) => {
  const { url, vpnRegion } = req.query;
  if (!url) return res.status(400).send('Missing url');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  let sanitizedUrl = (url as string).trim();
  if (!sanitizedUrl.startsWith('http://') && !sanitizedUrl.startsWith('https://')) {
    sanitizedUrl = 'http://' + sanitizedUrl;
  }

  const regionKey = (vpnRegion as string) || 'auto';
  console.log(`[Stream Proxy] Requesting: ${sanitizedUrl} (Region: ${regionKey})`);

  let urlObj: URL;
  try {
    urlObj = new URL(sanitizedUrl);
  } catch (e) {
    console.warn(`[Stream Proxy] Invalid URL provided: ${sanitizedUrl}`);
    return res.status(400).send('Invalid URL format');
  }

  const hostname = urlObj.hostname.toLowerCase();
  const isCdn = hostname.includes('akamaized.net') || 
                hostname.includes('akamaihd.net') || 
                hostname.includes('getaj.net') || 
                hostname.includes('aljazeera.net') ||
                hostname.includes('cloudfront.net') || 
                hostname.includes('fastly.net') || 
                hostname.includes('cloudflare.com');

  const initialProfile = VPN_REGION_PROFILES[regionKey] || VPN_REGION_PROFILES['auto'];
  
  // List of regions to try
  const regionsToTry = [regionKey];
  if (regionKey === 'auto') {
    regionsToTry.push('nl', 'de', 'us', 'ae');
  } else {
    regionsToTry.push('auto');
  }

  let lastError: any = null;
  let lastStatus = 500;
  let successfulPipe = false;

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'AppleCoreMedia/1.0.0.19G69 (Apple TV; U; CPU OS 15_6 like Mac OS X)',
    'ExoPlayerLib/2.18.7',
    'VLC/3.0.20 LibVLC/3.0.20',
    'TiviMate/4.7.0 (Linux; Android 11; SHIELD Android TV)'
  ];

  for (const currentRegion of regionsToTry) {
    if (successfulPipe) break;
    
    const profile = VPN_REGION_PROFILES[currentRegion] || initialProfile;
    const simulatedIp = `${profile.ipPrefix}${Math.floor(Math.random() * 200) + 10}`;

    // For CDNs, do NOT send fake IP headers as CDNs check real edge connections and flag 403
    const fakeIpVariants = isCdn ? [false] : [false, true];

    for (const includeFakeIp of fakeIpVariants) {
      if (successfulPipe) break;
      for (const ua of userAgents) {
        if (successfulPipe) break;
        try {
          const headers: Record<string, string> = {
            'User-Agent': ua,
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
            'Connection': 'keep-alive'
          };

          // Special referer rules for specific CDN hosts
          if (hostname.includes('getaj.net') || hostname.includes('aljazeera.net')) {
            headers['Referer'] = 'https://www.aljazeera.net/';
            headers['Origin'] = 'https://www.aljazeera.net';
          } else if (req.query.referer) {
            headers['Referer'] = req.query.referer as string;
          }

          if (includeFakeIp) {
            headers['X-Forwarded-For'] = simulatedIp;
            headers['X-Real-IP'] = simulatedIp;
          }

          if (req.headers.range) {
            headers['Range'] = req.headers.range as string;
          }

          // Special manifest rewrite logic
          if (sanitizedUrl.includes('.m3u8') || sanitizedUrl.includes('.smil') || (req.query.manifest === 'true')) {
            try {
              const textRes = await axios.get(sanitizedUrl, {
                timeout: 15000,
                responseType: 'text',
                headers,
                maxRedirects: 10,
                validateStatus: () => true
              });

              if (textRes.status === 404) {
                throw { response: textRes, message: 'Manifest not found (404)' };
              }
              if (textRes.status === 884) {
                throw { response: textRes, message: 'Concurrent limit reached (884)' };
              }
              if (textRes.status >= 400) {
                throw { response: textRes, message: `Upstream error ${textRes.status}` };
              }

              let manifestText = typeof textRes.data === 'string' ? textRes.data : JSON.stringify(textRes.data);
              
              const rewrittenLines = manifestText.split(/\r?\n/).map(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return line;
                
                let absSegmentUrl = trimmed;
                if (!absSegmentUrl.startsWith('http://') && !absSegmentUrl.startsWith('https://')) {
                  try {
                    const base = new URL(sanitizedUrl);
                    const segmentUrlObj = new URL(trimmed, base.href);
                    if (base.search && !segmentUrlObj.search) {
                      segmentUrlObj.search = base.search;
                    }
                    absSegmentUrl = segmentUrlObj.toString();
                  } catch (e) {
                    const lastSlash = sanitizedUrl.lastIndexOf('/');
                    const cleanBase = lastSlash !== -1 ? sanitizedUrl.substring(0, lastSlash + 1) : sanitizedUrl + '/';
                    absSegmentUrl = `${cleanBase}${trimmed.replace(/^\/+/, '')}`;
                  }
                }
                return `/api/proxy/stream?url=${encodeURIComponent(absSegmentUrl)}&vpnRegion=${encodeURIComponent(currentRegion)}`;
              });

              res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
              res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
              successfulPipe = true;
              return res.status(200).send(rewrittenLines.join('\n'));
            } catch (manifestErr: any) {
              const status = manifestErr.response?.status || 'unknown';
              console.warn(`[Stream Proxy] Manifest fetch attempt failed (Node: ${currentRegion}): status ${status} - URL: ${sanitizedUrl}`);
              lastError = manifestErr;
              lastStatus = typeof status === 'number' ? status : lastStatus;
              
              if (status === 404) break;
              continue;
            }
          }

          // Direct Stream Piping
          const response = await axios({
            method: 'get',
            url: sanitizedUrl,
            responseType: 'stream',
            timeout: 25000,
            headers,
            maxRedirects: 10,
            validateStatus: (status) => status >= 200 && status < 400
          });

          const resHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
          resHeaders.forEach(h => {
            if (response.headers[h]) res.setHeader(h, String(response.headers[h]));
          });

          res.status(response.status);
          successfulPipe = true;
          console.log(`[Stream Proxy] Piping successful for ${sanitizedUrl}`);
          return response.data.pipe(res);
        } catch (err: any) {
          lastError = err;
          lastStatus = err.response?.status || lastStatus;

          if (lastStatus === 429 || lastStatus === 503) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue; 
          }

          if (lastStatus === 404) break;
        }
      }
      if (lastStatus === 404) break;
    }
    if (lastStatus === 404) break;
  }

  // LAST RESORT: Try one final time with NO custom headers and standard browser UA
  if (!successfulPipe) {
    try {
      console.log(`[Stream Proxy] Last resort clean fetch for: ${sanitizedUrl}`);
      const cleanRes = await axios.get(sanitizedUrl, {
        timeout: 12000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
        validateStatus: (status) => status >= 200 && status < 300,
        responseType: sanitizedUrl.includes('.m3u8') ? 'text' : 'stream'
      });
      
      if (cleanRes.status === 200) {
        if (typeof cleanRes.data === 'string') {
          let manifestText = cleanRes.data;
          const rewrittenLines = manifestText.split(/\r?\n/).map(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return line;
            let absSegmentUrl = trimmed;
            if (!absSegmentUrl.startsWith('http://') && !absSegmentUrl.startsWith('https://')) {
              try {
                const base = new URL(sanitizedUrl);
                const segmentUrlObj = new URL(trimmed, base.href);
                if (base.search && !segmentUrlObj.search) segmentUrlObj.search = base.search;
                absSegmentUrl = segmentUrlObj.toString();
              } catch (e) {
                const lastSlash = sanitizedUrl.lastIndexOf('/');
                const cleanBase = lastSlash !== -1 ? sanitizedUrl.substring(0, lastSlash + 1) : sanitizedUrl + '/';
                absSegmentUrl = `${cleanBase}${trimmed.replace(/^\/+/, '')}`;
              }
            }
            return `/api/proxy/stream?url=${encodeURIComponent(absSegmentUrl)}&vpnRegion=auto`;
          });
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
          return res.status(200).send(rewrittenLines.join('\n'));
        } else {
          return cleanRes.data.pipe(res);
        }
      }
    } catch (e: any) {
      console.warn(`[Stream Proxy] Last resort fetch failed: ${e.message}`);
    }
  }

  // Final catch-all error handling
  const is404 = lastStatus === 404 || (lastError?.message && lastError.message.includes('404'));
  const is884 = lastStatus === 884 || (lastError?.message && lastError.message.includes('884'));
  const isConnRefused = lastError?.code === 'ECONNREFUSED' || lastError?.message?.includes('ECONNREFUSED');
  const isTimeout = lastError?.code === 'ETIMEDOUT' || lastError?.message?.includes('timeout');

  console.warn(`[Stream Proxy] Final failure for ${sanitizedUrl}: status ${lastStatus} (${lastError?.message || 'Failed'})`);

  const safeStatus = getSafeHttpStatus(lastStatus, 502);
  res.status(safeStatus).json({
    error: is404
      ? 'Stream link not found or expired (Status 404)'
      : is884 
        ? 'Stream rejected by provider (Status 884: Concurrent stream limit reached or account expired)' 
        : isConnRefused
          ? 'IPTV Server refused connection (ECONNREFUSED). The server might be down or blocking proxy nodes.'
          : isTimeout
            ? 'IPTV Server timed out. The connection is too slow or the server is unresponsive.'
            : 'Failed to proxy stream from IPTV provider',
    upstreamStatus: lastStatus,
    message: lastError?.message || 'Stream connection failed'
  });
});

app.get('/api/proxy/get', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  let sanitizedUrl = (url as string).trim();
  if (!sanitizedUrl.startsWith('http://') && !sanitizedUrl.startsWith('https://')) {
    sanitizedUrl = 'http://' + sanitizedUrl;
  }

  let lastStatus = 500;
  let lastErrMsg = '';
  let lastErrCode = '';

  for (const ua of IPTV_USER_AGENTS) {
    try {
      const response = await axios.get(sanitizedUrl, { 
        timeout: 20000,
        headers: {
          'User-Agent': ua,
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        },
        maxRedirects: 10,
        validateStatus: () => true
      });

      lastStatus = response.status;
      const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      const hasData = text.includes('#EXTM3U') || text.includes('#EXTINF') || (response.status >= 200 && response.status < 300);

      if (hasData) {
        return res.status(200).send(response.data);
      }
      lastErrMsg = `Status ${response.status}`;
    } catch (error: any) {
      lastErrMsg = error.message;
      lastErrCode = error.code || '';
      lastStatus = error.response?.status || 500;
    }
  }

  const is884 = lastStatus === 884 || lastErrMsg.includes('884');
  console.warn(`[General Proxy] ${sanitizedUrl} returned status ${lastStatus} (${lastErrMsg})`);

  const safeStatus = getSafeHttpStatus(lastStatus, 502);
  res.status(safeStatus).json({ 
    error: is884 
      ? 'IPTV provider connection limit reached or account expired (Status 884)' 
      : lastErrCode === 'ECONNREFUSED'
        ? 'IPTV Server refused connection. It may be offline or blocking the proxy.'
        : 'Failed to fetch content from IPTV provider',
    upstreamStatus: lastStatus, 
    message: lastErrMsg 
  });
});

// EPG Proxy
app.get('/api/proxy/epg', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing epg url' });

  let sanitizedUrl = (url as string).trim();
  if (!sanitizedUrl.startsWith('http://') && !sanitizedUrl.startsWith('https://')) {
    sanitizedUrl = 'http://' + sanitizedUrl;
  }

  try {
    const response = await axios({
      method: 'get',
      url: sanitizedUrl,
      timeout: 60000, 
      responseType: 'stream',
      headers: {
        'User-Agent': 'TiviMate/4.7.0',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate'
      },
      validateStatus: () => true
    });

    const resHeaders = ['content-type', 'content-length', 'content-encoding', 'content-disposition'];
    resHeaders.forEach(h => {
      if (response.headers[h]) res.setHeader(h, response.headers[h]);
    });

    if (!res.getHeader('Content-Type')) {
      if (sanitizedUrl.endsWith('.gz')) {
        res.setHeader('Content-Type', 'application/gzip');
      } else {
        res.setHeader('Content-Type', 'text/xml');
      }
    }

    response.data.pipe(res);
  } catch (err: any) {
    console.error(`[EPG Proxy] Error fetching ${sanitizedUrl}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch EPG data', message: err.message });
  }
});

// AI OCR Route
app.post('/api/gemini/ocr', async (req, res) => {
  const { image } = req.body; // Base64 image
  if (!image) return res.status(400).json({ error: 'No image provided' });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: image.split(',')[1] || image
          }
        },
        {
          text: "Analyze this IPTV screenshot and extract the list of channel names or category names visible. Return them as a simple comma-separated list of strings. Only return the list, no other text."
        }
      ]
    });

    res.json({ result: response.text });
  } catch (error: any) {
    console.error('Gemini OCR Error:', error.message);
    res.status(500).json({ error: 'AI analysis failed' });
  }
});

// Direct ZIP download route with forced attachment header
app.get(['/download-zip', '/achour-player.zip'], (req, res) => {
  const zipPath = path.join(__dirname, 'public', 'achour-player.zip');
  res.download(zipPath, 'achour-player.zip', (err) => {
    if (err && !res.headersSent) {
      res.status(404).send('ZIP file not found');
    }
  });
});

// Serve static files / Vite middlewares
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  // In development, mount Vite's middleware
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
  console.log('Vite middleware mounted in development');
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
