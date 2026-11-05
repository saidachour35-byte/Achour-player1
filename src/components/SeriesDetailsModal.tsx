import React, { useState, useEffect, useRef } from 'react';
import { X, Play, Star, Calendar, Film, Layers, ChevronRight, ChevronLeft, Tv, Clock, Check, AlertCircle, FileText } from 'lucide-react';
import { VodItem, SeriesEpisode, Playlist } from '../types';
import axios from 'axios';
import { getXtreamSeriesInfo, ensureArray } from '../utils/iptv';

interface SeriesDetailsModalProps {
  series: VodItem;
  activePlaylist: Playlist | null;
  isRtl?: boolean;
  onClose: () => void;
  onPlayEpisode: (episode: SeriesEpisode, allSeasonEpisodes: SeriesEpisode[], episodeIndex: number) => void;
}

export const SeriesDetailsModal: React.FC<SeriesDetailsModalProps> = ({
  series,
  activePlaylist,
  isRtl = true,
  onClose,
  onPlayEpisode
}) => {
  const [loading, setLoading] = useState(true);
  const [seasonsData, setSeasonsData] = useState<Record<string, SeriesEpisode[]>>({});
  const [selectedSeason, setSelectedSeason] = useState<string>('1');
  const [seriesInfo, setSeriesInfo] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const seasonsRef = useRef<HTMLDivElement>(null);
  const episodesRef = useRef<HTMLDivElement>(null);

  const seriesId = series.series_id || series.id || series.stream_id;

  useEffect(() => {
    let isMounted = true;
    async function loadSeriesInfo() {
      setLoading(true);
      setErrorMessage(null);

      try {
        if (!activePlaylist || !seriesId) {
          setLoading(false);
          return;
        }

        let baseUrl = activePlaylist.url || '';
        if (baseUrl && !baseUrl.startsWith('http')) baseUrl = 'http://' + baseUrl;
        
        const username = activePlaylist.username || '';
        const password = activePlaylist.password || '';

        // Use the robust utility instead of manual axios
        const { data, ok, error } = await getXtreamSeriesInfo(baseUrl, username, password, String(seriesId));
        
        if (!isMounted) return;

        if (ok && data && (data.episodes || data.info)) {
          setSeriesInfo(data.info || {});
          const episodesMap: Record<string, SeriesEpisode[]> = {};

          if (data.episodes) {
            // episodes can be an object with season numbers as keys
            Object.keys(data.episodes).forEach(seasonNum => {
              const epList = ensureArray(data.episodes[seasonNum]);
              episodesMap[seasonNum] = epList.map((ep: any, idx: number) => {
                const ext = ep.container_extension || 'mp4';
                // Try to use server-info detected streaming host if available in future, 
                // but for now baseUrl is usually correct.
                const epStreamUrl = `${baseUrl}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${ep.id || ep.stream_id}.${ext}`;

                return {
                  id: String(ep.id || ep.stream_id || idx + 1),
                  episode_num: parseInt(ep.episode_num || ep.episode || idx + 1, 10),
                  season_num: parseInt(seasonNum, 10),
                  title: ep.title || ep.name || `الحلقة ${idx + 1}`,
                  name: ep.title || ep.name || `الحلقة ${idx + 1}`,
                  url: epStreamUrl,
                  direct_source: epStreamUrl,
                  stream_url: epStreamUrl,
                  cover: ep.info?.movie_image || ep.info?.cover_big || series.cover || series.stream_icon,
                  duration: ep.info?.duration || ''
                };
              });
            });
          }

          const availableSeasons = Object.keys(episodesMap).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

          if (availableSeasons.length > 0) {
            setSeasonsData(episodesMap);
            setSelectedSeason(availableSeasons[0]);
          } else {
            // Fallback for single-link series if episodes list is empty but info is present
            const defaultUrl = `${baseUrl}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${seriesId}.mp4`;
            setSeasonsData({
              '1': [
                {
                  id: String(seriesId),
                  episode_num: 1,
                  season_num: 1,
                  title: series.name || series.title || 'الحلقة 1',
                  name: series.name || series.title || 'الحلقة 1',
                  url: defaultUrl,
                  direct_source: defaultUrl,
                  stream_url: defaultUrl,
                  cover: series.cover || series.stream_icon
                }
              ]
            });
            setSelectedSeason('1');
          }
        } else {
            throw new Error(error || 'Invalid data structure');
        }
      } catch (err) {
        console.warn('Series info fetch error:', err);
        if (isMounted) {
          setErrorMessage('تعذر جلب جميع الحلقات من السيرفر، يرجى المحاولة لاحقاً.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadSeriesInfo();
    return () => {
      isMounted = false;
    };
  }, [seriesId, activePlaylist]);

  // Auto-focus the first season when loaded
  useEffect(() => {
    if (!loading && !errorMessage) {
      const timer = setTimeout(() => {
        const firstFocusable = seasonsRef.current?.querySelector('[data-tv-focusable="true"]') as HTMLElement;
        if (firstFocusable) {
          firstFocusable.focus();
        } else {
          const firstEpisode = episodesRef.current?.querySelector('[data-tv-focusable="true"]') as HTMLElement;
          if (firstEpisode) firstEpisode.focus();
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [loading, errorMessage, selectedSeason]);

  const seasonKeys = Object.keys(seasonsData).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const currentEpisodes = seasonsData[selectedSeason] || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col justify-between overflow-hidden select-none">
      {/* Backdrop Image Overlay */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-25">
        <img
          src={seriesInfo?.backdrop_path?.[0] || series.cover || series.stream_icon}
          alt=""
          className="w-full h-full object-cover blur-md scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent" />
      </div>

      {/* Top Bar Header */}
      <div className="relative z-10 p-6 flex items-center justify-between border-b border-white/10 bg-black/40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold/20 border border-gold/40 flex items-center justify-center text-gold">
            <Tv size={22} />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-black text-white truncate max-w-xl">
              {series.name || series.title || 'المسلسل'}
            </h2>
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 mt-0.5">
              <span>{seriesInfo?.genre || series.category_name || 'مسلسلات'}</span>
              {seriesInfo?.rating && (
                <>
                  <span>•</span>
                  <span className="text-gold flex items-center gap-1 font-bold">
                    <Star size={12} className="fill-gold" />
                    {seriesInfo.rating}
                  </span>
                </>
              )}
              {seriesInfo?.releaseDate && (
                <>
                  <span>•</span>
                  <span>{seriesInfo.releaseDate}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          data-tv-focusable="true"
          tabIndex={0}
          className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors focus:outline-none focus:ring-4 focus:ring-gold"
        >
          <X size={20} />
        </button>
      </div>

      {/* Main Content: Seasons & Episodes Selection */}
      <div className="relative z-10 flex-1 overflow-y-auto p-6 space-y-6">
        {/* Series Description / Plot */}
        {(() => {
          const plot = seriesInfo?.plot || seriesInfo?.description;
          const isPlaceholder = plot && (plot.includes('لا تتوفر تفاصيل') || plot.includes('No information') || plot.includes('No description'));
          if (loading || !plot || isPlaceholder) return null;
          return (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-2">
              <h3 className="text-[10px] font-black text-gold uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                <FileText size={14} />
                <span>{isRtl ? 'قصة المسلسل' : 'SERIES STORY'}</span>
              </h3>
              <p className="text-sm text-zinc-300 leading-relaxed max-h-32 overflow-y-auto no-scrollbar font-medium">
                {plot}
              </p>
            </div>
          );
        })()}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gold space-y-3">
            <div className="w-10 h-10 border-4 border-gold border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-bold">{isRtl ? 'جاري تحميل المواسم والحلقات...' : 'Loading seasons & episodes...'}</span>
          </div>
        ) : errorMessage ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
              <AlertCircle size={32} />
            </div>
            <p className="text-zinc-400 max-w-xs font-bold leading-relaxed">{errorMessage}</p>
            <button
              onClick={onClose}
              data-tv-focusable="true"
              tabIndex={0}
              className="px-8 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-black transition-all focus:ring-4 focus:ring-gold focus:bg-gold focus:text-black"
            >
              إغلاق
            </button>
          </div>
        ) : (
          <>
            {/* Season Selector Bar */}
            <div>
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Layers size={14} className="text-gold" />
                <span>المواسم المتاحة ({seasonKeys.length})</span>
              </h3>

              <div ref={seasonsRef} className="flex items-center gap-3 overflow-x-auto pb-2">
                {seasonKeys.map(seasonNum => {
                  const isSelected = seasonNum === selectedSeason;
                  const epCount = seasonsData[seasonNum]?.length || 0;

                  return (
                    <button
                      key={seasonNum}
                      onClick={() => setSelectedSeason(seasonNum)}
                      data-tv-focusable="true"
                      tabIndex={0}
                      className={`px-5 py-3 rounded-2xl font-black text-xs sm:text-sm transition-all border whitespace-nowrap focus:outline-none focus:ring-4 focus:ring-gold ${
                        isSelected
                          ? 'bg-gold text-black border-gold shadow-lg shadow-gold/20 scale-105'
                          : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      الموسم {seasonNum} ({epCount} {isRtl ? 'حلقة' : 'episodes'})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Episodes List Grid */}
            <div>
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Film size={14} className="text-gold" />
                <span>حلقات الموسم {selectedSeason} ({currentEpisodes.length} حلقة)</span>
              </h3>

              <div ref={episodesRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {currentEpisodes.map((ep, idx) => (
                  <div
                    key={ep.id || idx}
                    onClick={() => onPlayEpisode(ep, currentEpisodes, idx)}
                    data-tv-focusable="true"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Select' || e.keyCode === 13 || e.keyCode === 23) {
                        onPlayEpisode(ep, currentEpisodes, idx);
                      }
                    }}
                    className="group p-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-gold/50 cursor-pointer transition-all flex items-center gap-3.5 focus:outline-none focus:ring-4 focus:ring-gold focus:bg-white/15 focus:scale-102"
                  >
                    <div className="w-20 h-14 rounded-xl bg-black border border-white/10 overflow-hidden relative shrink-0 flex items-center justify-center">
                      <img
                        src={ep.cover || series.cover || series.stream_icon}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                        onError={(e) => (e.currentTarget.style.display = 'none')}
                      />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play size={16} className="text-gold fill-gold" />
                      </div>
                      <span className="absolute bottom-1 right-1 text-[9px] font-mono font-bold bg-black/80 px-1.5 py-0.5 rounded text-gold">
                        EP {ep.episode_num}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs sm:text-sm font-bold text-white group-hover:text-gold truncate">
                        {ep.title || ep.name || `الحلقة ${ep.episode_num}`}
                      </h4>
                      <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                        الموسم {ep.season_num} · الحلقة {ep.episode_num}
                      </p>
                    </div>

                    <div className="w-8 h-8 rounded-full bg-gold/20 text-gold group-hover:bg-gold group-hover:text-black flex items-center justify-center transition-colors shrink-0">
                      <Play size={12} className="fill-current ml-0.5" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
