/**
 * Media Tracks & Subtitle Extraction Utility
 * Handles audio language switching and subtitle extraction/parsing for Movies, Series, and Live streams.
 */

import { Playlist } from '../types';
import { xtreamFetch } from './iptv';

export interface MediaTrack {
  id: number | string;
  name: string;
  lang?: string;
  type?: 'audio' | 'subtitle';
  source?: 'embedded' | 'xtream' | 'file' | 'url';
  url?: string;
  cues?: SubtitleCue[];
}

export interface SubtitleCue {
  id: number;
  start: number; // in seconds
  end: number;   // in seconds
  text: string;
}

export interface SubtitleSettings {
  fontSize: 'small' | 'medium' | 'large' | 'xlarge';
  fontColor: 'white' | 'yellow' | 'cyan' | 'green';
  backgroundColor: 'black-semi' | 'black-solid' | 'transparent';
  offsetSeconds: number; // e.g. -2.0 to +2.0 delay
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  fontSize: 'medium',
  fontColor: 'yellow',
  backgroundColor: 'black-semi',
  offsetSeconds: 0
};

// Known ISO 639-1 / 639-2 language code mapping
const LANGUAGE_NAMES: Record<string, { ar: string; en: string }> = {
  ar: { ar: 'العربية', en: 'Arabic' },
  ara: { ar: 'العربية', en: 'Arabic' },
  en: { ar: 'الإنجليزية', en: 'English' },
  eng: { ar: 'الإنجليزية', en: 'English' },
  fr: { ar: 'الفرنسية', en: 'French' },
  fra: { ar: 'الفرنسية', en: 'French' },
  fre: { ar: 'الفرنسية', en: 'French' },
  es: { ar: 'الإسبانية', en: 'Spanish' },
  spa: { ar: 'الإسبانية', en: 'Spanish' },
  de: { ar: 'الألمانية', en: 'German' },
  deu: { ar: 'الألمانية', en: 'German' },
  ger: { ar: 'الألمانية', en: 'German' },
  it: { ar: 'الإيطالية', en: 'Italian' },
  ita: { ar: 'الإيطالية', en: 'Italian' },
  tr: { ar: 'التركية', en: 'Turkish' },
  tur: { ar: 'التركية', en: 'Turkish' },
  ru: { ar: 'الروسية', en: 'Russian' },
  rus: { ar: 'الروسية', en: 'Russian' },
  pt: { ar: 'البرتغالية', en: 'Portuguese' },
  por: { ar: 'البرتغالية', en: 'Portuguese' },
  fa: { ar: 'الفارسية', en: 'Persian' },
  fas: { ar: 'الفارسية', en: 'Persian' },
  per: { ar: 'الفارسية', en: 'Persian' },
  hi: { ar: 'الهندية', en: 'Hindi' },
  hin: { ar: 'الهندية', en: 'Hindi' },
  ur: { ar: 'الأردية', en: 'Urdu' },
  urd: { ar: 'الأردية', en: 'Urdu' },
  ku: { ar: 'الكردية', en: 'Kurdish' },
  kur: { ar: 'الكردية', en: 'Kurdish' },
  zh: { ar: 'الصينية', en: 'Chinese' },
  zho: { ar: 'الصينية', en: 'Chinese' },
  chi: { ar: 'الصينية', en: 'Chinese' },
  ja: { ar: 'اليابانية', en: 'Japanese' },
  jpn: { ar: 'اليابانية', en: 'Japanese' },
  ko: { ar: 'الكورية', en: 'Korean' },
  kor: { ar: 'الكورية', en: 'Korean' },
  nl: { ar: 'الهولندية', en: 'Dutch' },
  nld: { ar: 'الهولندية', en: 'Dutch' },
  dut: { ar: 'الهولندية', en: 'Dutch' },
  pl: { ar: 'البولندية', en: 'Polish' },
  pol: { ar: 'البولندية', en: 'Polish' },
  sv: { ar: 'السويدية', en: 'Swedish' },
  swe: { ar: 'السويدية', en: 'Swedish' },
};

/**
 * Format language code into a clean, bilingual readable label
 */
export function formatLanguageLabel(langCodeOrName?: string, isRtl: boolean = true): string {
  if (!langCodeOrName) return isRtl ? 'غير محدد' : 'Unknown';
  const clean = langCodeOrName.toLowerCase().trim();

  // Direct match
  if (LANGUAGE_NAMES[clean]) {
    const item = LANGUAGE_NAMES[clean];
    return isRtl ? `${item.ar} (${item.en})` : `${item.en} (${item.ar})`;
  }

  // Prefix match
  for (const [code, val] of Object.entries(LANGUAGE_NAMES)) {
    if (clean.startsWith(code) || clean.includes(code)) {
      return isRtl ? `${val.ar} (${val.en})` : `${val.en} (${val.ar})`;
    }
  }

  // Capitalize original
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Convert SRT timestamp string (00:01:20,500) to seconds (80.5)
 */
export function parseSrtTimestamp(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().replace(',', '.').split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  }
  return parseFloat(timeStr) || 0;
}

/**
 * Parse an SRT or VTT string into structured subtitle cues
 */
export function parseSrtOrVtt(content: string): SubtitleCue[] {
  if (!content) return [];
  const cues: SubtitleCue[] = [];
  
  // Clean carriage returns and BOM
  const cleaned = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = cleaned.split(/\n\n+/);

  let idCounter = 1;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    let timeLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIndex = i;
        break;
      }
    }

    if (timeLineIndex === -1) continue;

    const timeLine = lines[timeLineIndex];
    const timeParts = timeLine.split('-->');
    if (timeParts.length !== 2) continue;

    const start = parseSrtTimestamp(timeParts[0].trim().split(' ')[0]);
    const end = parseSrtTimestamp(timeParts[1].trim().split(' ')[0]);

    const textLines = lines.slice(timeLineIndex + 1).map(l => l.trim()).filter(Boolean);
    const text = textLines.join('\n').replace(/<[^>]*>/g, ''); // strip html tags

    if (text && end > start) {
      cues.push({
        id: idCounter++,
        start,
        end,
        text
      });
    }
  }

  return cues;
}

/**
 * Convert parsed cues into a WebVTT Blob URL that can be fed directly to a <track> element
 */
export function createVttBlobUrl(cues: SubtitleCue[]): string {
  let vtt = 'WEBVTT\n\n';
  const formatVttTime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };

  cues.forEach(c => {
    vtt += `${formatVttTime(c.start)} --> ${formatVttTime(c.end)}\n${c.text}\n\n`;
  });

  const blob = new Blob([vtt], { type: 'text/vtt;charset=utf-8' });
  return URL.createObjectURL(blob);
}

/**
 * Extract subtitles and audio track information from Xtream Codes API
 */
export async function extractXtreamVODMetadata(
  playlist: Playlist,
  streamId: string,
  mediaType: 'movie' | 'series',
  isRtl: boolean = true
): Promise<{ subtitles: MediaTrack[]; audioTracks: MediaTrack[] }> {
  const subtitles: MediaTrack[] = [];
  const audioTracks: MediaTrack[] = [];

  if (playlist.type !== 'xtream' || !playlist.username || !playlist.password) {
    return { subtitles, audioTracks };
  }

  const rawHost = playlist.url || playlist.portal || '';
  if (!rawHost) return { subtitles, audioTracks };

  let cleanHost = rawHost.trim().replace(/\/+$/, '');
  cleanHost = cleanHost.replace(/\/(player_api|get|index)\.php.*$/i, '').replace(/\/c\/?$/i, '').replace(/\?.*$/, '');

  const action = mediaType === 'series' ? 'get_series_info' : 'get_vod_info';
  const paramKey = mediaType === 'series' ? 'series_id' : 'vod_id';

  try {
    const res = await xtreamFetch(cleanHost, playlist.username, playlist.password, action, {
      [paramKey]: streamId
    });

    if (res.ok && res.data) {
      const data = res.data;
      const info = data.info || data.movie_data || {};

      // 1. Check subtitles in response
      const rawSubs = info.subtitles || data.subtitles || [];
      if (Array.isArray(rawSubs)) {
        rawSubs.forEach((sub: any, idx: number) => {
          let lang = 'ar';
          let url = '';
          let name = '';

          if (typeof sub === 'string') {
            lang = sub.replace(/^\./, '').toLowerCase();
            name = formatLanguageLabel(lang, isRtl);
            url = `${cleanHost}/subtitles/${playlist.username}/${playlist.password}/${streamId}.${lang}`;
          } else if (typeof sub === 'object' && sub !== null) {
            lang = sub.language || sub.lang || sub.container || 'ar';
            name = formatLanguageLabel(lang, isRtl);
            url = sub.url || (sub.container ? `${cleanHost}/subtitles/${playlist.username}/${playlist.password}/${streamId}.${sub.container}` : '');
          }

          if (url || name) {
            subtitles.push({
              id: `xtream-sub-${idx}`,
              name: name || (isRtl ? `ترجمة ${idx + 1}` : `Subtitle ${idx + 1}`),
              lang,
              url,
              source: 'xtream',
              type: 'subtitle'
            });
          }
        });
      }

      // Only include genuine subtitles returned by the stream or API

      // 2. Check audio tracks in info
      const rawAudio = info.audio || info.audio_streams || data.audio || [];
      if (Array.isArray(rawAudio)) {
        rawAudio.forEach((aud: any, idx: number) => {
          const lang = typeof aud === 'string' ? aud : (aud.language || aud.lang || `Track ${idx + 1}`);
          audioTracks.push({
            id: idx,
            name: formatLanguageLabel(lang, isRtl),
            lang: typeof lang === 'string' ? lang : undefined,
            source: 'xtream',
            type: 'audio'
          });
        });
      }
    }
  } catch (e) {
    console.warn('[extractXtreamVODMetadata] failed:', e);
  }

  return { subtitles, audioTracks };
}
