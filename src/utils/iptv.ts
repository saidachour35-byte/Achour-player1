import axios from 'axios';
import { Channel, Playlist } from '../types';

class IPTVGlobalCache extends Map<string, any> {
  categories: any[] = [];
  channels: any[] = [];
  vod: any[] = [];
  series: any[] = [];
}
export const iptvGlobalCache = new IPTVGlobalCache();
import { getLocalFavoriteIds } from './favoritesService';
import { isAndroid, getPlatformUrl } from './platform';

export const sanitizeM3uUrl = (url: string): string => {
  if (!url) return '';
  let clean = url.trim();
  if (clean.includes('github.com/') && clean.includes('/blob/')) {
    clean = clean.replace('github.com/', 'raw.githubusercontent.com/').replace('/blob/', '/');
  }
  return clean;
};

/**
 * Robust parser for M3U / M3U8 playlist format with favorite detection
 */
export const parseM3U = (data: string, favoriteIds: string[] = []): Channel[] => {
  if (!data) return [];
  const cleanData = data.replace(/^\uFEFF/, '').trim();
  if (!cleanData) return [];

  if (cleanData.startsWith('<!DOCTYPE') || cleanData.startsWith('<html') || cleanData.startsWith('<div')) {
    console.warn('Received HTML response instead of valid M3U text playlist');
    return [];
  }

  const lines = cleanData.split(/\r?\n/);
  const channels: Channel[] = [];
  let currentChannel: Partial<Channel> = {};

  const effectiveFavs = favoriteIds.length > 0 ? favoriteIds : getLocalFavoriteIds();

  for (let i = 0; i < lines.length; i++) {
    if (channels.length >= 5000) break; // Safe cap
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const logoMatch = line.match(/tvg-logo=["']([^"']*)["']/i) || line.match(/tvg-logo=([^\s,]+)/i);
      const groupMatch = line.match(/group-title=["']([^"']*)["']/i) || line.match(/group-title=([^\s,]+)/i);
      const idMatch = line.match(/tvg-id=["']([^"']*)["']/i) || line.match(/tvg-id=([^\s,]+)/i);
      const tvgNameMatch = line.match(/tvg-name=["']([^"']*)["']/i) || line.match(/tvg-name=([^\s,]+)/i);

      let inQuotes = false;
      let quoteChar = '';
      let commaPos = -1;
      for (let cIdx = 0; cIdx < line.length; cIdx++) {
        const char = line[cIdx];
        if (char === '"' || char === "'") {
          if (!inQuotes) { inQuotes = true; quoteChar = char; }
          else if (char === quoteChar) { inQuotes = false; }
        } else if (char === ',' && !inQuotes) {
          commaPos = cIdx;
          break;
        }
      }

      let extractedName = '';
      if (commaPos !== -1) extractedName = line.substring(commaPos + 1).trim();
      else if (tvgNameMatch && tvgNameMatch[1]) extractedName = tvgNameMatch[1].trim();

      currentChannel.name = extractedName || `Channel ${channels.length + 1}`;
      currentChannel.logo = logoMatch ? logoMatch[1].trim() : undefined;
      currentChannel.category = groupMatch ? groupMatch[1].trim() : 'عام (General)';
      const streamId = idMatch ? idMatch[1].trim() : `m3u-${channels.length + i + 1}`;
      currentChannel.id = `${streamId}-${i}`;
      currentChannel.stream_id = streamId;

      // Type inference
      const lowerCat = (currentChannel.category || '').toLowerCase();
      const lowerName = (currentChannel.name || '').toLowerCase();
      if (
        lowerCat.includes('movie') || lowerCat.includes('film') || lowerCat.includes('vod') ||
        lowerCat.includes('أفلام') || lowerCat.includes('افلام') || lowerCat.includes('سينما') ||
        lowerName.includes('.mp4') || lowerName.includes('.mkv')
      ) {
        currentChannel.type = 'movie';
      } else if (
        lowerCat.includes('series') || lowerCat.includes('serie') || lowerCat.includes('مسلسل') ||
        lowerCat.includes('مسلسلات') || lowerName.includes('s0') || lowerName.includes('season')
      ) {
        currentChannel.type = 'series';
      } else {
        currentChannel.type = 'live';
      }

      currentChannel.isFavorite = effectiveFavs.includes(streamId) || 
                                 effectiveFavs.includes(currentChannel.name || '');
    } else if (line.startsWith('#EXTGRP:')) {
      currentChannel.category = line.replace('#EXTGRP:', '').trim();
    } else if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('rtmp://')) {
      currentChannel.url = line;
      if (currentChannel.url) {
        if (!currentChannel.name) currentChannel.name = `Channel ${channels.length + 1}`;
        if (!currentChannel.category) currentChannel.category = 'عام (General)';
        if (!currentChannel.id) {
          const genId = `m3u-${channels.length + 1}`;
          currentChannel.id = genId;
          currentChannel.stream_id = genId;
        }
        if (!currentChannel.type) currentChannel.type = 'live';
        currentChannel.isFavorite = effectiveFavs.includes(currentChannel.id) || 
                                   effectiveFavs.includes(currentChannel.stream_id || '') || 
                                   effectiveFavs.includes(currentChannel.name);
        channels.push(currentChannel as Channel);
      }
      currentChannel = {};
    }
  }
  return channels;
};


/**
 * Ensures data is an array, handling objects with numeric keys or nested structures.
 */
export const ensureArray = (data: any): any[] => {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (data.streams && Array.isArray(data.streams)) return data.streams;
  if (data.live_streams && Array.isArray(data.live_streams)) return data.live_streams;
  if (data.vod_streams && Array.isArray(data.vod_streams)) return data.vod_streams;
  if (data.series && Array.isArray(data.series)) return data.series;
  if (data.vod_data && Array.isArray(data.vod_data)) return data.vod_data;
  if (data.channels && Array.isArray(data.channels)) return data.channels;
  if (data.categories && Array.isArray(data.categories)) return data.categories;
  if (data.data && Array.isArray(data.data)) return data.data;
  
  // Convert object with numeric keys (common in Xtream) to array
  const values = Object.values(data);
  return values.length > 0 && typeof values[0] === 'object' ? values : [];
};

import { testXtreamConnection as diagnosticTest, addToDiagnosticHistory } from './xtreamDiagnostics';

/**
 * Universal Xtream fetch helper with diagnostic logging and robust parsing
 */
export const xtreamFetch = async (
  host: string, 
  user: string, 
  pass: string, 
  action: string, 
  extraParams: Record<string, string> = {},
  retries = 2
): Promise<{ data: any; rawList: any[]; status: number; ok: boolean; error?: string }> => {
  const cleanHost = host.trim().replace(/\/+$/, '').replace(/\/(player_api|get|index)\.php.*$/i, '').replace(/\/c\/?$/i, '').replace(/\?.*$/, '');
  const apiUrl = `${cleanHost}/player_api.php`;
  
  const queryParams: Record<string, string> = {
    username: user,
    password: pass,
    action: action,
    ...extraParams
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        // Delay before retry to bypass IPTV rate limiting
        await new Promise(r => setTimeout(r, 800 * attempt));
      }

      const proxyUrl = getPlatformUrl('xtream', apiUrl, queryParams);
      const response = await fetch(proxyUrl);
      const status = response.status;

      if ((status === 429 || status === 403) && attempt < retries) {
        console.warn(`[Xtream Fetch] Status ${status} for action ${action}, retrying (${attempt + 1}/${retries})...`);
        continue;
      }

      const text = await response.text();
      let data = null;
      let isHtml = false;

      if (text.trim().startsWith('<')) {
        isHtml = true;
        console.warn(`[Xtream Fetch] Upstream returned HTML for action ${action} (Status: ${status})`);
      } else {
        try {
          data = JSON.parse(text);
        } catch (e: any) {
          console.warn(`[Xtream Fetch] Failed to parse JSON for action ${action}:`, e.message);
        }
      }

      const ok = response.ok && !isHtml && data !== null;

      // Robust extraction of the list from common Xtream wrappers
      let rawList: any[] = [];
      if (data && typeof data === 'object') {
        if (Array.isArray(data)) {
          rawList = data;
        } else {
          // Check known keys
          rawList = data.streams || data.live_streams || data.vod_streams || data.vod_data || data.series || data.data || data.channels || data.available_channels || [];
          
          // If still empty and it's an object, check if it's an associative array (object with numeric keys)
          if (!Array.isArray(rawList) || rawList.length === 0) {
            const vals = Object.values(data);
            // Exclude user_info and server_info objects
            if (vals.length > 0 && typeof vals[0] === 'object' && vals[0] !== null && !vals[0].hasOwnProperty('auth') && !vals[0].hasOwnProperty('username') && !vals[0].hasOwnProperty('url') && !vals[0].hasOwnProperty('server_protocol')) {
              rawList = vals;
            }
          }
        }
      }

      if (!ok && attempt < retries && (status === 0 || status >= 500)) {
        continue;
      }

      return { data, rawList, status, ok, error: isHtml ? 'Upstream HTML block or error page' : undefined };
    } catch (err: any) {
      if (attempt < retries) {
        console.warn(`[Xtream Fetch] Network error for ${action}, retrying (${attempt + 1}/${retries})...`, err);
        continue;
      }
      console.error(`[Xtream Diagnostics] Fetch failed for ${action}:`, err);
      return { data: null, rawList: [], status: 0, ok: false, error: err.message };
    }
  }

  return { data: null, rawList: [], status: 0, ok: false, error: 'Max retries reached' };
};

// Helpers for specific actions
export const getXtreamLiveCategories = (host: string, user: string, pass: string) => xtreamFetch(host, user, pass, 'get_live_categories');
export const getXtreamLiveStreams = (host: string, user: string, pass: string) => xtreamFetch(host, user, pass, 'get_live_streams');
export const getXtreamVodCategories = (host: string, user: string, pass: string) => xtreamFetch(host, user, pass, 'get_vod_categories');
export const getXtreamVodStreams = (host: string, user: string, pass: string) => xtreamFetch(host, user, pass, 'get_vod_streams');
export const getXtreamSeriesCategories = (host: string, user: string, pass: string) => xtreamFetch(host, user, pass, 'get_series_categories');
export const getXtreamSeries = (host: string, user: string, pass: string) => xtreamFetch(host, user, pass, 'get_series');
export const getXtreamSeriesInfo = (host: string, user: string, pass: string, seriesId: string) => xtreamFetch(host, user, pass, 'get_series_info', { series_id: seriesId });

/**
 * Diagnostic function to test Xtream Codes credentials (using new utility)
 */
export const testXtreamConnection = async (url: string, username: string, password: string) => {
  const result = await diagnosticTest(url, username, password);
  addToDiagnosticHistory(result);
  return result;
};

/**
 * Universal channel fetcher supporting M3U, Xtream Codes, and Stalker Portals
 */
export const fetchChannels = async (playlist: Playlist, favoriteIds: string[] = []): Promise<Channel[]> => {
  if (!playlist) return [];
  const effectiveFavs = favoriteIds.length > 0 ? favoriteIds : getLocalFavoriteIds();

  // 1. M3U Handling
  if (playlist.type === 'm3u') {
    let rawContent = playlist.m3uContent || '';
    if (playlist.url && playlist.url.startsWith('local_file://')) {
      const fileName = playlist.url.replace('local_file://', '');
      rawContent = localStorage.getItem('achour_m3u_file_' + fileName) ||
                   localStorage.getItem('achour_m3u_file_' + playlist.name) || '';
    }
    if (!rawContent && playlist.url) {
      try {
        const fetchUrl = getPlatformUrl('m3u', playlist.url);
        const response = await axios.get(fetchUrl);
        rawContent = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      } catch (err) {
        try {
          const fetchUrl2 = getPlatformUrl('get', playlist.url);
          const response2 = await axios.get(fetchUrl2);
          rawContent = typeof response2.data === 'string' ? response2.data : JSON.stringify(response2.data);
        } catch (e) {}
      }
    }

    if (rawContent) {
      const parsed = parseM3U(rawContent, effectiveFavs);
      if (parsed.length > 0) return parsed;
    }

    // Fallback: If M3U fetch returned empty or failed, check if URL has embedded Xtream credentials
    if (playlist.url && playlist.url.includes('username=') && playlist.url.includes('password=')) {
      try {
        const u = new URL(playlist.url.startsWith('http') ? playlist.url : 'http://' + playlist.url);
        const user = u.searchParams.get('username');
        const pass = u.searchParams.get('password');
        const host = u.origin;
        if (user !== null && pass !== null && host) {
          playlist.type = 'xtream';
          playlist.username = user;
          playlist.password = pass;
          playlist.url = host;
        }
      } catch (e) {}
    }
  }

  // 2. Xtream Codes Handling (Improved with diagnostics)
  if (playlist.type === 'xtream') {
    const rawHost = playlist.url || playlist.portal || '';
    let cleanHost = rawHost.trim().replace(/\/+$/, '');
    cleanHost = cleanHost.replace(/\/(player_api|get|index)\.php.*$/i, '').replace(/\/c\/?$/i, '').replace(/\?.*$/, '').replace(/\/+$/, '');
    if (cleanHost && !cleanHost.startsWith('http')) cleanHost = 'http://' + cleanHost;

    const allChannels: Channel[] = [];
    const actions = [
      { action: 'get_live_streams', type: 'live' as const },
      { action: 'get_vod_streams', type: 'movie' as const },
      { action: 'get_series', type: 'series' as const }
    ];

    // 1. Initial login to get correct streaming host/port from server_info
    let actualStreamingHost = cleanHost;
    try {
      const loginRes = await xtreamFetch(cleanHost, playlist.username || '', playlist.password || '', 'auth');
      if (loginRes.ok && loginRes.data?.server_info) {
        const sInfo = loginRes.data.server_info;
        if (sInfo.url && sInfo.port) {
          const proto = sInfo.server_protocol || 'http';
          actualStreamingHost = `${proto}://${sInfo.url}:${sInfo.port}`;
          console.log(`[Xtream] Global detected streaming host: ${actualStreamingHost}`);
        }
      }
    } catch (e) {}

    const results = [];
    for (const item of actions) {
      results.push(await xtreamFetch(cleanHost, playlist.username || '', playlist.password || '', item.action));
      // Add a longer delay (2 seconds) between requests to be very gentle on the server
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    results.forEach((res, index) => {
      if (res.ok && res.rawList) {
        const itemType = actions[index].type;
        const streams = res.rawList.map((item: any, idx: number) => {
          const rawStreamId = String(item.stream_id || item.series_id || item.id || idx);
          const cleanStreamId = rawStreamId.replace(/\.(m3u8|ts|mp4|mkv|avi|flv)$/i, '');
          const ext = item.container_extension || (itemType === 'live' ? 'm3u8' : 'mp4');
          
          let streamUrl = item.stream_url || item.direct_source || item.url || '';
          if (!streamUrl) {
            const baseUrl = actualStreamingHost;
            if (itemType === 'live') {
              streamUrl = `${baseUrl}/live/${playlist.username || ''}/${playlist.password || ''}/${cleanStreamId}.${ext}`;
            } else if (itemType === 'movie') {
              streamUrl = `${baseUrl}/movie/${playlist.username || ''}/${playlist.password || ''}/${cleanStreamId}.${ext}`;
            } else {
              streamUrl = `${baseUrl}/series/${playlist.username || ''}/${playlist.password || ''}/${cleanStreamId}.${ext}`;
            }
          }

          const channelId = `${itemType}-${cleanStreamId}`;
          const channelName = String(item.name || item.title || `Stream ${idx + 1}`);
          
          return {
            id: channelId,
            stream_id: cleanStreamId,
            name: channelName,
            logo: item.stream_icon || item.cover || item.logo,
            category: item.category_name || (itemType === 'live' ? 'بث مباشر' : itemType === 'movie' ? 'أفلام' : 'مسلسلات'),
            category_id: String(item.category_id || ''),
            url: streamUrl,
            type: itemType,
            isFavorite: effectiveFavs.includes(channelId) || effectiveFavs.includes(cleanStreamId) || effectiveFavs.includes(channelName)
          };
        });
        allChannels.push(...streams);
      }
    });
    return allChannels;
  }


  
  // 3. Stalker Portal Handling
  if (playlist.type === 'stalker') {
    const rawPortal = playlist.url || playlist.portal || '';
    let cleanPortal = rawPortal.trim().replace(/\/+$/, '');
    if (cleanPortal && !cleanPortal.startsWith('http://') && !cleanPortal.startsWith('https://')) {
      cleanPortal = 'http://' + cleanPortal;
    }

    try {
      // 1. Initial Handshake
      const handshakeUrl = getPlatformUrl('stalker', cleanPortal, {
        action: 'handshake',
        type: 'stb',
        mac: playlist.macAddress || '00:1A:79:00:00:01'
      });
      await axios.get(handshakeUrl);

      // 2. Fetch all channels
      const fetchChannelsUrl = getPlatformUrl('stalker', cleanPortal, {
        action: 'get_all_channels',
        type: 'itv',
        mac: playlist.macAddress || '00:1A:79:00:00:01'
      });
      const channelsRes = await axios.get(fetchChannelsUrl);


      const rawData = channelsRes.data?.js?.data || channelsRes.data?.js || channelsRes.data?.data;
      if (Array.isArray(rawData)) {
        return rawData.map((item: any, idx: number) => {
          const chId = `stalker-${item.id || item.cmd || idx}`;
          const chName = item.name || `Stalker Channel ${idx + 1}`;
          const isFav = effectiveFavs.includes(chId) || effectiveFavs.includes(String(item.id)) || effectiveFavs.includes(chName);
          return {
            id: chId,
            stream_id: String(item.id || idx),
            name: chName,
            logo: item.logo,
            category: item.category_name || 'Stalker Live',
            url: item.cmd || `${cleanPortal}/play/${item.id}`,
            type: 'live' as const,
            isFavorite: isFav
          };
        });
      }
    } catch (err) {
      console.error('Error fetching stalker channels:', err);
    }
  }

  return [];
};
