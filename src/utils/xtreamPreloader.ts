import { Playlist } from '../types';
import { iptvGlobalCache, xtreamFetch, fetchChannels } from './iptv';

export interface PreloadStatus {
  stage: 'idle' | 'auth' | 'live' | 'vod' | 'series' | 'complete' | 'error';
  progress: number;
  message: string;
}

export function isMovieItem(name: string, group: string = '', url: string = ''): boolean {
  const text = (name + ' ' + group + ' ' + url).toLowerCase();
  return text.includes('.mp4') || text.includes('.mkv') || text.includes('.avi') || text.includes('.mov') || text.includes('.m4v') ||
         text.includes('movie') || text.includes('film') || text.includes('vod') || text.includes('cinema') ||
         text.includes('netflix') || text.includes('shahed') || text.includes('osn') || text.includes('boxoffice') ||
         text.includes('أفلام') || text.includes('افلام') || text.includes('الأفلام') || text.includes('الافلام') ||
         text.includes('سينما') || text.includes('السينما') || text.includes('فيلم') || text.includes('الفيلم') ||
         text.includes('مترجم') || text.includes('مدبلج') || text.includes('شاهد') || text.includes('نتفليكس');
}

export function isSeriesItem(name: string, group: string = '', url: string = ''): boolean {
  const text = (name + ' ' + group + ' ' + url).toLowerCase();
  return text.includes('series') || text.includes('serie') || text.includes('مسلسل') || text.includes('المسلسل') ||
         text.includes('مسلسلات') || text.includes('المسلسلات') || text.includes('دراما') || text.includes('drama') ||
         text.includes('s0') || text.includes('s1') || text.includes('s2') || text.includes('s3') || text.includes('s4') || text.includes('s5') ||
         text.includes('season') || text.includes('episode') || text.includes('حلقة') || text.includes('حلقات') ||
         text.includes('موسم') || text.includes('مواسم') || text.includes('انمي') || text.includes('anime');
}

/**
 * Preloads all Live TV channels, Movies (VOD), and Series into the global cache
 * so that navigating to any section is completely instant with 0 seconds wait.
 */
export function isContentPreloaded(): boolean {
  return (iptvGlobalCache.channels && iptvGlobalCache.channels.length > 0) || iptvGlobalCache.has('live');
}

export async function preloadAllIPTVContent(
  playlist: Playlist | null,
  userId: string,
  onStatusUpdate?: (status: PreloadStatus) => void
): Promise<boolean> {
  const notify = (stage: PreloadStatus['stage'], progress: number, message: string) => {
    if (onStatusUpdate) {
      onStatusUpdate({ stage, progress, message });
    }
  };

  // If playlist not provided in props, retrieve it immediately from localStorage
  if (!playlist) {
    try {
      const saved = localStorage.getItem('achour_local_playlists');
      if (saved) {
        const list: Playlist[] = JSON.parse(saved);
        if (list && list.length > 0) {
          const activeId = localStorage.getItem('achour_active_playlist_id');
          playlist = (activeId ? list.find(p => p.id === activeId) : null) || list[0];
        }
      }
    } catch (e) {}
  }

  if (!playlist) {
    notify('complete', 100, 'جاهز للتشغيل');
    return true;
  }

  const playlistId = playlist.id || 'default';
  const liveKey = `${userId}_live_${playlistId}`;
  const movieKey = `${userId}_movie_${playlistId}`;
  const seriesKey = `${userId}_series_${playlistId}`;

  // Check if already in memory
  if (iptvGlobalCache.has(liveKey) || iptvGlobalCache.has('live')) {
    notify('complete', 100, 'جميع القنوات والأفلام والمسلسلات جاهزة فورياً');
    return true;
  }

  try {
    let host = playlist.url || '';
    let user = playlist.username || '';
    let pass = playlist.password || '';

    // Extract credentials if embedded in URL
    if (host && (!user || !pass)) {
      try {
        const parsedUrl = new URL(host.startsWith('http') ? host : 'http://' + host);
        const u = parsedUrl.searchParams.get('username');
        const p = parsedUrl.searchParams.get('password');
        if (u && p) {
          user = user || u;
          pass = pass || p;
          host = parsedUrl.origin;
        }
      } catch (e) {}
    }

    // -------------------------------------------------------------
    // CASE A: XTREAM CODES API
    // -------------------------------------------------------------
    if (user && pass && host) {
      notify('auth', 10, 'جاري الاتصال بالسيرفر والتحقق من الاشتراك...');

      // 1. Initial Handshake to get server_info for correct streaming host/port
      let actualStreamingHost = host;
      try {
        const loginRes = await xtreamFetch(host, user, pass, 'auth');
        if (loginRes.ok && loginRes.data?.server_info) {
          const sInfo = loginRes.data.server_info;
          if (sInfo.url && sInfo.port) {
            const proto = sInfo.server_protocol || 'http';
            actualStreamingHost = `${proto}://${sInfo.url}:${sInfo.port}`;
          }
        }
      } catch (e) {
        console.warn('[Preload] Auth handshake error:', e);
      }

      // 2. Fetch Live TV (Categories + Streams)
      notify('live', 25, 'جاري تحميل وتجهيز جميع القنوات المباشرة...');
      try {
        const [liveCatRes, liveStreamRes] = await Promise.all([
          xtreamFetch(host, user, pass, 'get_live_categories'),
          xtreamFetch(host, user, pass, 'get_live_streams')
        ]);

        const fetchedLiveCats = (liveCatRes.ok && liveCatRes.rawList.length > 0)
          ? liveCatRes.rawList.map((c: any) => ({
              category_id: String(c.category_id || c.id),
              category_name: String(c.category_name || c.name)
            }))
          : [];

        const mappedLiveStreams = (liveStreamRes.ok && liveStreamRes.rawList.length > 0)
          ? liveStreamRes.rawList.map((ch: any, idx: number) => {
              const cleanId = String(ch.stream_id || ch.id || idx).replace(/\.(m3u8|ts|mp4)$/i, '');
              const ext = ch.container_extension || 'm3u8';
              const directUrl = ch.stream_url || ch.direct_source || ch.url || `${actualStreamingHost}/live/${user}/${pass}/${cleanId}.${ext}`;
              const catIdStr = String(ch.category_id || '');
              const matchedCat = fetchedLiveCats.find((c: any) => String(c.category_id) === catIdStr);
              return {
                stream_id: cleanId,
                name: String(ch.name || ch.title || `قناة ${idx + 1}`),
                stream_icon: ch.stream_icon || ch.cover || ch.logo || undefined,
                url: directUrl,
                category_id: catIdStr || 'general',
                category_name: ch.category_name || (matchedCat ? matchedCat.category_name : catIdStr) || 'عام (General)',
                container_extension: ext
              };
            })
          : [];

        let finalLiveCats = fetchedLiveCats;
        if (finalLiveCats.length === 0 && mappedLiveStreams.length > 0) {
          const groupMap: Record<string, { id: string; count: number }> = {};
          mappedLiveStreams.forEach((c: any) => {
            const name = c.category_name || 'عام';
            const id = c.category_id || name;
            if (!groupMap[name]) groupMap[name] = { id, count: 0 };
            groupMap[name].count += 1;
          });
          finalLiveCats = Object.keys(groupMap).map(name => ({
            category_id: groupMap[name].id,
            category_name: name,
            count: groupMap[name].count
          }));
        }

        const liveData = { categories: finalLiveCats, channels: mappedLiveStreams };
        iptvGlobalCache.set(liveKey, liveData);
        iptvGlobalCache.set(`${userId}_live_default`, liveData);
        iptvGlobalCache.set(`live_${playlistId}`, liveData);
        iptvGlobalCache.set('live_default', liveData);
        iptvGlobalCache.set('live', liveData);
        iptvGlobalCache.channels = mappedLiveStreams;
        iptvGlobalCache.categories = finalLiveCats;
        console.log(`[Preload] Live TV ready: ${mappedLiveStreams.length} channels, ${finalLiveCats.length} categories`);
      } catch (err) {
        console.warn('[Preload] Live streams fetch warning:', err);
      }

      // 3. Fetch Movies (VOD Categories + Streams)
      notify('vod', 55, 'جاري تحميل مكتبة الأفلام بالكامل...');
      try {
        const [vodCatRes, vodStreamRes] = await Promise.all([
          xtreamFetch(host, user, pass, 'get_vod_categories'),
          xtreamFetch(host, user, pass, 'get_vod_streams')
        ]);

        const fetchedVodCats = (vodCatRes.ok && vodCatRes.rawList.length > 0)
          ? vodCatRes.rawList.map((c: any) => ({
              category_id: String(c.category_id || c.id),
              category_name: String(c.category_name || c.name)
            }))
          : [];

        const mappedVodStreams = (vodStreamRes.ok && vodStreamRes.rawList.length > 0)
          ? vodStreamRes.rawList.map((ch: any, idx: number) => {
              const cleanId = String(ch.stream_id || ch.id || idx).replace(/\.(mp4|mkv|avi|mov)$/i, '');
              const ext = ch.container_extension || 'mp4';
              const directUrl = ch.stream_url || ch.direct_source || ch.url || `${actualStreamingHost}/movie/${user}/${pass}/${cleanId}.${ext}`;
              const catIdStr = String(ch.category_id || '');
              const matchedCat = fetchedVodCats.find((c: any) => String(c.category_id) === catIdStr);
              return {
                stream_id: cleanId,
                name: String(ch.name || ch.title || `فيلم ${idx + 1}`),
                stream_icon: ch.stream_icon || ch.cover || ch.logo || undefined,
                url: directUrl,
                category_id: catIdStr || 'general',
                category_name: ch.category_name || (matchedCat ? matchedCat.category_name : catIdStr) || 'أفلام',
                container_extension: ext
              };
            })
          : [];

        let finalVodCats = fetchedVodCats;
        if (finalVodCats.length === 0 && mappedVodStreams.length > 0) {
          const groupMap: Record<string, { id: string; count: number }> = {};
          mappedVodStreams.forEach((c: any) => {
            const name = c.category_name || 'أفلام';
            const id = c.category_id || name;
            if (!groupMap[name]) groupMap[name] = { id, count: 0 };
            groupMap[name].count += 1;
          });
          finalVodCats = Object.keys(groupMap).map(name => ({
            category_id: groupMap[name].id,
            category_name: name,
            count: groupMap[name].count
          }));
        }

        const movieData = { categories: finalVodCats, channels: mappedVodStreams };
        iptvGlobalCache.set(movieKey, movieData);
        iptvGlobalCache.set(`${userId}_movie_default`, movieData);
        iptvGlobalCache.set(`movie_${playlistId}`, movieData);
        iptvGlobalCache.set('movie_default', movieData);
        iptvGlobalCache.set('movie', movieData);
        iptvGlobalCache.set('movies', movieData);
        iptvGlobalCache.vod = mappedVodStreams;
        console.log(`[Preload] Movies ready: ${mappedVodStreams.length} movies, ${finalVodCats.length} categories`);
      } catch (err) {
        console.warn('[Preload] Vod streams fetch warning:', err);
      }

      // 4. Fetch Series (Series Categories + Streams)
      notify('series', 80, 'جاري تحميل مكتبة المسلسلات والحلقات...');
      try {
        const [seriesCatRes, seriesStreamRes] = await Promise.all([
          xtreamFetch(host, user, pass, 'get_series_categories'),
          xtreamFetch(host, user, pass, 'get_series')
        ]);

        const fetchedSeriesCats = (seriesCatRes.ok && seriesCatRes.rawList.length > 0)
          ? seriesCatRes.rawList.map((c: any) => ({
              category_id: String(c.category_id || c.id),
              category_name: String(c.category_name || c.name)
            }))
          : [];

        const mappedSeriesStreams = (seriesStreamRes.ok && seriesStreamRes.rawList.length > 0)
          ? seriesStreamRes.rawList.map((ch: any, idx: number) => {
              const cleanId = String(ch.series_id || ch.stream_id || ch.id || idx).replace(/\.(mp4|mkv)$/i, '');
              const ext = ch.container_extension || 'mp4';
              const directUrl = ch.stream_url || ch.direct_source || ch.url || `${actualStreamingHost}/series/${user}/${pass}/${cleanId}.${ext}`;
              const catIdStr = String(ch.category_id || '');
              const matchedCat = fetchedSeriesCats.find((c: any) => String(c.category_id) === catIdStr);
              return {
                stream_id: cleanId,
                name: String(ch.name || ch.title || `مسلسل ${idx + 1}`),
                stream_icon: ch.cover || ch.stream_icon || ch.logo || undefined,
                url: directUrl,
                category_id: catIdStr || 'general',
                category_name: ch.category_name || (matchedCat ? matchedCat.category_name : catIdStr) || 'مسلسلات',
                container_extension: ext
              };
            })
          : [];

        let finalSeriesCats = fetchedSeriesCats;
        if (finalSeriesCats.length === 0 && mappedSeriesStreams.length > 0) {
          const groupMap: Record<string, { id: string; count: number }> = {};
          mappedSeriesStreams.forEach((c: any) => {
            const name = c.category_name || 'مسلسلات';
            const id = c.category_id || name;
            if (!groupMap[name]) groupMap[name] = { id, count: 0 };
            groupMap[name].count += 1;
          });
          finalSeriesCats = Object.keys(groupMap).map(name => ({
            category_id: groupMap[name].id,
            category_name: name,
            count: groupMap[name].count
          }));
        }

        const seriesData = { categories: finalSeriesCats, channels: mappedSeriesStreams };
        iptvGlobalCache.set(seriesKey, seriesData);
        iptvGlobalCache.set(`${userId}_series_default`, seriesData);
        iptvGlobalCache.set(`series_${playlistId}`, seriesData);
        iptvGlobalCache.set('series_default', seriesData);
        iptvGlobalCache.set('series', seriesData);
        iptvGlobalCache.series = mappedSeriesStreams;
        console.log(`[Preload] Series ready: ${mappedSeriesStreams.length} series, ${finalSeriesCats.length} categories`);
      } catch (err) {
        console.warn('[Preload] Series fetch warning:', err);
      }

      notify('complete', 100, 'اكتمل تجهيز القنوات والأفلام والمسلسلات بنجاح');
      return true;

    } else {
      // -------------------------------------------------------------
      // CASE B: M3U PLAYLIST
      // -------------------------------------------------------------
      notify('live', 30, 'جاري قراءة وتصنيف ملف M3U...');
      const allChannels = await fetchChannels(playlist);

      const liveChs: any[] = [];
      const movieChs: any[] = [];
      const seriesChs: any[] = [];

      allChannels.forEach(c => {
        const mapped = {
          stream_id: c.stream_id || c.id,
          name: c.name,
          stream_icon: c.logo,
          url: c.url,
          category_id: c.category || 'عام',
          category_name: c.category || 'عام'
        };

        if (isMovieItem(c.name, c.category || '', c.url)) {
          movieChs.push(mapped);
        } else if (isSeriesItem(c.name, c.category || '', c.url)) {
          seriesChs.push(mapped);
        } else {
          liveChs.push(mapped);
        }
      });

      const buildCats = (list: any[]) => {
        const map: Record<string, number> = {};
        list.forEach(c => {
          const g = c.category_name || 'عام';
          map[g] = (map[g] || 0) + 1;
        });
        return Object.keys(map).map(k => ({ category_id: k, category_name: k, count: map[k] }));
      };

      const liveCats = buildCats(liveChs);
      const movieCats = buildCats(movieChs);
      const seriesCats = buildCats(seriesChs);

      const m3uLiveData = { categories: liveCats, channels: liveChs };
      iptvGlobalCache.set(liveKey, m3uLiveData);
      iptvGlobalCache.set(`${userId}_live_default`, m3uLiveData);
      iptvGlobalCache.set(`live_${playlistId}`, m3uLiveData);
      iptvGlobalCache.set('live_default', m3uLiveData);
      iptvGlobalCache.set('live', m3uLiveData);
      iptvGlobalCache.channels = liveChs;
      iptvGlobalCache.categories = liveCats;

      const m3uMovieData = { categories: movieCats, channels: movieChs };
      iptvGlobalCache.set(movieKey, m3uMovieData);
      iptvGlobalCache.set(`${userId}_movie_default`, m3uMovieData);
      iptvGlobalCache.set(`movie_${playlistId}`, m3uMovieData);
      iptvGlobalCache.set('movie_default', m3uMovieData);
      iptvGlobalCache.set('movie', m3uMovieData);
      iptvGlobalCache.set('movies', m3uMovieData);
      iptvGlobalCache.vod = movieChs;

      const m3uSeriesData = { categories: seriesCats, channels: seriesChs };
      iptvGlobalCache.set(seriesKey, m3uSeriesData);
      iptvGlobalCache.set(`${userId}_series_default`, m3uSeriesData);
      iptvGlobalCache.set(`series_${playlistId}`, m3uSeriesData);
      iptvGlobalCache.set('series_default', m3uSeriesData);
      iptvGlobalCache.set('series', m3uSeriesData);
      iptvGlobalCache.series = seriesChs;

      notify('complete', 100, 'اكتمل تجهيز القنوات والأفلام والمسلسلات بنجاح');
      return true;
    }

  } catch (err: any) {
    console.warn('[Preload] Global preload error:', err);
    notify('complete', 100, 'جاهز للتشغيل');
    return false;
  }
}
