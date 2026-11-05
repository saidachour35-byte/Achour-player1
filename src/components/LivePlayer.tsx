import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Hls from 'hls.js';
import { PLAYER_PACKAGES, getPlayerPackage } from '../utils/players';
import { 
  Search, Zap, LayoutGrid, List, ArrowUpDown, Trash2, Clock, 
  Play, Pause, EyeOff, MonitorPlay, Plus, X, History, Database, 
  Maximize, Minimize, Eye, RotateCcw, AlertTriangle, ShieldCheck, ChevronLeft, ChevronRight,
  Star, Volume2, VolumeX, Sun, Tv, HelpCircle, Filter, Sparkles, Radio,
  Film, Clapperboard, Check, Sliders, Monitor, ChevronUp, ChevronDown, Layers, Info, ArrowUp, ArrowDown, Move, Copy, Mic, MicOff, Calendar
} from 'lucide-react';
import AIOcrModal from './AIOcrModal';
import PinUnlockModal from './PinUnlockModal';
import VodPlayerModal from './VodPlayerModal';
import { SeriesDetailsModal } from './SeriesDetailsModal';
import EPGGrid from './EPGGrid';
import VirtualizedChannelList from './VirtualizedChannelList';
import { collection, query, where, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import axios from 'axios';
import { AppSettings, Channel, Language, Playlist } from '../types';
import { useI18n } from '../utils/i18n';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  getLocalFavoriteIds, 
  syncFavoritesFromFirestore, 
  toggleFavorite as toggleFavoriteService, 
  subscribeFavorites 
} from '../utils/favoritesService';
import { xtreamFetch } from '../utils/iptv';
import { getRecents, addToRecents } from '../utils/recentService';
import { getPlatformUrl, isAndroid } from '../utils/platform';
import { formatLanguageLabel } from '../utils/mediaTracks';
import { pushBackHandler } from '../utils/tvNavigation';
import { iptvGlobalCache } from '../utils/iptv';

// Helper for long press detection
const useLongPress = (callback: () => void, ms = 600) => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);

  const start = useCallback(() => {
    isLongPress.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isLongPress.current = true;
      callback();
    }, ms);
  }, [callback, ms]);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (isLongPress.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Select' || e.keyCode === 13 || e.keyCode === 23) {
      if (!timerRef.current) {
        start();
      }
    }
  }, [start]);

  const onKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Select' || e.keyCode === 13 || e.keyCode === 23) {
      stop();
    }
  }, [stop]);

  return {
    onMouseDown: start,
    onMouseUp: stop,
    onMouseLeave: stop,
    onTouchStart: start,
    onTouchEnd: stop,
    onKeyDown,
    onKeyUp,
    onContextMenu: (e: React.MouseEvent) => {
      if (isLongPress.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onClick
  };
};

const CategoryButton = React.memo(({ cat, catIdx, isSelected, onSelect, onReorder, isRtl }: any) => {
  const catLongPress = useLongPress(() => {
    onReorder(cat, catIdx);
  });

  return (
    <button
      {...catLongPress}
      data-tv-focusable="true"
      data-tv-pane="categories"
      data-index={catIdx + 1}
      tabIndex={0}
      onClick={(e) => {
        onSelect(cat.category_id);
        if (catLongPress.onClick) catLongPress.onClick(e);
      }}
      onKeyDown={catLongPress.onKeyDown}
      onKeyUp={catLongPress.onKeyUp}
      className={`w-full flex items-center justify-between px-3.5 py-3 sm:py-3.5 text-xs sm:text-sm md:text-base font-black transition-all border-b border-white/5 focus:outline-none focus:ring-4 focus:ring-gold focus:scale-105 focus:z-20 focus:bg-gold/25 ${
        isSelected
          ? 'bg-gold/20 text-white border-l-4 border-l-gold shadow-inner font-black'
          : 'text-zinc-300 hover:bg-white/10 hover:text-white'
      }`}
      title={isRtl ? 'اضغط مطولاً لإعادة ترتيب المجموعة' : 'Long press to reorder category'}
    >
      <span className="truncate pr-1 text-xs sm:text-sm md:text-base font-black leading-snug">{cat.category_name}</span>
      {cat.count > 0 && (
        <span className="text-[10px] sm:text-xs font-mono font-bold text-zinc-400 bg-white/10 px-2 py-0.5 rounded-full shrink-0">{cat.count}</span>
      )}
    </button>
  );
});

const ChannelListItem = React.memo(({ ch, idx, isSelected, isFav, onSelect, onToggleFavorite, onReorder, onMove, isRtl, totalCount, channels, onDoubleClick }: any) => {
  const lastClickRef = useRef<number>(0);

  const longPress = useLongPress(() => {
    const realIdx = channels.findIndex((c: any) => c.stream_id === ch.stream_id);
    onReorder({ ...ch, realIdx });
  });

  const handleClick = (e: React.MouseEvent | React.TouchEvent) => {
    const now = Date.now();
    const timeSinceLast = now - lastClickRef.current;
    lastClickRef.current = now;

    if (timeSinceLast > 10 && timeSinceLast < 500) {
      // Double tap or double click detected - Open Fullscreen
      if (onDoubleClick) {
        onDoubleClick(ch);
      }
    } else {
      // Single click - Just select/play in small window
      onSelect(ch);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-tv-focusable="true"
      data-tv-pane="channels"
      {...longPress}
      onClick={handleClick}
      onFocus={(e) => {
        e.currentTarget.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }}
      onKeyDown={(e) => {
        if (longPress.onKeyDown) longPress.onKeyDown(e as any);

        // Direct Left Arrow -> Focus active Category item directly without intermediate hops
        if (e.key === 'ArrowLeft' || e.keyCode === 37 || e.keyCode === 21) {
          e.preventDefault();
          e.stopPropagation();
          const activeCat = document.querySelector('[data-tv-pane="categories"].bg-gold\\/20') as HTMLElement ||
                            document.querySelector('[data-tv-pane="categories"]') as HTMLElement;
          if (activeCat) {
            activeCat.focus();
            activeCat.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          return;
        }

        // Direct Right Arrow -> Focus player viewport
        if (e.key === 'ArrowRight' || e.keyCode === 39 || e.keyCode === 22) {
          e.preventDefault();
          e.stopPropagation();
          const playerTarget = document.querySelector('[data-tv-pane="player"]') as HTMLElement;
          if (playerTarget) {
            playerTarget.focus();
          }
          return;
        }

        if (e.key === 'Enter' || e.key === 'Select' || e.keyCode === 13 || e.keyCode === 23) {
          if (isSelected) {
             if (onDoubleClick) onDoubleClick(ch);
          } else {
             handleClick(e as any);
          }
        }
      }}
      onKeyUp={longPress.onKeyUp as any}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onSelect(ch);
        if (onDoubleClick) {
          onDoubleClick(ch);
        }
      }}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl border transition-all relative group cursor-pointer focus:outline-none focus:ring-4 focus:ring-gold focus:scale-102 ${
        isSelected 
          ? 'bg-gold/20 text-white border-gold shadow-sm' 
          : 'border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
      } ${isRtl ? 'flex-row-reverse text-right' : 'text-left'}`}
    >
      <button 
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          const realIdx = channels.findIndex((c: any) => c.stream_id === ch.stream_id);
          onReorder({ ...ch, realIdx });
        }}
        className="w-5 text-[10px] text-gold font-mono font-bold shrink-0 hover:underline focus:outline-none"
        title="تغيير الترتيب / الرقم"
      >
        {idx + 1}
      </button>
      <div className="w-7 h-7 aspect-square rounded-lg bg-black/60 flex items-center justify-center overflow-hidden shrink-0 border border-white/10 shadow-sm">
        {ch.stream_icon ? (
          <img src={ch.stream_icon} className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} alt="" />
        ) : (
          <Play size={11} className={isSelected ? 'text-gold' : 'text-zinc-600'} />
        )}
      </div>
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <span className="text-[10px] sm:text-[11px] font-bold truncate leading-snug text-zinc-200">{ch.name}</span>
        <span className="text-[8px] font-bold text-gold/50 truncate uppercase tracking-tight">{ch.category_name || 'General'}</span>
      </div>
      
      <button 
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(ch.stream_id); }} 
        className={`p-1 rounded-lg transition-all focus:outline-none ${isFav ? 'text-gold' : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-white'}`}
      >
        <Star size={12} className={isFav ? 'fill-gold' : ''} />
      </button>
    </div>
  );
});

const getAspectRatioClass = (ratio: string) => {
  if (ratio === '16:9') return 'w-full h-full object-contain aspect-video bg-black mx-auto';
  if (ratio === '4:3') return 'w-[82%] h-full object-contain aspect-[4/3] bg-black mx-auto';
  if (ratio === 'fill') return 'w-full h-full object-cover bg-black';
  return 'w-full h-full object-contain bg-black';
};

interface MultiVideoSlotProps {
  slotIdx: number;
  channel: ParsedChannel | null;
  isActive: boolean;
  multiViewMode: 'none' | 'dual' | 'quad';
  activePlaylist: Playlist | null;
  mediaType: string;
  settings: any;
  volume: number;
  isMuted: boolean;
  brightness: number;
  aspectRatio: string;
  isRtl: boolean;
  loading: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onRegisterVideo: (slotIdx: number, vid: HTMLVideoElement | null) => void;
  onRegisterHls?: (slotIdx: number, hls: Hls | null) => void;
  onTracksUpdate?: (slotIdx: number, tracks: {
    audioTracks?: { id: number; name: string; lang?: string }[];
    subtitleTracks?: { id: number; name: string; lang?: string }[];
    levels?: { id: number; height: number; bitrate: number; name: string }[];
    currentAudio?: number;
    currentSubtitle?: number;
    currentLevel?: number;
    realResolution?: string;
    videoWidth?: number;
    videoHeight?: number;
  }) => void;
  onPlayingChange: (isPlaying: boolean) => void;
}

const MultiVideoSlot: React.FC<MultiVideoSlotProps> = ({
  slotIdx,
  channel,
  isActive,
  multiViewMode,
  activePlaylist,
  mediaType,
  settings,
  volume,
  isMuted,
  brightness,
  aspectRatio,
  isRtl,
  loading,
  onClick,
  onDoubleClick,
  onRegisterVideo,
  onRegisterHls,
  onTracksUpdate,
  onPlayingChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [slotLoading, setSlotLoading] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [streamError, setStreamError] = useState<{ status?: number; title: string; detail: string } | null>(null);

  useEffect(() => {
    setStreamError(null);
    const container = containerRef.current;
    const safelyCleanupVideo = (vid: HTMLVideoElement | null) => {
      if (!vid) return;
      try {
        vid.pause();
        vid.removeAttribute('src');
        vid.load();
      } catch (e) {}
    };

    if (!container || !channel || settings.useExternalPlayer) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (videoRef.current) {
        safelyCleanupVideo(videoRef.current);
        videoRef.current = null;
      }
      if (container) container.innerHTML = '';
      onRegisterVideo(slotIdx, null);
      if (onRegisterHls) onRegisterHls(slotIdx, null);
      return;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      safelyCleanupVideo(videoRef.current);
      videoRef.current = null;
    }
    container.innerHTML = '';

    let rawStreamUrl = channel.url;

    if (!rawStreamUrl) return;

    // Xtream live streams support .m3u8 directly which Hls.js requires for playback
    let playUrl = rawStreamUrl;
    if (playUrl.includes('/live/') && playUrl.endsWith('.ts')) {
      playUrl = playUrl.replace(/\.ts$/, '.m3u8');
    }

    let streamUrl = getPlatformUrl('stream', playUrl, {
      vpnRegion: settings.vpnRegion || 'auto',
      t: Date.now().toString()
    });

    setSlotLoading(true);
    const videoTag = document.createElement('video');
    videoTag.autoplay = true;
    videoTag.playsInline = true;
    videoTag.setAttribute('playsinline', 'true');
    videoTag.setAttribute('webkit-playsinline', 'true');
    videoTag.setAttribute('crossorigin', 'anonymous');
    videoTag.style.backgroundColor = '#000000';
    videoTag.className = `${getAspectRatioClass(aspectRatio)} pointer-events-none`;
    videoTag.volume = isActive ? (isMuted ? 0 : volume) : 0;
    videoTag.muted = !isActive || isMuted || volume === 0;
    videoTag.style.filter = `brightness(${brightness})`;

    const safePlayVideo = () => {
      try {
        const p = videoTag.play();
        if (p !== undefined) {
          p.catch((err: any) => {
            // Ignore abort error when interrupted by pause or channel switch
            if (err?.name === 'AbortError' || err?.message?.includes('interrupted') || err?.message?.includes('pause')) {
              return;
            }
            if (err?.name === 'NotAllowedError') {
              videoTag.muted = true;
              videoTag.play().catch((e2: any) => {
                if (e2?.name === 'AbortError' || e2?.message?.includes('interrupted')) return;
                console.warn(`Muted playback error:`, e2);
              });
              return;
            }
            console.warn(`Playback warning for slot ${slotIdx}:`, err);
          });
        }
      } catch (e) {}
    };

    const updateResolutionMeta = () => {
      if (videoTag.videoWidth && videoTag.videoHeight) {
        const w = videoTag.videoWidth;
        const h = videoTag.videoHeight;
        let resLabel = `${w}x${h}`;
        if (w >= 3840) resLabel = `4K UHD (${w}x${h})`;
        else if (w >= 1920) resLabel = `1080p FHD (${w}x${h})`;
        else if (w >= 1280) resLabel = `720p HD (${w}x${h})`;
        else resLabel = `SD (${w}x${h})`;

        if (onTracksUpdate) {
          onTracksUpdate(slotIdx, {
            realResolution: resLabel,
            videoWidth: w,
            videoHeight: h
          });
        }
      }
    };

    videoTag.onloadedmetadata = () => {
      updateResolutionMeta();
    };
    videoTag.onresize = () => {
      updateResolutionMeta();
    };

    videoTag.onplay = () => {
      setSlotLoading(false);
      setStreamError(null);
      updateResolutionMeta();
      if (isActive) onPlayingChange(true);
    };
    videoTag.onpause = () => {
      if (isActive) onPlayingChange(false);
    };
    videoTag.onerror = () => {
      // If direct playback on video tag failed, try local proxy stream fallback
      if (!videoTag.src.includes('/api/proxy/stream')) {
        const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(rawStreamUrl)}&vpnRegion=${encodeURIComponent(settings.vpnRegion || 'auto')}`;
        videoTag.src = proxyUrl;
        videoTag.play().catch(() => {
          setSlotLoading(false);
          setStreamError({ status: 404, title: '', detail: '' });
        });
      } else {
        setSlotLoading(false);
        setStreamError({
          status: 404,
          title: '',
          detail: ''
        });
      }
    };

    container.appendChild(videoTag);
    videoRef.current = videoTag;
    onRegisterVideo(slotIdx, videoTag);

    const isHls = streamUrl.includes('.m3u8') || streamUrl.includes('smil:') || !streamUrl.match(/\.(mp4|mkv|avi|mov|webm)$/i);

    if (isHls && Hls.isSupported()) {
      const playerEngine = settings?.selectedPlayer || 'Achour Player (مدمج - Native)';
      let hlsConfig: any = { 
        enableWorker: false, 
        lowLatencyMode: true, 
        backBufferLength: 0,
        maxBufferLength: 10,
        maxMaxBufferLength: 20
      };

      if (playerEngine.includes('VLC')) {
        hlsConfig = { enableWorker: false, lowLatencyMode: false, maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 0 };
      } else if (playerEngine.includes('IJK')) {
        hlsConfig = { enableWorker: false, lowLatencyMode: true, maxBufferLength: 10, maxMaxBufferLength: 20, backBufferLength: 0 };
      } else if (playerEngine.includes('MX Player')) {
        hlsConfig = { enableWorker: false, lowLatencyMode: true, maxBufferLength: 20, maxMaxBufferLength: 45, backBufferLength: 0 };
      } else if (playerEngine.includes('MPV')) {
        hlsConfig = { enableWorker: false, lowLatencyMode: false, maxBufferLength: 60, maxMaxBufferLength: 120, backBufferLength: 0 };
      } else if (playerEngine.includes('ExoPlayer')) {
        hlsConfig = { enableWorker: false, lowLatencyMode: true, liveSyncDurationCount: 2, maxBufferLength: 15, backBufferLength: 0 };
      } else if (playerEngine.includes('Fire TV') || playerEngine.includes('Amazon') || playerEngine.includes('فاير')) {
        hlsConfig = { 
          enableWorker: false, 
          lowLatencyMode: true, 
          backBufferLength: 0,
          maxBufferLength: 8, 
          maxMaxBufferLength: 16,
          manifestLoadingMaxRetry: 8,
          manifestLoadingRetryDelay: 500,
          levelLoadingMaxRetry: 8,
          levelLoadingRetryDelay: 500,
          startLevel: -1,
          liveSyncDurationCount: 2,
          capLevelToPlayerSize: true,
          enableHardwareAcceleration: true
        };
      } else {
        // Default Optimized Achour Engine (Fast Switching & TV Compatibility & 4K Clarity)
        hlsConfig = { 
          enableWorker: false, // CRITICAL: Better compatibility on Android TVs/Fire TV
          lowLatencyMode: true, 
          backBufferLength: 0,
          maxBufferLength: 6,
          maxMaxBufferLength: 12,
          manifestLoadingMaxRetry: 8,
          manifestLoadingRetryDelay: 500,
          levelLoadingMaxRetry: 8,
          levelLoadingRetryDelay: 500,
          startLevel: -1,
          liveSyncDurationCount: 2,
          capLevelToPlayerSize: true, // Optimizes 4K rendering
          adaptiveMaxWidth: 3840,
          enableHardwareAcceleration: true // Better 4K color handling
        };
      }

      const hls = new Hls(hlsConfig);
      hls.loadSource(streamUrl);
      hls.attachMedia(videoTag);

      const reportTracks = () => {
        if (onTracksUpdate) {
          onTracksUpdate(slotIdx, {
            audioTracks: (hls.audioTracks || []).map((t: any, idx: number) => ({
              id: idx,
              name: t.name || t.lang || (isRtl ? `مسار صوتي ${idx + 1}` : `Audio Track ${idx + 1}`),
              lang: t.lang
            })),
            subtitleTracks: (hls.subtitleTracks || []).map((t: any, idx: number) => ({
              id: idx,
              name: t.name || t.lang || (isRtl ? `ترجمة ${idx + 1}` : `Subtitle ${idx + 1}`),
              lang: t.lang
            })),
            levels: (hls.levels || []).map((lvl: any, idx: number) => ({
              id: idx,
              height: lvl.height || 0,
              bitrate: lvl.bitrate || 0,
              name: lvl.height ? `${lvl.height}p` : `Level ${idx + 1}`
            })),
            currentAudio: hls.audioTrack,
            currentSubtitle: hls.subtitleTrack,
            currentLevel: hls.currentLevel
          });
        }
      };

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        safePlayVideo();
        reportTracks();
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, reportTracks);
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, reportTracks);
      hls.on(Hls.Events.LEVEL_LOADED, reportTracks);

      let netRetryCount = 0;

      hls.on(Hls.Events.ERROR, (_event, data) => {
        // Ignore non-fatal fragment loading errors (e.g., stale 404 .ts segment in live streams)
        if (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR || data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT) {
          console.warn(`[Player] Non-fatal fragment error (${data.details}). HLS player continuing...`);
          return;
        }

        if (data.fatal || data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
          netRetryCount++;
          console.warn(`[Player] Fatal HLS error: ${data.type} (${data.details}), attempt ${netRetryCount}`);

          if (netRetryCount === 1) {
            // Toggle between proxied URL and direct URL
            if (streamUrl.includes('/api/proxy/stream')) {
              console.log(`[Player] Fallback from proxy to direct raw stream URL: ${playUrl}`);
              hls.loadSource(playUrl);
              hls.startLoad();
              return;
            } else {
              const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(playUrl)}&vpnRegion=${encodeURIComponent(settings.vpnRegion || 'auto')}`;
              console.log(`[Player] Fallback from direct to stream proxy: ${proxyUrl}`);
              hls.loadSource(proxyUrl);
              hls.startLoad();
              return;
            }
          }

          if (netRetryCount <= 3) {
            hls.startLoad();
          } else {
            hls.stopLoad();
            setSlotLoading(false);
            setStreamError({
              status: 404,
              title: '',
              detail: ''
            });
          }
        }
      });
      hlsRef.current = hls;
      if (onRegisterHls) onRegisterHls(slotIdx, hls);
    } else {
      videoTag.src = streamUrl;
      safePlayVideo();
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (videoRef.current) {
        try {
          videoRef.current.pause();
          videoRef.current.muted = true;
          videoRef.current.volume = 0;
          videoRef.current.src = '';
          videoRef.current.removeAttribute('src');
          videoRef.current.load();
        } catch (e) {}
        videoRef.current = null;
      }
      onRegisterVideo(slotIdx, null);
      if (onRegisterHls) onRegisterHls(slotIdx, null);
    };
  }, [channel?.url, channel?.stream_id, activePlaylist?.username, activePlaylist?.password, settings.vpnEnabled, settings.vpnRegion, mediaType, retryNonce]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isActive ? (isMuted ? 0 : volume) : 0;
      videoRef.current.muted = !isActive || isMuted || volume === 0;
    }
  }, [isActive, isMuted, volume]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.style.filter = `brightness(${brightness})`;
    }
  }, [brightness]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.className = getAspectRatioClass(aspectRatio);
    }
  }, [aspectRatio]);

  return (
    <div
      data-tv-focusable="true"
      data-tv-pane="player"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`relative w-full h-full bg-zinc-950 rounded-lg overflow-hidden flex items-center justify-center cursor-pointer group ${
        multiViewMode !== 'none'
          ? isActive
            ? 'ring-4 ring-gold z-30 shadow-2xl'
            : 'ring-1 ring-white/10 opacity-85 hover:opacity-100'
          : 'border-0'
      }`}
    >
      <div ref={containerRef} className="w-full h-full flex items-center justify-center z-10 bg-black" />

      {multiViewMode !== 'none' && channel && (
        <div className="absolute top-2 left-2 z-20 px-2 py-0.5 rounded bg-black/80 backdrop-blur-md text-[10px] font-mono font-bold flex items-center gap-1.5 border border-white/10 text-white">
          <span className={isActive ? 'w-2 h-2 rounded-full bg-gold animate-pulse' : 'w-2 h-2 rounded-full bg-zinc-600'} />
          <span className="truncate max-w-[120px]">{channel.name}</span>
        </div>
      )}

      {!channel && !loading && !slotLoading && !streamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400 gap-3 z-10 bg-gradient-to-b from-zinc-950 via-black to-zinc-950 p-6 text-center select-none">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900/80 border border-gold/30 flex items-center justify-center shadow-xl shadow-black/80">
            <Tv size={32} className="text-gold/80 animate-pulse" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <h4 className="text-sm font-black text-white uppercase tracking-wider">{isRtl ? 'مشغل القنوات المباشرة' : 'Live Stream Player'}</h4>
            <p className="text-xs text-zinc-400 font-medium max-w-xs">{isRtl ? 'اختر قناة من القائمة لبدء المشاهدة فوراً' : 'Select a channel from the list to start watching'}</p>
          </div>
        </div>
      )}

      {(loading || slotLoading) && !streamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20 gap-3">
          <div className="w-10 h-10 border-3 border-gold border-t-transparent rounded-full animate-spin shadow-lg shadow-gold/20" />
        </div>
      )}

      {/* Stream Error Recovery Overlay - Minimal with Retry */}
      {streamError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-4 bg-black/75 backdrop-blur-sm text-white text-center rounded-lg">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRetryNonce(n => n + 1);
            }}
            className="px-5 py-2.5 bg-gradient-to-r from-gold to-amber-600 text-black font-black text-xs rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all flex items-center gap-2 shadow-lg shadow-gold/20 active:scale-95"
          >
            <RotateCcw size={16} />
            <span>{isRtl ? 'إعادة المحاولة' : 'Retry'}</span>
          </button>
        </div>
      )}
    </div>
  );
};

interface LivePlayerProps {
  onBack: () => void;
  settings: AppSettings;
  onUpdateSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  userId: string;
  initialType?: 'live' | 'movie' | 'series' | 'favorites';
}

export interface ParsedChannel {
  stream_id: string;
  name: string;
  stream_icon?: string;
  url: string;
  category_id: string;
  category_name?: string;
  container_extension?: string;
  season?: number;
  episode?: number;
}

export interface ParsedCategory {
  category_id: string;
  category_name: string;
  count?: number;
}

export function detectGenre(channelName: string, categoryName: string = ''): string {
  const text = (channelName + ' ' + categoryName).toLowerCase();
  if (/sport|bein|ssc|kora|foot|espn|eurosport|رياض/i.test(text)) return 'sports';
  if (/news|jazeera|arabiya|bbc|cnn|sky news|أخبار|الجزيرة|العربية/i.test(text)) return 'news';
  if (/movie|cinema|film|action|hbo|mbc2|mbc max|أفلام|سينما|أكشن/i.test(text)) return 'movies';
  if (/series|drama|mbc drama|مسلسل|دراما/i.test(text)) return 'series';
  if (/kid|cartoon|disney|spacetoon|cn|أطفال|كرتون|سبيستون/i.test(text)) return 'kids';
  if (/quran|sunnah|islam|قرآن|سنة|إسلام/i.test(text)) return 'religious';
  if (/music|rotana|mtv|موسيقى|اغاني/i.test(text)) return 'music';
  if (/doc|nat geo|discovery|history|وثائقي/i.test(text)) return 'documentary';
  return 'general';
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





export const getCachedIPTVData = (
  type: string, 
  userId?: string, 
  playlistId?: string
): { categories: ParsedCategory[]; channels: ParsedChannel[] } | null => {
  const normType = (type === 'movies' || type === 'vod') ? 'movie' : type;
  
  const candidateKeys = [
    `${userId || ''}_${normType}_${playlistId || ''}`,
    `${userId || ''}_${normType}_default`,
    `${normType}_${playlistId || ''}`,
    `${normType}_default`,
    normType
  ];

  for (const k of candidateKeys) {
    if (k && iptvGlobalCache.has(k)) {
      const cached = iptvGlobalCache.get(k);
      if (cached && (cached.channels?.length > 0 || cached.categories?.length > 0)) {
        return cached;
      }
    }
  }

  if (normType === 'live' && iptvGlobalCache.channels && iptvGlobalCache.channels.length > 0) {
    return {
      channels: iptvGlobalCache.channels,
      categories: (iptvGlobalCache.categories && iptvGlobalCache.categories.length > 0)
        ? iptvGlobalCache.categories
        : (iptvGlobalCache.get('live')?.categories || [])
    };
  }

  if (normType === 'movie' && iptvGlobalCache.vod && iptvGlobalCache.vod.length > 0) {
    return {
      channels: iptvGlobalCache.vod,
      categories: (iptvGlobalCache.get('movie')?.categories) || []
    };
  }

  if (normType === 'series' && iptvGlobalCache.series && iptvGlobalCache.series.length > 0) {
    return {
      channels: iptvGlobalCache.series,
      categories: (iptvGlobalCache.get('series')?.categories) || []
    };
  }

  return null;
};

export default function LivePlayer({ onBack, settings, onUpdateSettings, userId, initialType = 'live' }: LivePlayerProps) {

  const { t, isRtl } = useI18n(settings.language);

  const launchExternalPlayer = (url: string) => {
    const player = settings.selectedPlayer || '';
    const packageName = getPlayerPackage(player);
    const isFireTv = player.toLowerCase().includes('fire') || packageName.includes('amazon') || packageName.includes('firetv');

    const isM3u8 = url.includes('.m3u8');
    const mimeType = isM3u8 ? 'application/x-mpegURL' : 'video/*';

    // 1. Native Android / Fire TV APK Bridge
    const native = (window as any).AchourNative || (window as any).Android || (window as any).FireTVBridge;
    if (native && typeof native.playMedia === 'function') {
      try {
        const favIds = getLocalFavoriteIds();
        const isFav = favIds.includes(selectedChannel?.stream_id || '');
        native.playMedia(url, JSON.stringify({
          title: selectedChannel?.name || 'Achour TV',
          logo: selectedChannel?.stream_icon || '',
          stream_id: selectedChannel?.stream_id || '',
          type: mediaType,
          isFavorite: isFav,
          player: player,
          packageName: packageName || undefined,
          mimeType: mimeType,
          headers: {
            'User-Agent': 'Amazon/FireTV/ExoPlayer/2.18.1',
            'X-Requested-With': 'com.nathnetwork.iptvsmarters'
          }
        }));
        return;
      } catch (e) {
        console.warn('Native Media Bridge Call Failed', e);
      }
    }

    // 2. Android / Fire TV Intent Launch
    if (packageName && !isFireTv && packageName !== 'system') {
      const intentUrl = `intent:${url}#Intent;action=android.intent.action.VIEW;type=${mimeType};package=${packageName};end`;
      window.location.href = intentUrl;
      console.log(`Launching ${player} with package ${packageName}`);
    } else {
      // Fire TV Player / Default Fire OS System Video Intent
      const fireTvIntent = `intent:${url}#Intent;action=android.intent.action.VIEW;type=${mimeType};end`;
      try {
        window.location.href = fireTvIntent;
      } catch (e) {
        window.location.href = url;
      }
    }
  };

  const initialCached = getCachedIPTVData(initialType || 'live', userId, settings.activePlaylistId);

  const [mediaType, setMediaType] = useState<'live' | 'movie' | 'series' | 'favorites'>(initialType as any);
  const [categories, setCategories] = useState<ParsedCategory[]>(() => initialCached?.categories || []);
  const [channels, setChannels] = useState<ParsedChannel[]>(() => initialCached?.channels || []);
  const [selectedCategory, setSelectedCategory] = useState<string>(() => initialCached?.categories?.[0]?.category_id || '');
  const [selectedChannel, setSelectedChannel] = useState<ParsedChannel | null>(null);
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'none' | 'az'>('none');
  const [loading, setLoading] = useState<boolean>(() => !initialCached || initialCached.channels.length === 0);
  const [selectedSeriesDetailsItem, setSelectedSeriesDetailsItem] = useState<any | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [streamingHost, setStreamingHost] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showOcr, setShowOcr] = useState(false);
  const [showRemoteHelp, setShowRemoteHelp] = useState(false);
  const [showOverlayChannelDrawer, setShowOverlayChannelDrawer] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [activeVodPlayer, setActiveVodPlayer] = useState<ParsedChannel | null>(null);
  const [showEpgGrid, setShowEpgGrid] = useState(false);
  
  const [itemsToShow, setItemsToShow] = useState(100);
  const [movieDetailsModal, setMovieDetailsModal] = useState<ParsedChannel | null>(null);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const listContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const restoreLastChannel = async () => {
      // Do not auto-select or auto-play channel on Live TV initial load so user can browse categories/channels first
      if (mediaType !== 'live' && channels.length > 0 && !selectedChannel) {
        try {
          const lastId = localStorage.getItem('achour_last_stream_id');
          if (lastId) {
            const lastCh = channels.find(c => c.stream_id === lastId);
            if (lastCh) {
              setSelectedChannel(lastCh);
            }
          }
        } catch (e) {}
      }
    };
    if (!loading) restoreLastChannel();
  }, [loading, channels, selectedChannel, mediaType]);

  // Register pushBackHandler in LivePlayer so remote & phone Back button navigates back cleanly
  useEffect(() => {
    const unregister = pushBackHandler(() => {
      if (showOcr) { setShowOcr(false); return true; }
      if (showPinModal) { setShowPinModal(false); return true; }
      if (showRemoteHelp) { setShowRemoteHelp(false); return true; }
      if (showOverlayChannelDrawer) { setShowOverlayChannelDrawer(false); return true; }
      if (movieDetailsModal) { setMovieDetailsModal(null); return true; }
      if (showEpgGrid) { setShowEpgGrid(false); return true; }

      if (activeVodPlayer) {
        setActiveVodPlayer(null);
        return true;
      }

      if (selectedChannel) {
        setSelectedChannel(null);
        return true;
      }

      onBack();
      return true;
    });

    return unregister;
  }, [
    showOcr, showPinModal, showRemoteHelp, showOverlayChannelDrawer,
    movieDetailsModal, showEpgGrid, activeVodPlayer, selectedChannel, onBack
  ]);

  useEffect(() => {
    setItemsToShow(100);
  }, [selectedCategory, search, mediaType]);

  // Auto-focus "Play Now" button when Movie/Series details modal opens
  useEffect(() => {
    if (movieDetailsModal) {
      const timer = setTimeout(() => {
        const playBtn = document.querySelector<HTMLElement>('[data-tv-play-now="true"]');
        if (playBtn) {
          playBtn.focus();
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [movieDetailsModal]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 100) {
      setItemsToShow(prev => prev + 100);
    }
  }, []);

  const [multiViewMode, setMultiViewMode] = useState<'none' | 'dual' | 'quad'>('none');
  const [multiChannels, setMultiChannels] = useState<(ParsedChannel | null)[]>([null, null, null, null]);
  const [activeSlot, setActiveSlot] = useState<number>(0);

  useEffect(() => {
    if (multiChannels[0] && multiViewMode === 'none') {
      setSelectedChannel(multiChannels[0]);
    }
  }, [multiChannels, multiViewMode]);

  useEffect(() => {
    if (selectedChannel && multiViewMode === 'none') {
      // Save last channel
      try {
        localStorage.setItem('achour_last_stream_id', selectedChannel.stream_id);
      } catch (e) {}

      // ONLY launch external player if user explicitly enabled useExternalPlayer in settings
      if (settings.useExternalPlayer) {
        launchExternalPlayer(selectedChannel.url);
      } else {
        setMultiChannels(prev => {
          const next = [...prev];
          next[0] = selectedChannel;
          return next;
        });
      }
    }
  }, [selectedChannel, multiViewMode, settings.useExternalPlayer]);

  const [mediaDetailInfo, setMediaDetailInfo] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activePlayingMovie, setActivePlayingMovie] = useState<ParsedChannel | null>(null);
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(1);

  const seriesSeasonsData = useMemo(() => {
    const targetMedia = movieDetailsModal || activeVodPlayer;
    if (mediaType !== 'series' || !targetMedia) return [];

    if (mediaDetailInfo?.episodes) {
      const epMap = mediaDetailInfo.episodes;
      const keys = Object.keys(epMap).map(k => parseInt(k, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
      if (keys.length > 0) {
        return keys.map(seasonNum => {
          const rawEps = epMap[String(seasonNum)] || [];
          const episodesList = rawEps.map((ep: any, idx: number) => {
            const epNum = ep.episode_num || idx + 1;
            const rawStreamId = String(ep.id || ep.stream_id || `${targetMedia.stream_id}-s${seasonNum}-e${epNum}`);
            const cleanStreamId = rawStreamId.replace(/\.(mp4|mkv|avi|mov|webm|ts|m3u8)$/i, '');
            const ext = ep.container_extension || targetMedia.container_extension || 'mp4';
            
            let epDirectUrl = ep.stream_url || ep.url || targetMedia.url;
            if (activePlaylist?.type === 'xtream' && activePlaylist.username && activePlaylist.password) {
              const baseHost = streamingHost || (activePlaylist.url || '').trim().replace(/\/+$/, '').replace(/\/(player_api|get|index)\.php.*$/i, '').replace(/\/c\/?$/i, '').replace(/\?.*$/, '');
              epDirectUrl = `${baseHost}/series/${activePlaylist.username}/${activePlaylist.password}/${cleanStreamId}.${ext}`;
            }

            return {
              stream_id: cleanStreamId,
              name: `${targetMedia.name} - S${seasonNum} E${epNum}: ${ep.title || (isRtl ? `الحلقة ${epNum}` : `Episode ${epNum}`)}`,
              stream_icon: ep.info?.movie_image || targetMedia.stream_icon,
              url: epDirectUrl,
              category_id: targetMedia.category_id,
              category_name: targetMedia.category_name,
              container_extension: ext,
              season: seasonNum,
              episode: epNum
            };
          });

          return {
            seasonNumber: seasonNum,
            title: isRtl ? `الموسم ${seasonNum}` : `Season ${seasonNum}`,
            episodes: episodesList
          };
        });
      }
    }

    return [];
  }, [mediaType, movieDetailsModal, activeVodPlayer, mediaDetailInfo, isRtl]);

  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [brightness, setBrightness] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [selectedQuality, setSelectedQuality] = useState<string>('4K Ultra HD');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '4:3' | 'fill' | 'fit'>('16:9');
  
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState('Audio 1 (الأساسي - Primary)');
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState('Off (مغلق)');
  const [subtitleActive, setSubtitleActive] = useState<boolean>(false);

  const [activeTracksData, setActiveTracksData] = useState<{
    audioTracks: { id: number; name: string; lang?: string }[];
    subtitleTracks: { id: number; name: string; lang?: string }[];
    levels: { id: number; height: number; bitrate: number; name: string }[];
    currentAudio: number;
    currentSubtitle: number;
    currentLevel: number;
    realResolution?: string;
    videoWidth?: number;
    videoHeight?: number;
  }>({
    audioTracks: [],
    subtitleTracks: [],
    levels: [],
    currentAudio: 0,
    currentSubtitle: -1,
    currentLevel: -1,
    realResolution: ''
  });

  const [zappingInfo, setZappingInfo] = useState<{
    number: number;
    name: string;
    logo?: string;
    category?: string;
    direction?: 'next' | 'prev';
  } | null>(null);
  const zapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (zappingInfo) {
      if (zapTimeoutRef.current) clearTimeout(zapTimeoutRef.current);
      zapTimeoutRef.current = setTimeout(() => {
        setZappingInfo(null);
      }, 2500);
    }
  }, [zappingInfo]);

  const [showControls, setShowControls] = useState<boolean>(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const triggerControlsVisibility = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (!showAudioMenu && !showSubMenu && !showQualityMenu && !movieDetailsModal) {
        setShowControls(false);
      }
    }, isFullscreen ? 8000 : 5000);
  }, [showAudioMenu, showSubMenu, showQualityMenu, movieDetailsModal, isFullscreen]);

  const toggleControlsVisibility = useCallback(() => {
    setShowControls(prev => {
      const next = !prev;
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (next) {
        controlsTimeoutRef.current = setTimeout(() => {
          if (!showAudioMenu && !showSubMenu && !showQualityMenu && !movieDetailsModal) {
            setShowControls(false);
          }
        }, isFullscreen ? 8000 : 5000);
      }
      return next;
    });
  }, [showAudioMenu, showSubMenu, showQualityMenu, movieDetailsModal, isFullscreen]);

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (showAudioMenu || showSubMenu || showQualityMenu) {
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    }
  }, [showAudioMenu, showSubMenu, showQualityMenu]);

  const [showEpgTimeline, setShowEpgTimeline] = useState(false);
  const [epgData, setEpgData] = useState<any[]>([]);
  const [epgLoading, setEpgLoading] = useState(false);
  const [xmltvData, setXmltvData] = useState<Record<string, any[]>>({});

  const parseXMLTV = (xmlText: string) => {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const programs = xmlDoc.getElementsByTagName("programme");
      const epgMap: Record<string, any[]> = {};

      for (let i = 0; i < programs.length; i++) {
        const prog = programs[i];
        const channelId = prog.getAttribute("channel");
        if (!channelId) continue;

        const title = prog.getElementsByTagName("title")[0]?.textContent || (isRtl ? "بدون عنوان" : "No Title");
        const desc = prog.getElementsByTagName("desc")[0]?.textContent || "";
        const start = prog.getAttribute("start");
        const stop = prog.getAttribute("stop");

        if (!start || !stop) continue;

        const parseXmlTime = (timeStr: string) => {
          const y = parseInt(timeStr.substring(0, 4));
          const m = parseInt(timeStr.substring(4, 6)) - 1;
          const d = parseInt(timeStr.substring(6, 8));
          const h = parseInt(timeStr.substring(8, 10));
          const min = parseInt(timeStr.substring(10, 12));
          const s = parseInt(timeStr.substring(12, 14));
          return new Date(y, m, d, h, min, s);
        };

        const startTime = parseXmlTime(start);
        const stopTime = parseXmlTime(stop);

        if (!epgMap[channelId]) epgMap[channelId] = [];
        epgMap[channelId].push({
          title,
          description: desc,
          start: startTime,
          stop: stopTime,
          timeRange: `${startTime.getHours()}:${String(startTime.getMinutes()).padStart(2, '0')} - ${stopTime.getHours()}:${String(stopTime.getMinutes()).padStart(2, '0')}`
        });
      }

      Object.keys(epgMap).forEach(cid => {
        epgMap[cid].sort((a, b) => a.start.getTime() - b.start.getTime());
      });

      setXmltvData(epgMap);
    } catch (err) {}
  };

  const fetchEPG = async (streamId: string) => {
    if (activePlaylist?.type !== 'xtream') return;
    setEpgLoading(true);
    try {
      const host = (activePlaylist.url || '').trim().replace(/\/+$/, '').replace(/\/(player_api|get|index)\.php.*$/i, '').replace(/\/c\/?$/i, '').replace(/\?.*$/, '');
      const res = await xtreamFetch(host, activePlaylist.username || '', activePlaylist.password || '', 'get_short_epg', { stream_id: streamId });
      if (res.ok && res.data?.epg_listings) setEpgData(res.data.epg_listings);
      else setEpgData([]);
    } catch (e) {
      setEpgData([]);
    } finally {
      setEpgLoading(false);
    }
  };

  useEffect(() => {
    const loadGlobalEPG = async () => {
      if (!activePlaylist?.epgUrl) {
        setXmltvData({});
        return;
      }
      try {
        const fetchUrl = getPlatformUrl('epg', activePlaylist.epgUrl);
        const res = await axios.get(fetchUrl);
        if (typeof res.data === 'string') parseXMLTV(res.data);
      } catch (err) {}
    };
    loadGlobalEPG();
  }, [activePlaylist]);

  useEffect(() => {
    if (showEpgTimeline && selectedChannel) {
      const cid = selectedChannel.stream_id;
      const foundInXml = xmltvData[cid] || xmltvData[selectedChannel.name];
      if (foundInXml) {
        setEpgData(foundInXml.map(p => ({
          title: p.title,
          start: p.start.toISOString(),
          end: p.stop.toISOString(),
          description: p.description
        })));
      } else {
        fetchEPG(selectedChannel.stream_id);
      }
    }
  }, [showEpgTimeline, selectedChannel, xmltvData]);

  const getCurrentProgram = (channel: ParsedChannel | null) => {
    if (!channel) return null;
    const cid = channel.stream_id;
    const programs = xmltvData[cid] || xmltvData[channel.name];
    if (!programs) return null;
    const now = new Date();
    return programs.find(p => p.start <= now && p.stop >= now);
  };

  const getNextProgram = (channel: ParsedChannel | null) => {
    if (!channel) return null;
    const cid = channel.stream_id;
    const programs = xmltvData[cid] || xmltvData[channel.name];
    if (!programs) return null;
    const now = new Date();
    return programs.find(p => p.start > now);
  };

  const [reorderTarget, setReorderTarget] = useState<{ type: 'category' | 'channel', id: string, index: number, name: string } | null>(null);
  const [targetPosInput, setTargetPosInput] = useState('');

  const [favorites, setFavorites] = useState<string[]>(() => getLocalFavoriteIds());

  // 2-Pane D-Pad TV Remote Control Navigation States
  const [tvFocusedPane, setTvFocusedPane] = useState<'categories' | 'channels' | 'header' | 'player' | 'player-controls'>('categories');
  const [tvFocusedCatIndex, setTvFocusedCatIndex] = useState<number>(0);
  const [tvFocusedChannelIndex, setTvFocusedChannelIndex] = useState<number>(0);
  const [tvFocusedControlIndex, setTvFocusedControlIndex] = useState<number>(0);

  // 2-Pane D-Pad TV Remote Control Navigation Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const code = e.keyCode;
      const isBackKey = key === 'Escape' || key === 'Backspace' || key === 'GoBack' || key === 'Back' ||
                        code === 10009 || code === 461 || code === 27 || code === 8;

      // Don't intercept typing in search / text inputs
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        if (isBackKey) {
           (document.activeElement as HTMLElement).blur();
           e.preventDefault();
        }
        return;
      }

      // Handle Back button on TV Remote for any open modals / overlays
      if (isBackKey) {
        e.preventDefault();
        if (movieDetailsModal) { setMovieDetailsModal(null); return; }
        if (activeVodPlayer) { setActiveVodPlayer(null); return; }
        if (reorderTarget) { setReorderTarget(null); return; }
        if (showEpgGrid) { setShowEpgGrid(false); return; }
        if (showEpgTimeline) { setShowEpgTimeline(false); return; }
        if (showAudioMenu || showSubMenu || showQualityMenu) {
          setShowAudioMenu(false); setShowSubMenu(false); setShowQualityMenu(false);
          return;
        }
        if (isFullscreen) { toggleFullscreen(); return; }
        if (showPinModal) { onBack(); return; }
        
        if (tvFocusedPane === 'channels') {
          setTvFocusedPane('categories');
          const cats = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="categories"]'));
          cats[tvFocusedCatIndex]?.focus();
          return;
        }
        
        onBack();
        return;
      }

      // If Movie/Series Details Modal is open, handle D-Pad navigation inside the modal
      if (movieDetailsModal) {
        const modalFocusables = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-modal="details"]'));
        if (modalFocusables.length > 0) {
          const activeIndex = modalFocusables.findIndex(el => el === document.activeElement);
          let current = activeIndex >= 0 ? activeIndex : 0;

          if (key === 'ArrowDown' || code === 40) {
            e.preventDefault();
            const next = Math.min(modalFocusables.length - 1, current + 1);
            modalFocusables[next]?.focus();
            modalFocusables[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else if (key === 'ArrowUp' || code === 38) {
            e.preventDefault();
            const next = Math.max(0, current - 1);
            modalFocusables[next]?.focus();
            modalFocusables[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else if (key === 'ArrowRight' || code === 39) {
            e.preventDefault();
            const step = isRtl ? -1 : 1;
            const next = Math.max(0, Math.min(modalFocusables.length - 1, current + step));
            modalFocusables[next]?.focus();
          } else if (key === 'ArrowLeft' || code === 37) {
            e.preventDefault();
            const step = isRtl ? 1 : -1;
            const next = Math.max(0, Math.min(modalFocusables.length - 1, current + step));
            modalFocusables[next]?.focus();
          } else if (key === 'Enter' || code === 13 || key === 'Select' || code === 23) {
            e.preventDefault();
            modalFocusables[current]?.click();
          }
        }
        return;
      }

      // Fullscreen or Multi-view Player Navigation
      if (isFullscreen || multiViewMode !== 'none') {
        const playerFocusables = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="player"], [data-tv-pane="player-controls"]'));
        const activeIdx = playerFocusables.findIndex(el => el === document.activeElement);
        const activeEl = activeIdx !== -1 ? playerFocusables[activeIdx] : null;
        const isSlotFocused = activeEl?.getAttribute('data-tv-pane') === 'player';
        
        const slotCols = multiViewMode === 'quad' ? 2 : multiViewMode === 'dual' ? 2 : 1;
        const numSlots = multiViewMode === 'quad' ? 4 : multiViewMode === 'dual' ? 2 : 1;

        if (key === 'ArrowDown' || code === 40) {
           e.preventDefault();
           if (!showControls && !isSlotFocused) {
             setShowControls(true);
             const firstCtrl = playerFocusables.find(el => el.getAttribute('data-tv-pane') === 'player-controls');
             firstCtrl?.focus();
             return;
           }
           
           if (isSlotFocused) {
             const nextSlotIdx = activeIdx + slotCols;
             if (nextSlotIdx < numSlots) {
               playerFocusables[nextSlotIdx]?.focus();
             } else {
               setShowControls(true);
               const firstCtrl = playerFocusables.find(el => el.getAttribute('data-tv-pane') === 'player-controls');
               firstCtrl?.focus();
             }
           } else {
             const next = Math.min(playerFocusables.length - 1, activeIdx + 1);
             playerFocusables[next]?.focus();
           }
        } else if (key === 'ArrowUp' || code === 38) {
           e.preventDefault();
           if (isSlotFocused) {
             const prevSlotIdx = activeIdx - slotCols;
             if (prevSlotIdx >= 0) {
               playerFocusables[prevSlotIdx]?.focus();
             } else if (!isFullscreen) {
               setTvFocusedPane('header');
               const headerTabs = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="header"]'));
               headerTabs[1]?.focus();
             }
           } else {
             const prevIdx = activeIdx - 1;
             if (prevIdx >= 0) {
               playerFocusables[prevIdx]?.focus();
             } else {
                // Focus last slot
                playerFocusables[numSlots - 1]?.focus();
             }
           }
        } else if (key === 'ArrowRight' || code === 39) {
           e.preventDefault();
           const step = isRtl ? -1 : 1;
           const next = Math.max(0, Math.min(playerFocusables.length - 1, activeIdx + step));
           playerFocusables[next]?.focus();
        } else if (key === 'ArrowLeft' || code === 37) {
           e.preventDefault();
           const step = isRtl ? 1 : -1;
           const next = Math.max(0, Math.min(playerFocusables.length - 1, activeIdx + step));
           playerFocusables[next]?.focus();
        } else if (key === 'Enter' || code === 13 || key === 'Select' || code === 23) {
           e.preventDefault();
           if (activeIdx !== -1) {
              if (isSlotFocused && multiViewMode === 'none') {
                toggleControlsVisibility();
              } else {
                playerFocusables[activeIdx].click();
              }
           } else {
             toggleControlsVisibility();
           }
        }
        return;
      }

      if (tvFocusedPane === 'header') {
        const headerTabs = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="header"]'));
        if (headerTabs.length > 0) {
          const currentActive = document.activeElement as HTMLElement;
          let cur = headerTabs.indexOf(currentActive);
          if (cur === -1) cur = 0;

          if (key === 'ArrowDown' || code === 40) {
            e.preventDefault();
            setTvFocusedPane('channels');
            const chItems = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="channels"]'));
            if (chItems.length > 0) {
              chItems[0].focus();
            } else {
              setTvFocusedPane('categories');
              const catButtons = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="categories"]'));
              catButtons[0]?.focus();
            }
          } else if (key === 'ArrowRight' || code === 39) {
            e.preventDefault();
            const next = isRtl ? Math.max(0, cur - 1) : Math.min(headerTabs.length - 1, cur + 1);
            headerTabs[next]?.focus();
          } else if (key === 'ArrowLeft' || code === 37) {
            e.preventDefault();
            const next = isRtl ? Math.min(headerTabs.length - 1, cur + 1) : Math.max(0, cur - 1);
            headerTabs[next]?.focus();
          } else if (key === 'Enter' || code === 13 || key === 'Select' || code === 23) {
            e.preventDefault();
            headerTabs[cur]?.click();
          }
        }
        return;
      }

      if (tvFocusedPane === 'categories') {
        const catButtons = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="categories"]'));
        if (catButtons.length === 0) return;

        let cur = tvFocusedCatIndex;
        if (cur < 0 || cur >= catButtons.length) cur = 0;

        if (key === 'ArrowDown' || code === 40) {
          e.preventDefault();
          const next = Math.min(catButtons.length - 1, cur + 1);
          setTvFocusedCatIndex(next);
          catButtons[next]?.focus();
          catButtons[next]?.click();
          catButtons[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (key === 'ArrowUp' || code === 38) {
          e.preventDefault();
          if (cur === 0) {
            setTvFocusedPane('header');
            const headerTabs = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="header"]'));
            const targetTabIdx = mediaType === 'movie' ? 2 : mediaType === 'series' ? 3 : 1;
            headerTabs[targetTabIdx]?.focus();
          } else {
            const next = cur - 1;
            setTvFocusedCatIndex(next);
            catButtons[next]?.focus();
            catButtons[next]?.click();
            catButtons[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        } else if ((key === 'ArrowRight' && !isRtl) || (key === 'ArrowLeft' && isRtl) || key === 'Enter' || code === 13 || key === 'Select' || code === 23) {
          e.preventDefault();
          setTvFocusedPane('channels');
          setTvFocusedChannelIndex(0);
          setTimeout(() => {
            const chItems = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="channels"]'));
            chItems[0]?.focus();
            chItems[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }, 50);
        }
      } else if (tvFocusedPane === 'channels') {
        const chItems = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="channels"]'));
        if (chItems.length === 0) {
          setTvFocusedPane('categories');
          return;
        }

        let cur = tvFocusedChannelIndex;
        if (cur < 0 || cur >= chItems.length) cur = 0;

        const isGrid = mediaType === 'movie' || mediaType === 'series';
        const cols = isGrid ? (window.innerWidth < 640 ? 4 : window.innerWidth < 1200 ? 5 : 6) : 1;

        if (key === 'ArrowDown' || code === 40) {
          e.preventDefault();
          const next = Math.min(chItems.length - 1, cur + cols);
          setTvFocusedChannelIndex(next);
          chItems[next]?.focus();
          chItems[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (key === 'ArrowUp' || code === 38) {
          e.preventDefault();
          if (cur < cols) {
            setTvFocusedPane('header');
            const headerTabs = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="header"]'));
            const targetTabIdx = mediaType === 'movie' ? 2 : mediaType === 'series' ? 3 : 1;
            headerTabs[targetTabIdx]?.focus();
          } else {
            const next = cur - cols;
            setTvFocusedChannelIndex(next);
            chItems[next]?.focus();
            chItems[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        } else if (key === 'ArrowRight' || code === 39) {
          e.preventDefault();
          if (isRtl) {
            // In RTL, ArrowRight moves towards categories sidebar
            if (!isGrid || cur % cols === 0) {
              setTvFocusedPane('categories');
              const catButtons = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="categories"]'));
              catButtons[tvFocusedCatIndex]?.focus();
            } else {
              const next = Math.max(0, cur - 1);
              setTvFocusedChannelIndex(next);
              chItems[next]?.focus();
            }
          } else {
            // In LTR, ArrowRight moves towards Player
            if (!isGrid || (cur + 1) % cols === 0 || cur === chItems.length - 1) {
               setTvFocusedPane('player');
               const playerItems = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="player"]'));
               if (playerItems.length > 0) playerItems[0].focus();
            } else {
               const next = Math.min(chItems.length - 1, cur + 1);
               setTvFocusedChannelIndex(next);
               chItems[next]?.focus();
            }
          }
        } else if (key === 'ArrowLeft' || code === 37) {
          e.preventDefault();
          if (!isRtl) {
            // In LTR, ArrowLeft moves towards categories sidebar
            if (!isGrid || cur % cols === 0) {
              setTvFocusedPane('categories');
              const catButtons = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="categories"]'));
              catButtons[tvFocusedCatIndex]?.focus();
            } else {
              const next = Math.max(0, cur - 1);
              setTvFocusedChannelIndex(next);
              chItems[next]?.focus();
            }
          } else {
            // In RTL, ArrowLeft moves towards Player
            if (!isGrid || (cur + 1) % cols === 0 || cur === chItems.length - 1) {
               setTvFocusedPane('player');
               const playerItems = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pane="player"]'));
               if (playerItems.length > 0) playerItems[0].focus();
            } else {
               const next = Math.min(chItems.length - 1, cur + 1);
               setTvFocusedChannelIndex(next);
               chItems[next]?.focus();
            }
          }
        } else if (key === 'ArrowUp' && isGrid) {
           // handled
        } else if (key === 'Enter' || code === 13 || key === 'Select' || code === 23) {
          e.preventDefault();
          chItems[cur]?.click();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tvFocusedPane, tvFocusedCatIndex, tvFocusedChannelIndex, isRtl, mediaType, onBack, showPinModal, showEpgGrid, showEpgTimeline, showAudioMenu, showSubMenu, showQualityMenu, reorderTarget, activeVodPlayer, movieDetailsModal, isFullscreen, multiViewMode, showControls]);

  useEffect(() => {
    return subscribeFavorites((next) => setFavorites(next));
  }, []);

  const toggleFavorite = (streamId: string) => {
    const ch = channels.find(c => c.stream_id === streamId);
    toggleFavoriteService(userId, streamId, ch ? {
      name: ch.name,
      logo: ch.stream_icon,
      url: ch.url,
      category: ch.category_name,
      category_id: ch.category_id,
      type: mediaType === 'live' ? 'live' : mediaType === 'movie' ? 'movie' : 'series'
    } : undefined);
  };

  const moveChannel = (streamId: string, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    setChannels(prev => {
      const filteredIdx = filteredChannels.findIndex(c => c.stream_id === streamId);
      if (filteredIdx === -1) return prev;
      const targetFilteredIdx = direction === 'up' ? filteredIdx - 1 : filteredIdx + 1;
      if (targetFilteredIdx < 0 || targetFilteredIdx >= filteredChannels.length) return prev;

      const targetStreamId = filteredChannels[targetFilteredIdx].stream_id;
      const idx1 = prev.findIndex(c => c.stream_id === streamId);
      const idx2 = prev.findIndex(c => c.stream_id === targetStreamId);
      if (idx1 === -1 || idx2 === -1) return prev;

      const copy = [...prev];
      const temp = copy[idx1];
      copy[idx1] = copy[idx2];
      copy[idx2] = temp;
      return copy;
    });
  };

  const moveItemToPosition = (type: 'category' | 'channel', id: string, toPosNum: number) => {
    if (type === 'category') {
      setCategories(prev => {
        const fromIdx = prev.findIndex(c => c.category_id === id);
        if (fromIdx === -1) return prev;
        const toIdx = Math.max(0, Math.min(prev.length - 1, toPosNum - 1));
        const copy = [...prev];
        const [item] = copy.splice(fromIdx, 1);
        copy.splice(toIdx, 0, item);
        const newOrderIds = copy.map(c => c.category_id);
        onUpdateSettings(st => ({
          ...st,
          categoryOrders: { ...(st.categoryOrders || {}), [mediaType]: newOrderIds }
        }));
        return copy;
      });
    } else {
      setChannels(prev => {
        const fromIdx = prev.findIndex(c => c.stream_id === id);
        if (fromIdx === -1) return prev;
        const toIdx = Math.max(0, Math.min(prev.length - 1, toPosNum - 1));
        const copy = [...prev];
        const [item] = copy.splice(fromIdx, 1);
        copy.splice(toIdx, 0, item);
        
        // PERSIST ORDER
        const newOrderIds = copy.map(c => c.stream_id);
        onUpdateSettings(st => ({
          ...st,
          channelOrders: { ...(st.channelOrders || {}), [mediaType]: newOrderIds }
        }));
        
        return copy;
      });
    }
    setReorderTarget(null);
  };

  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const playerVideoElements = useRef<(HTMLVideoElement | null)[]>([null, null, null, null]);
  const hlsInstances = useRef<(Hls | null)[]>([null, null, null, null]);

  const handleRegisterVideo = useCallback((slotIdx: number, vid: HTMLVideoElement | null) => {
    playerVideoElements.current[slotIdx] = vid;
  }, []);

  const handleRegisterHls = useCallback((slotIdx: number, hls: Hls | null) => {
    hlsInstances.current[slotIdx] = hls;
  }, []);

  const handleTracksUpdate = useCallback((slotIdx: number, tracks: any) => {
    if (slotIdx === activeSlot) {
      setActiveTracksData(tracks);
    }
  }, [activeSlot]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const sortCategoriesBySavedOrder = (incomingCats: ParsedCategory[]): ParsedCategory[] => {
    const savedOrder = settings.categoryOrders?.[mediaType];
    if (!savedOrder || !Array.isArray(savedOrder) || savedOrder.length === 0) {
      return incomingCats;
    }
    const orderMap = new Map<string, number>();
    savedOrder.forEach((id, idx) => orderMap.set(id, idx));
    return [...incomingCats].sort((a, b) => {
      const idxA = orderMap.has(a.category_id) ? (orderMap.get(a.category_id) as number) : 99999;
      const idxB = orderMap.has(b.category_id) ? (orderMap.get(b.category_id) as number) : 99999;
      return idxA - idxB;
    });
  };

  const sortChannelsBySavedOrder = useCallback((incomingChs: ParsedChannel[]): ParsedChannel[] => {
    const savedOrder = settings.channelOrders?.[mediaType];
    if (!savedOrder || !Array.isArray(savedOrder) || savedOrder.length === 0) {
      return incomingChs;
    }
    const orderMap = new Map<string, number>();
    savedOrder.forEach((id, idx) => orderMap.set(id, idx));
    return [...incomingChs].sort((a, b) => {
      const idxA = orderMap.has(a.stream_id) ? (orderMap.get(a.stream_id) as number) : 999999;
      const idxB = orderMap.has(b.stream_id) ? (orderMap.get(b.stream_id) as number) : 999999;
      if (idxA === idxB) return 0;
      return idxA - idxB;
    });
  }, [settings.channelOrders, mediaType]);

  const fetchActivePlaylist = async (): Promise<Playlist | null> => {
    try {
      const rawLocal = localStorage.getItem('achour_local_playlists');
      const localList: Playlist[] = rawLocal ? JSON.parse(rawLocal) : [];

      // 1. If explicit active playlist selected
      if (settings.activePlaylistId) {
        const localFound = localList.find(p => p.id === settings.activePlaylistId);
        if (localFound) {
          setActivePlaylist(localFound);
          if (localFound.isProtected && localFound.pin && !isUnlocked) setShowPinModal(true);
          return localFound;
        }
        try {
          const docRef = doc(db, 'playlists', settings.activePlaylistId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = { id: docSnap.id, ...docSnap.data() } as Playlist;
            setActivePlaylist(data);
            if (data.isProtected && data.pin && !isUnlocked) setShowPinModal(true);
            return data;
          }
        } catch (e) {}
      }

      // 2. Prioritize first available playlist
      if (localList.length > 0) {
        const first = localList[0];
        setActivePlaylist(first);
        if (settings.activePlaylistId !== first.id) {
          onUpdateSettings(prev => ({ ...prev, activePlaylistId: first.id }));
        }
        if (first.isProtected && first.pin && !isUnlocked) setShowPinModal(true);
        return first;
      }

      // 3. Check Firestore for user's playlists
      try {
        const q = query(collection(db, 'playlists'), where('userId', '==', userId));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const first = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Playlist;
          setActivePlaylist(first);
          if (settings.activePlaylistId !== first.id) {
            onUpdateSettings(prev => ({ ...prev, activePlaylistId: first.id }));
          }
          if (first.isProtected && first.pin && !isUnlocked) setShowPinModal(true);
          return first;
        }
      } catch (e) {}

      // 4. Fallback to first available in local storage
      if (localList.length > 0) {
        const first = localList[0];
        setActivePlaylist(first);
        if (first.isProtected && first.pin && !isUnlocked) setShowPinModal(true);
        return first;
      }
    } catch (err) {}
    return null;
  };

  const parseM3U = (rawContent: string, baseUrl?: string): ParsedChannel[] => {
    if (!rawContent) return [];
    let content = rawContent.replace(/^\uFEFF/, '').trim();
    if (!content) return [];

    // Reject HTML content (e.g. when fetching a GitHub web page instead of raw M3U)
    if (content.startsWith('<!DOCTYPE') || content.startsWith('<html') || content.startsWith('<div')) {
      console.warn('Received HTML response instead of valid M3U text file');
      return [];
    }

    if (content.startsWith('{') || content.startsWith('[')) {
      try {
        const json = JSON.parse(content);
        let list = Array.isArray(json) ? json : (json.available_channels || json.channels || json.streams || json.live_streams || json.vod_streams || json.series || json.vod_data || json.data || []);
        if ((!Array.isArray(list) || list.length === 0) && typeof json === 'object' && json !== null) {
          const vals = Object.values(json);
          if (vals.length > 0 && typeof vals[0] === 'object' && vals[0] !== null) {
            list = vals;
          }
        }
        if (Array.isArray(list) && list.length > 0) {
          return list.slice(0, 5000).map((ch: any, idx: number) => ({
            stream_id: String(ch.stream_id || ch.id || `${Date.now()}-${idx}`),
            name: String(ch.name || ch.title || `Channel ${idx + 1}`),
            stream_icon: ch.stream_icon || ch.logo || ch.cover || undefined,
            url: ch.url || (ch.stream_id ? `${baseUrl || ''}/live/${ch.stream_id}.ts` : ''),
            category_id: String(ch.category_id || ch.group || 'عام (General)'),
            category_name: String(ch.category_name || ch.group || 'عام (General)'),
          }));
        }
      } catch (e) {}
    }

    const lines = content.split(/\r?\n/);
    const result: ParsedChannel[] = [];
    let curName = '';
    let curLogo = '';
    let curGroup = 'عام (General)';
    let curId = '';

    for (let i = 0; i < lines.length; i++) {
      if (result.length >= 5000) break; // Safe cap to prevent memory crashes on 40,000+ channel playlists
      let line = lines[i].trim();
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

        curName = extractedName;
        curLogo = logoMatch ? logoMatch[1].trim() : '';
        curGroup = groupMatch ? groupMatch[1].trim() : 'عام (General)';
        curId = idMatch ? idMatch[1].trim() : '';
      } else if (line.startsWith('#EXTGRP:')) {
        curGroup = line.replace('#EXTGRP:', '').trim();
      } else if (!line.startsWith('#')) {
        let streamUrl = line.replace(/&amp;/g, '&');
        // Filter out non-media assets
        if (streamUrl.endsWith('.js') || streamUrl.endsWith('.css') || streamUrl.includes('githubassets.com')) {
          continue;
        }
        if (!streamUrl.startsWith('http://') && !streamUrl.startsWith('https://')) {
          if (baseUrl) {
            try {
              const base = new URL(baseUrl);
              streamUrl = new URL(streamUrl, base.origin).toString();
            } catch (e) {}
          }
        }

        // Generate safe stable ID if missing, avoiding unescape/btoa crashes
        const finalId = curId || ('ch_' + Math.abs((curName + streamUrl).split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)).toString(36) + '_' + result.length);

        result.push({
          stream_id: finalId,
          name: curName || `Channel ${result.length + 1}`,
          stream_icon: curLogo || undefined,
          url: streamUrl,
          category_id: curGroup || 'عام (General)',
          category_name: curGroup || 'عام (General)'
        });
        curName = '';
        curLogo = '';
        curGroup = 'عام (General)';
        curId = '';
      }
    }
    return result;
  };

  // We use the global cache from iptv.ts now to persist across Live/Movies/Series
  const isFetchingRef = useRef(false);
  const lastFetchKeyRef = useRef<string>('');
  const handleSwitchMediaType = (newType: 'live' | 'movie' | 'series') => {
    setMediaType(newType);
    setSelectedChannel(null);
    setSearch('');
    const cachedData = getCachedIPTVData(newType, userId, settings.activePlaylistId);
    if (cachedData && cachedData.channels.length > 0) {
      setCategories(cachedData.categories);
      setChannels(cachedData.channels);
      setSelectedCategory(cachedData.categories.length > 0 ? cachedData.categories[0].category_id : '');
      setLoading(false);
    } else {
      setSelectedCategory('');
    }
  };

  const fetchIPTVData = async (forceRefresh = false) => {
    const fetchKey = `${userId}_${mediaType}_${settings.activePlaylistId || 'default'}`;
    const cached = getCachedIPTVData(mediaType, userId, settings.activePlaylistId);

    // If preloaded or cached data exists, load it immediately with 0 seconds delay and NO reload!
    if (!forceRefresh && cached && cached.channels.length > 0) {
      setCategories(cached.categories);
      setChannels(cached.channels);
      if (cached.categories.length > 0 && !selectedCategory) {
        setSelectedCategory(cached.categories[0].category_id);
      }
      setLoading(false);
      isFetchingRef.current = false;
      return;
    }
    if (!forceRefresh && isFetchingRef.current && lastFetchKeyRef.current === fetchKey) {
      return;
    }

    isFetchingRef.current = true;
    lastFetchKeyRef.current = fetchKey;
    setLoading(true);
    setStreamError(null);

    const playlist = await fetchActivePlaylist();
    if (!playlist) {
      if (mediaType === 'movie') {
        setChannels([]);
        setCategories([]);
      } else if (mediaType === 'series') {
        setChannels([]);
        setCategories([]);
      }
      setLoading(false);
      isFetchingRef.current = false;
      return;
    }

    try {
      let rawParsedChannels: ParsedChannel[] = [];
      let loadedFromXtream = false;
      let xtreamHost = playlist.url || '';
      let xtreamUser = playlist.username || '';
      let xtreamPass = playlist.password || '';

      if (playlist.url) {
        try {
          const parsedUrl = new URL(playlist.url.startsWith('http') ? playlist.url : 'http://' + playlist.url);
          const u = parsedUrl.searchParams.get('username');
          const p = parsedUrl.searchParams.get('password');
          if (u && p) {
            xtreamUser = xtreamUser || u;
            xtreamPass = xtreamPass || p;
            xtreamHost = parsedUrl.origin;
          }
        } catch (e) {}
      }

      if (playlist.type === 'm3u' || (!playlist.username && playlist.url)) {
        let content = playlist.m3uContent || '';

        // Handle uploaded local files (local_file://...) or direct m3uContent
        if (!content && playlist.url && playlist.url.startsWith('local_file://')) {
          const fileName = playlist.url.replace('local_file://', '');
          content = localStorage.getItem('achour_m3u_file_' + fileName)
            || localStorage.getItem('achour_m3u_file_' + decodeURIComponent(fileName))
            || localStorage.getItem('achour_m3u_file_' + encodeURIComponent(fileName))
            || localStorage.getItem('achour_m3u_file_' + playlist.name)
            || localStorage.getItem('achour_m3u_file_' + playlist.id)
            || (fileName.includes('trial') ? localStorage.getItem('achour_m3u_file_trial') : null)
            || '';
        } else if (!content && playlist.url) {
          try {
            let targetUrl = playlist.url.trim();
            if (targetUrl.includes('github.com/') && targetUrl.includes('/blob/')) {
              targetUrl = targetUrl.replace('github.com/', 'raw.githubusercontent.com/').replace('/blob/', '/');
            }
            const fetchUrl = getPlatformUrl('m3u', targetUrl);
            const res = await axios.get(fetchUrl);
            content = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          } catch (err) {
            try {
              let targetUrl = playlist.url.trim();
              if (targetUrl.includes('github.com/') && targetUrl.includes('/blob/')) {
                targetUrl = targetUrl.replace('github.com/', 'raw.githubusercontent.com/').replace('/blob/', '/');
              }
              const fetchUrl2 = getPlatformUrl('get', targetUrl);
              const res = await axios.get(fetchUrl2);
              content = typeof res.data === 'string' ? res.data : '';
            } catch (e) {}
          }
        }

        if (content) {
          rawParsedChannels = parseM3U(content, playlist.url);
        }

        // Direct single stream fallback
        if (rawParsedChannels.length === 0 && playlist.url && !playlist.url.startsWith('local_file://') && (playlist.url.includes('.m3u') || playlist.url.includes('.ts') || playlist.url.includes('.mp4'))) {
          rawParsedChannels = [{
            stream_id: 'ch_direct_single',
            name: playlist.name || 'بث مباشر (Direct Stream)',
            url: playlist.url,
            category_id: 'عام (General)',
            category_name: 'عام (General)'
          }];
        }

        if (rawParsedChannels.length === 0 && xtreamUser && xtreamPass && xtreamHost) {
          playlist.type = 'xtream';
          playlist.username = xtreamUser;
          playlist.password = xtreamPass;
          playlist.url = xtreamHost;
        }
      }

      if (playlist.type === 'xtream' || (rawParsedChannels.length === 0 && xtreamUser && xtreamPass)) {
        const host = (playlist.url || xtreamHost).trim().replace(/\/+$/, '').replace(/\/(player_api|get|index)\.php.*$/i, '').replace(/\/c\/?$/i, '').replace(/\?.*$/, '');
        const user = playlist.username || xtreamUser;
        const pass = playlist.password || xtreamPass;

        if (host && user && pass) {
          let catAction = 'get_live_categories';
          let streamAction = 'get_live_streams';
          if (mediaType === 'movie') {
            catAction = 'get_vod_categories';
            streamAction = 'get_vod_streams';
          }
          if (mediaType === 'series') {
            catAction = 'get_series_categories';
            streamAction = 'get_series';
          }

          try {
            // 1. Initial Handshake to get server_info for correct streaming host/port
            const loginRes = await xtreamFetch(host, user, pass, 'auth');
            let actualStreamingHost = host;
            if (loginRes.ok && loginRes.data?.server_info) {
              const sInfo = loginRes.data.server_info;
              if (sInfo.url && sInfo.port) {
                const proto = sInfo.server_protocol || 'http';
                actualStreamingHost = `${proto}://${sInfo.url}:${sInfo.port}`;
              }
            }
            setStreamingHost(actualStreamingHost);

            // 2. Fetch categories AND streams
            let [catRes, streamRes] = await Promise.all([
              xtreamFetch(host, user, pass, catAction),
              xtreamFetch(host, user, pass, streamAction)
            ]);

            let fetchedCats: ParsedCategory[] = [];
            if (catRes.ok && catRes.rawList.length > 0) {
              fetchedCats = catRes.rawList.map((c: any) => ({
                category_id: String(c.category_id || c.id),
                category_name: String(c.category_name || c.name)
              }));
            }

            let mappedStreams: ParsedChannel[] = [];

            if (streamRes.ok && streamRes.rawList.length > 0) {
              mappedStreams = streamRes.rawList.map((ch: any, idx: number) => {
                const rawStreamId = String(ch.stream_id || ch.series_id || ch.id || idx);
                const cleanStreamId = rawStreamId.replace(/\.(m3u8|ts|mp4|mkv|avi|flv)$/i, '');
                const ext = ch.container_extension || (mediaType === 'live' ? 'm3u8' : 'mp4');
                let directUrl = ch.stream_url || ch.direct_source || ch.url || '';
                if (!directUrl) {
                  if (mediaType === 'live') directUrl = `${actualStreamingHost}/live/${user}/${pass}/${cleanStreamId}.${ext}`;
                  else if (mediaType === 'movie') directUrl = `${actualStreamingHost}/movie/${user}/${pass}/${cleanStreamId}.${ext}`;
                  else directUrl = `${actualStreamingHost}/series/${user}/${pass}/${cleanStreamId}.${ext}`;
                }

                const catIdStr = String(ch.category_id || '');
                const matchedCat = fetchedCats.find(c => String(c.category_id) === catIdStr);

                return {
                  stream_id: cleanStreamId,
                  name: String(ch.name || ch.title || 'Channel ' + (idx + 1)),
                  stream_icon: ch.stream_icon || ch.cover || ch.logo || undefined,
                  url: directUrl,
                  category_id: catIdStr || 'general',
                  category_name: ch.category_name || (matchedCat ? matchedCat.category_name : catIdStr) || 'عام (General)',
                  container_extension: ext
                };
              });
            } else if (fetchedCats.length > 0) {
              // Fallback: Bulk stream query empty or rate-limited. Fetch top categories in parallel!
              console.log('[Xtream] Bulk stream query returned empty/rate-limited. Querying top categories...');
              const topCats = fetchedCats.slice(0, 10);
              const catStreamResults = await Promise.all(
                topCats.map(cat => xtreamFetch(host, user, pass, streamAction, { category_id: cat.category_id }))
              );
              catStreamResults.forEach((cRes, cIdx) => {
                if (cRes.ok && cRes.rawList.length > 0) {
                  const catObj = topCats[cIdx];
                  const batchMapped = cRes.rawList.map((ch: any, idx: number) => {
                    const rawStreamId = String(ch.stream_id || ch.series_id || ch.id || `${catObj.category_id}-${idx}`);
                    const cleanStreamId = rawStreamId.replace(/\.(m3u8|ts|mp4|mkv|avi|flv)$/i, '');
                    const ext = ch.container_extension || (mediaType === 'live' ? 'm3u8' : 'mp4');
                    let directUrl = ch.stream_url || ch.direct_source || ch.url || '';
                    if (!directUrl) {
                      if (mediaType === 'live') directUrl = `${actualStreamingHost}/live/${user}/${pass}/${cleanStreamId}.${ext}`;
                      else if (mediaType === 'movie') directUrl = `${actualStreamingHost}/movie/${user}/${pass}/${cleanStreamId}.${ext}`;
                      else directUrl = `${actualStreamingHost}/series/${user}/${pass}/${cleanStreamId}.${ext}`;
                    }
                    return {
                      stream_id: cleanStreamId,
                      name: String(ch.name || ch.title || 'Channel ' + (idx + 1)),
                      stream_icon: ch.stream_icon || ch.cover || ch.logo || undefined,
                      url: directUrl,
                      category_id: catObj.category_id,
                      category_name: catObj.category_name,
                      container_extension: ext
                    };
                  });
                  mappedStreams.push(...batchMapped);
                }
              });
            }

            if (mappedStreams.length > 0 || fetchedCats.length > 0) {
              if (fetchedCats.length === 0) {
                const groupMap: Record<string, { id: string; count: number }> = {};
                mappedStreams.forEach(c => {
                  const name = c.category_name || c.category_id || 'عام (General)';
                  const id = c.category_id || name;
                  if (!groupMap[name]) groupMap[name] = { id, count: 0 };
                  groupMap[name].count += 1;
                });
                fetchedCats = Object.keys(groupMap).map(name => ({
                  category_id: groupMap[name].id,
                  category_name: name,
                  count: groupMap[name].count
                }));
              }

              const finalCats: ParsedCategory[] = sortCategoriesBySavedOrder(fetchedCats);
              const finalChs = mappedStreams.length > 0 ? sortChannelsBySavedOrder(mappedStreams) : [];

              setCategories(finalCats);
              setChannels(finalChs);
              iptvGlobalCache.set(fetchKey, { categories: finalCats, channels: finalChs });

              if (finalCats.length > 0) {
                setSelectedCategory(finalCats[0].category_id);
              } else {
                setSelectedCategory('');
              }
              loadedFromXtream = true;
            } else {
              if (!loginRes.ok || loginRes.data?.user_info?.auth === 0) {
                setStreamError(isRtl ? 'خطأ في تسجيل الدخول: بيانات الحساب غير صحيحة أو الاشتراك منتهي.' : 'Authentication error: Invalid credentials or expired subscription.');
              } else if (streamRes.error) {
                setStreamError(streamRes.error);
              } else {
                setStreamError(isRtl ? 'لم يتم العثور على قنوات أو محتوى في هذا السيرفر.' : 'No channels or content found on this server.');
              }
            }
          } catch (e: any) {
            console.error('Xtream fetch failed', e);
            setStreamError(isRtl ? `فشل الاتصال بسيرفر Xtream: ${e?.message || 'تعذر الاتصال'}` : `Xtream connection failed: ${e?.message || 'Network error'}`);
          }
        }
      }

      if (loadedFromXtream) {
        isFetchingRef.current = false;
        return;
      }

      if (rawParsedChannels.length === 0) {
        setStreamError(isRtl ? 'لم يتم العثور على قنوات في هذا الرابط.' : 'No channels found.');
        isFetchingRef.current = false;
        return;
      }

      let displayChannels: ParsedChannel[] = [];
      if (mediaType === 'movie') {
        displayChannels = rawParsedChannels.filter(c => isMovieItem(c.name, (c.category_name || '') + ' ' + (c.category_id || ''), c.url));
        if (displayChannels.length === 0 && rawParsedChannels.length > 0) {
          displayChannels = rawParsedChannels.filter(c => c.url.match(/\.(mp4|mkv|avi|mov|webm|m4v)$/i));
          if (displayChannels.length === 0) displayChannels = rawParsedChannels;
        }
        if (displayChannels.length === 0) {
          displayChannels = [];
        }
      } else if (mediaType === 'series') {
        displayChannels = rawParsedChannels.filter(c => isSeriesItem(c.name, (c.category_name || '') + ' ' + (c.category_id || ''), c.url));
        if (displayChannels.length === 0 && rawParsedChannels.length > 0) {
          displayChannels = rawParsedChannels.filter(c => c.url.match(/\.(mp4|mkv|avi|mov|webm|m4v)$/i) || c.name.toLowerCase().includes('s0') || c.name.toLowerCase().includes('ep'));
          if (displayChannels.length === 0) displayChannels = rawParsedChannels;
        }
        if (displayChannels.length === 0) {
          displayChannels = [];
        }
      } else if (mediaType === 'favorites') {
        displayChannels = rawParsedChannels.filter(c => favorites.includes(c.stream_id));
      } else {
        displayChannels = rawParsedChannels.filter(c => !isMovieItem(c.name, (c.category_name || '') + ' ' + (c.category_id || ''), c.url) && !isSeriesItem(c.name, (c.category_name || '') + ' ' + (c.category_id || ''), c.url));
        if (displayChannels.length === 0) {
          displayChannels = rawParsedChannels.length > 0 ? rawParsedChannels : [];
        }
      }

      const finalChs = sortChannelsBySavedOrder(displayChannels);

      const groupMap: Record<string, number> = {};
      displayChannels.forEach(c => {
        const g = c.category_name || c.category_id || 'عام (General)';
        groupMap[g] = (groupMap[g] || 0) + 1;
      });

      const cats: ParsedCategory[] = Object.keys(groupMap).map(g => ({
        category_id: g,
        category_name: g,
        count: groupMap[g]
      }));

      const sortedCats = sortCategoriesBySavedOrder(cats);
      setChannels(finalChs);
      setCategories(sortedCats);
      iptvGlobalCache.set(fetchKey, { categories: sortedCats, channels: finalChs });

      if (sortedCats.length > 0) {
        setSelectedCategory(sortedCats[0].category_id);
      } else {
        setSelectedCategory('');
      }

    } catch (err) {
      console.error('Error in fetchIPTVData:', err);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  const fetchXtreamStreams = async (catId: string, p: Playlist, actionName?: string, sHost?: string, passedCats?: ParsedCategory[]) => {
    if (catId === 'ALL_CATEGORIES' || !catId || catId === 'FAVORITES_INTERNAL') return;
    if (catId === 'أفلام تجريبية (Test Movies)' || catId === 'مسلسلات تجريبية (Test Series)') return;

    let action = actionName || 'get_live_streams';
    if (!actionName) {
      if (mediaType === 'movie') action = 'get_vod_streams';
      if (mediaType === 'series') action = 'get_series';
    }

    try {
      const host = (p.url || '').trim().replace(/\/+$/, '').replace(/\/(player_api|get|index)\.php.*$/i, '').replace(/\/c\/?$/i, '').replace(/\?.*$/, '');
      const extraParams: any = {};
      if (catId && catId !== 'All' && catId !== 'all' && catId !== 'ALL_CATEGORIES') extraParams.category_id = catId;

      let res = await xtreamFetch(host, p.username || '', p.password || '', action, extraParams);
      
      // Fallback: If category_id query returned 0 items, try full list
      if ((!res.ok || res.rawList.length === 0) && extraParams.category_id) {
        const fullRes = await xtreamFetch(host, p.username || '', p.password || '', action);
        if (fullRes.ok && fullRes.rawList.length > 0) {
          res = fullRes;
        }
      }

      if (res.ok && res.rawList.length > 0) {
        const baseStreamUrl = sHost || streamingHost || host;
        let rawList = res.rawList;

        if (catId && catId !== 'All' && catId !== 'all' && catId !== 'ALL_CATEGORIES') {
          const filtered = rawList.filter((ch: any) => String(ch.category_id) === String(catId));
          if (filtered.length > 0) rawList = filtered;
        }

        const catsToUse = (passedCats && passedCats.length > 0) ? passedCats : categories;

        const mapped: ParsedChannel[] = rawList.map((ch: any, idx: number) => {
          const rawStreamId = String(ch.stream_id || ch.series_id || ch.id || `${catId}-${idx}`);
          const cleanStreamId = rawStreamId.replace(/\.(m3u8|ts|mp4|mkv|avi|flv)$/i, '');
          const ext = ch.container_extension || (mediaType === 'live' ? 'm3u8' : 'mp4');
          
          let directUrl = ch.stream_url || ch.direct_source || ch.url || '';
          if (!directUrl) {
            if (mediaType === 'live') directUrl = `${baseStreamUrl}/live/${p.username}/${p.password}/${cleanStreamId}.${ext}`;
            else if (mediaType === 'movie') directUrl = `${baseStreamUrl}/movie/${p.username}/${p.password}/${cleanStreamId}.${ext}`;
            else directUrl = `${baseStreamUrl}/series/${p.username}/${p.password}/${cleanStreamId}.${ext}`;
          }

          const rawCatId = String(ch.category_id || catId || 'general');
          const matchedCat = catsToUse.find(c => String(c.category_id) === rawCatId);
          const resolvedCatName = String(ch.category_name || (matchedCat ? matchedCat.category_name : '') || rawCatId || 'عام (General)');

          return {
            stream_id: cleanStreamId,
            name: String(ch.name || ch.title || 'Channel ' + (idx + 1)),
            stream_icon: ch.stream_icon || ch.cover || ch.logo || undefined,
            url: directUrl,
            category_id: rawCatId,
            category_name: resolvedCatName,
            container_extension: ext
          };
        });

        setChannels(prev => {
          const existingIds = new Set(prev.map(c => c.stream_id));
          const newStreams = mapped.filter(c => !existingIds.has(c.stream_id));
          return sortChannelsBySavedOrder([...prev, ...newStreams]);
        });
      }
    } catch (err) {}
  };

  const fetchStalkerStreams = async (catId: string, p: Playlist) => {
    try {
      const fetchUrl = getPlatformUrl('stalker', p.url || p.portal || '', {
        action: 'get_ordered_list',
        type: 'itv',
        category: catId,
        mac: p.macAddress || ''
      });
      const chRes = await axios.get(fetchUrl);
      const rawData = chRes.data?.js?.data || chRes.data?.js || chRes.data?.data;
      if (Array.isArray(rawData)) {
        const cleanHost = (p.url || p.portal || '').replace(/\/+$/, '');
        const mapped: ParsedChannel[] = rawData.map((ch: any, idx: number) => ({
          stream_id: String(ch.id || ch.cmd || idx),
          name: String(ch.name || 'Channel ' + (idx + 1)),
          stream_icon: ch.logo,
          url: ch.cmd || `${cleanHost}/play/${ch.id}`,
          category_id: catId
        }));
        setChannels(prev => {
          const existingIds = new Set(prev.map(c => c.stream_id));
          const newStreams = mapped.filter(c => !existingIds.has(c.stream_id));
          return sortChannelsBySavedOrder([...prev, ...newStreams]);
        });
      }
    } catch (err) {}
  };

  useEffect(() => {
    fetchIPTVData();
  }, [userId, mediaType, settings.activePlaylistId]);

  useEffect(() => {
    const update = async () => {
      if (!selectedCategory || !activePlaylist) return;
      if (selectedCategory === 'ALL_CATEGORIES' || selectedCategory === 'All' || selectedCategory === 'all' || selectedCategory === 'FAVORITES_INTERNAL') return;
      
      // If content is already preloaded in memory, cancel secondary reloading completely!
      const cachedData = getCachedIPTVData(mediaType, userId, settings.activePlaylistId);
      if (cachedData && cachedData.channels.length > 0) return;

      // Check if channels for this selected category are already loaded
      const alreadyHasCat = channels.some(c => String(c.category_id) === String(selectedCategory));
      if (alreadyHasCat) return;

      if (activePlaylist.type === 'xtream') {
        await fetchXtreamStreams(selectedCategory, activePlaylist);
      } else if (activePlaylist.type === 'stalker') {
        await fetchStalkerStreams(selectedCategory, activePlaylist);
      }
    };
    update();
  }, [selectedCategory, activePlaylist, channels, mediaType, userId, settings.activePlaylistId]);

  const getTargetVideoElement = (slotIdx: number = activeSlot): HTMLVideoElement | null => {
    return playerVideoElements.current[slotIdx] || null;
  };

  const hiddenList = useMemo(() => {
    if (mediaType === 'movie') return settings.hiddenMovieCategories || settings.hiddenCategories || [];
    if (mediaType === 'series') return settings.hiddenSeriesCategories || settings.hiddenCategories || [];
    return settings.hiddenLiveCategories || settings.hiddenCategories || [];
  }, [mediaType, settings.hiddenLiveCategories, settings.hiddenMovieCategories, settings.hiddenSeriesCategories, settings.hiddenCategories]);

  const visibleCategories = useMemo(() => {
    let base = categories.filter(cat => 
      !hiddenList.includes(cat.category_id) && !hiddenList.includes(cat.category_name)
    );

    if (settings.kidsModeActive) {
      const kidsKeywords = ['kids', 'animation', 'cartoon', 'disney', 'أطفال', 'اطفال', 'كرتون', 'سبيستون', 'براعم', 'anime', 'انمي'];
      base = base.filter(cat => {
        const name = (cat.category_name || '').toLowerCase();
        return kidsKeywords.some(key => name.includes(key));
      });
    }

    if (favorites.length > 0) {
      const favsCount = channels.filter(ch => favorites.includes(ch.stream_id)).length;
      if (favsCount > 0) {
        return [{
          category_id: 'FAVORITES_INTERNAL',
          category_name: isRtl ? 'المفضلة ★' : 'Favorites ★',
          count: favsCount
        }, ...base];
      }
    }
    return base;
  }, [categories, hiddenList, favorites, channels, isRtl, settings.kidsModeActive]);

  const filteredChannels = useMemo(() => {
    let result = channels.filter(ch => {
      if (selectedCategory === 'FAVORITES_INTERNAL') return favorites.includes(ch.stream_id);
      if (mediaType === 'favorites') return favorites.includes(ch.stream_id);
      const name = (ch.name || '').toLowerCase();
      const matchesSearch = name.includes(search.toLowerCase());
      const matchesCategory = !selectedCategory || selectedCategory === 'ALL_CATEGORIES' || selectedCategory === 'All' || selectedCategory === 'all' || selectedCategory === ''
        ? true 
        : String(ch.category_id) === String(selectedCategory) || String(ch.category_name) === String(selectedCategory);
      const isCatHidden = hiddenList.includes(ch.category_id) || hiddenList.includes(ch.category_name || '');
      return matchesSearch && matchesCategory && !isCatHidden;
    });

    if (result.length === 0 && !search && mediaType !== 'favorites' && selectedCategory !== 'FAVORITES_INTERNAL') {
      if (channels.length > 0) {
        // User's paid subscription has channels, show all of them if category filter returned empty
        result = [...channels];
      }
    }

    if (sortOrder === 'az') {
      result.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    } else {
      result = sortChannelsBySavedOrder(result);
    }
    return result;
  }, [channels, search, sortOrder, selectedCategory, hiddenList, favorites, mediaType, settings.channelOrders, sortChannelsBySavedOrder]);

  const switchChannelByOffset = useCallback((offset: number) => {
    if (filteredChannels.length === 0) return;
    const currentCh = multiChannels[activeSlot] || selectedChannel;
    const currentIndex = currentCh ? filteredChannels.findIndex(c => c.stream_id === currentCh.stream_id) : 0;
    const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeCurrentIndex + offset + filteredChannels.length) % filteredChannels.length;
    const nextCh = filteredChannels[nextIndex];
    if (!nextCh) return;

    if (multiViewMode === 'none') {
      setSelectedChannel(nextCh);
    } else {
      setMultiChannels(prev => {
        const next = [...prev];
        next[activeSlot] = nextCh;
        return next;
      });
      if (activeSlot === 0) setSelectedChannel(nextCh);
    }

    setZappingInfo({
      number: nextIndex + 1,
      name: nextCh.name,
      logo: nextCh.stream_icon,
      category: nextCh.category_name,
      direction: offset > 0 ? 'next' : 'prev'
    });
    triggerControlsVisibility();
  }, [filteredChannels, multiChannels, activeSlot, selectedChannel, multiViewMode, triggerControlsVisibility]);

  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartTime = useRef<number>(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    // Gestures disabled per user request
    triggerControlsVisibility();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    // Gestures disabled per user request
    touchStartY.current = null;
    touchStartX.current = null;
  };

  const handleSelectAudioTrack = (trackId: number, trackName: string) => {
    setSelectedAudioTrack(trackName);
    const hls = hlsInstances.current[activeSlot];
    if (hls && hls.audioTracks && hls.audioTracks.length > 0) hls.audioTrack = trackId;
    setActiveTracksData(prev => ({ ...prev, currentAudio: trackId }));
    setShowAudioMenu(false);
    triggerControlsVisibility();
  };

  const handleSelectSubtitleTrack = (trackId: number, trackName: string) => {
    setSelectedSubtitleTrack(trackName);
    const hls = hlsInstances.current[activeSlot];
    if (hls) hls.subtitleTrack = trackId;
    setSubtitleActive(trackId >= 0);
    setActiveTracksData(prev => ({ ...prev, currentSubtitle: trackId }));
    setShowSubMenu(false);
    triggerControlsVisibility();
  };

  const handleSelectQuality = (levelId: number, qualityLabel: string) => {
    setSelectedQuality(qualityLabel);
    const hls = hlsInstances.current[activeSlot];
    if (hls) hls.currentLevel = levelId;
    setActiveTracksData(prev => ({ ...prev, currentLevel: levelId }));
    setShowQualityMenu(false);
    triggerControlsVisibility();
  };

  const toggleFullscreen = useCallback(() => {
    const container = fullscreenContainerRef.current;
    const currentIsFs = isFullscreen;
    
    setShowControls(true);
    setIsFullscreen(!currentIsFs);

    // Force aspect ratio to 'fill' or '16:9' when going fullscreen if it was 'fit'
    if (!currentIsFs && aspectRatio === 'fit') {
      setAspectRatio('16:9');
    }

    if (container) {
      const requestFs = container.requestFullscreen || (container as any).webkitRequestFullscreen || (container as any).mozRequestFullScreen || (container as any).msRequestFullscreen;
      const isFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement || (document as any).msFullscreenElement);
      
      if (!isFs) {
        if (requestFs) {
          requestFs.call(container).catch(() => {
            // Native fallback for mobile webviews
            const vid = getTargetVideoElement(activeSlot);
            if (vid) {
              const vidRequestFs = vid.requestFullscreen || (vid as any).webkitRequestFullscreen;
              if (vidRequestFs) vidRequestFs.call(vid).catch(() => {});
            }
          });
        }
      } else {
        const exitFs = document.exitFullscreen || (document as any).webkitExitFullscreen || (document as any).mozCancelFullScreen || (document as any).msExitFullscreen;
        if (exitFs) {
          exitFs.call(document).catch(() => {});
        }
      }
    }
  }, [isFullscreen, aspectRatio, activeSlot]);

  const okPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      
      // Remote "OK" / Enter key
      if (key === 'enter' || key === 'ok' || key === 'select' || e.keyCode === 13 || e.keyCode === 23) {
        if (!okPressTimerRef.current) {
          const isChannelItem = document.activeElement?.getAttribute('data-tv-pane') === 'channels';
          okPressTimerRef.current = setTimeout(() => {
             if (isChannelItem) {
                const idx = parseInt(document.activeElement?.getAttribute('data-index') || '-1', 10);
                const ch = filteredChannels[idx];
                if (ch) {
                  setReorderTarget({
                    type: 'channel',
                    id: ch.stream_id,
                    index: idx,
                    name: ch.name
                  });
                  setTargetPosInput(String(idx + 1));
                }
             }
             okPressTimerRef.current = null;
          }, 800);
        }
        return;
      }

      if (key === 'escape' || key === 'back' || e.keyCode === 27 || e.keyCode === 4) {
        if (showAudioMenu || showSubMenu || showQualityMenu) {
          e.preventDefault();
          setShowAudioMenu(false);
          setShowSubMenu(false);
          setShowQualityMenu(false);
          return;
        }
        if (isFullscreen) {
          e.preventDefault();
          toggleFullscreen();
          return;
        }
      }

      if (key === 'r' || e.code === 'F1') {
        e.preventDefault();
        fetchIPTVData();
      } else if (key === 'g' || e.code === 'F2') {
        e.preventDefault();
        setShowRemoteHelp(prev => !prev);
      } else if (key === 'y' || e.code === 'F3') {
        e.preventDefault();
        const searchInput = document.getElementById('channel-search-input');
        if (searchInput) searchInput.focus();
      } else if (key === 'b' || e.code === 'F4') {
        e.preventDefault();
        if (selectedChannel) toggleFavorite(selectedChannel.stream_id);
      } else if (key === 'arrowup' || key === 'channelup' || key === 'pageup' || e.keyCode === 166 || e.keyCode === 33) {
        if (isFullscreen || (document.activeElement?.tagName !== 'BUTTON' && !document.activeElement?.closest('[data-tv-pane]'))) {
          e.preventDefault();
          switchChannelByOffset(-1);
        }
      } else if (key === 'arrowdown' || key === 'channeldown' || key === 'pagedown' || e.keyCode === 167 || e.keyCode === 34) {
        if (isFullscreen || (document.activeElement?.tagName !== 'BUTTON' && !document.activeElement?.closest('[data-tv-pane]'))) {
          e.preventDefault();
          switchChannelByOffset(1);
        }
      } else if (key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'enter' || key === 'ok' || key === 'select' || e.keyCode === 13 || e.keyCode === 23) {
        if (okPressTimerRef.current) {
          clearTimeout(okPressTimerRef.current);
          okPressTimerRef.current = null;
          // Short press detected
          e.preventDefault();
          toggleControlsVisibility();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [filteredChannels, selectedChannel, switchChannelByOffset, isRtl, toggleControlsVisibility, showAudioMenu, showSubMenu, showQualityMenu, isFullscreen, toggleFullscreen, fetchIPTVData]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const playArchive = (channel: any, program: any) => {
    if (!activePlaylist) return;
    const { url, username, password } = activePlaylist;
    let baseUrl = url || '';
    try {
        const urlObj = new URL(baseUrl);
        baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    } catch (e) {
        baseUrl = baseUrl.replace(/\/+$/, '');
    }

    const start = new Date(program.start);
    const stop = new Date(program.stop);
    const duration = Math.floor((stop.getTime() - start.getTime()) / (1000 * 60));
    
    // Format start time as YYYY-MM-DD:HH-mm
    const year = start.getFullYear();
    const month = String(start.getMonth() + 1).padStart(2, '0');
    const day = String(start.getDate()).padStart(2, '0');
    const hours = String(start.getHours()).padStart(2, '0');
    const minutes = String(start.getMinutes()).padStart(2, '0');
    const startTimeStr = `${year}-${month}-${day}:${hours}-${minutes}`;

    const archiveUrl = `${baseUrl}/timeshift/${username}/${password}/${duration}/${startTimeStr}/${channel.stream_id}.ts`;
    
    const archiveChannel = {
      ...channel,
      url: archiveUrl,
      name: `${channel.name} [Archive: ${program.title}]`,
      isArchive: true
    };
    
    setSelectedChannel(archiveChannel as any);
    setIsFullscreen(true);
    setShowEpgGrid(false);
    setShowEpgTimeline(false);
  };

  const fetchMediaDetails = async (id: string, type: 'movie' | 'series', p: Playlist) => {
    try {
      let baseUrl = p.url || '';
      try {
          const urlObj = new URL(baseUrl);
          baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      } catch (e) {
          baseUrl = baseUrl.replace(/\/+$/, '');
      }

      const action = type === 'movie' ? 'get_vod_info' : 'get_series_info';
      const fetchUrl = getPlatformUrl('xtream', baseUrl, {
        username: p.username || '',
        password: p.password || '',
        action: action,
        [type === 'movie' ? 'vod_id' : 'series_id']: id
      });
      const res = await axios.get(fetchUrl);
      return res.data;
    } catch (e) {
      return null;
    }
  };

  return (
    <div 
      className={`flex flex-col h-screen bg-transparent text-white overflow-hidden select-none ${isRtl ? 'font-cairo' : ''}`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-gold/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-gold/5 blur-[120px] rounded-full" />
      </div>

      {/* Header - Clean Tabs, Search, Clock */}
      <header className="relative z-30 h-16 flex items-center justify-between px-6 bg-black/50 backdrop-blur-md border-b border-white/5 shrink-0">
        <div className="flex items-center gap-1">
          <button 
            data-tv-focusable="true" 
            data-tv-pane="header" 
            data-header-index="0"
            tabIndex={0} 
            onClick={onBack} 
            className="px-3.5 py-1.5 text-xs sm:text-sm font-bold text-zinc-300 hover:text-white focus:text-gold focus:ring-2 focus:ring-gold focus:bg-gold/20 focus:scale-105 rounded-xl transition-all outline-none"
          >
            {isRtl ? 'الرئيسية' : 'Startseite'}
          </button>
          <div className="h-4 w-[1.5px] bg-white/20 mx-0.5" />
          <button 
            data-tv-focusable="true" 
            data-tv-pane="header" 
            data-header-index="1"
            tabIndex={0} 
            onClick={() => handleSwitchMediaType('live')} 
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold transition-all outline-none focus:ring-2 focus:ring-gold focus:scale-105 rounded-xl ${mediaType === 'live' ? 'text-gold font-black bg-gold/15 border border-gold/40' : 'text-zinc-300 hover:text-white focus:text-gold'}`}
          >
            {isRtl ? 'مباشر' : 'Live'}
          </button>
          <div className="h-4 w-[1.5px] bg-white/20 mx-0.5" />
          <button 
            data-tv-focusable="true" 
            data-tv-pane="header" 
            data-header-index="2"
            tabIndex={0} 
            onClick={() => handleSwitchMediaType('movie')} 
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold transition-all outline-none focus:ring-2 focus:ring-gold focus:scale-105 rounded-xl ${mediaType === 'movie' ? 'text-gold font-black bg-gold/15 border border-gold/40' : 'text-zinc-300 hover:text-white focus:text-gold'}`}
          >
            {isRtl ? 'أفلام' : 'Filme'}
          </button>
          <div className="h-4 w-[1.5px] bg-white/20 mx-0.5" />
          <button 
            data-tv-focusable="true" 
            data-tv-pane="header" 
            data-header-index="3"
            tabIndex={0} 
            onClick={() => handleSwitchMediaType('series')} 
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold transition-all outline-none focus:ring-2 focus:ring-gold focus:scale-105 rounded-xl ${mediaType === 'series' ? 'text-gold font-black bg-gold/15 border border-gold/40' : 'text-zinc-300 hover:text-white focus:text-gold'}`}
          >
            {isRtl ? 'مسلسلات' : 'Serie'}
          </button>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 w-[40%] max-w-lg">
          <div className="relative group flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className={`absolute ${isRtl ? 'right-4' : 'left-4'} top-1/2 -translate-y-1/2 text-gold/40 group-focus-within:text-gold transition-colors`} />
              <input 
                id="channel-search-input"
                type="text"
                placeholder={isRtl ? 'بحث باسم القناة أو الفيلم...' : 'Search for channel or movie...'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`w-full bg-black/60 border border-gold/20 rounded-full py-2.5 ${isRtl ? 'pr-12 pl-6' : 'pl-12 pr-6'} text-xs text-white placeholder-zinc-500 outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/20 transition-all`}
              />
            </div>
            <button
              data-tv-focusable="true"
              onClick={() => {
                if (!('webkitSpeechRecognition' in window)) return;
                const recognition = new (window as any).webkitSpeechRecognition();
                recognition.lang = settings.language === 'ar' ? 'ar-SA' : 'en-US';
                recognition.onstart = () => setIsVoiceActive(true);
                recognition.onresult = (event: any) => {
                  const text = event.results[0][0].transcript;
                  setSearch(text);
                  setIsVoiceActive(false);
                };
                recognition.onerror = () => setIsVoiceActive(false);
                recognition.onend = () => setIsVoiceActive(false);
                recognition.start();
              }}
              className={`p-2.5 rounded-full transition-all ${isVoiceActive ? 'bg-red-500 text-white animate-pulse' : 'bg-gold/20 text-gold hover:bg-gold/30'} focus:ring-4 focus:ring-gold outline-none`}
            >
              {isVoiceActive ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          </div>
        </div>

          <div className="flex items-center gap-2 bg-black/60 px-3.5 py-1.5 rounded-2xl border border-gold/30 shadow-md text-gold">
            <div className="flex items-baseline gap-2">
              <span className="text-sm sm:text-base font-black font-mono">
                {currentTime.toLocaleTimeString(settings.language === 'ar' ? 'ar-EG' : settings.language, {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: settings.timeFormat === '12h'
                })}
              </span>
              <span className="text-[11px] font-bold text-zinc-300 font-sans">
                {currentTime.toLocaleDateString(settings.language === 'ar' ? 'ar-EG' : settings.language, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
                })}
              </span>
            </div>
          </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        
        {/* Column 1: Categories Sidebar - Enlarged for TV & Mobile */}
        <aside className={`w-44 sm:w-56 md:w-64 lg:w-72 bg-black/60 backdrop-blur-md border-r border-white/10 flex flex-col shrink-0 ${isRtl ? 'border-l border-r-0' : ''}`}>
          <div className="p-3 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2 text-gold text-xs sm:text-sm font-black uppercase">
              {mediaType === 'movie' ? <Film size={16} /> : mediaType === 'series' ? <Clapperboard size={16} /> : <Tv size={16} />}
              <span>{isRtl ? (mediaType === 'movie' ? 'أقسام الأفلام' : mediaType === 'series' ? 'أقسام المسلسلات' : 'المجموعات') : 'Categories'}</span>
            </div>
            <span className="text-xs font-mono text-zinc-400 font-bold px-2 py-0.5 rounded-md bg-white/10">{visibleCategories.length}</span>
          </div>

              <div className="flex-1 overflow-y-auto no-scrollbar py-1">
                {loading && visibleCategories.length === 0 ? (
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-2 mb-3 text-gold text-xs font-bold animate-pulse">
                      <div className="w-3.5 h-3.5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                      <span></span>
                    </div>
                    {[1, 2, 3, 4, 5, 6, 7].map(n => (
                      <div key={n} className="h-10 rounded-xl bg-white/5 border border-white/5 animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <>
                    {/* Special Categories */}
                    <button
                      data-tv-focusable="true"
                      data-tv-pane="categories"
                      tabIndex={0}
                      onClick={() => setSelectedCategory('recent')}
                      className={`w-full flex items-center justify-between px-3 py-2 text-[10px] sm:text-xs font-bold transition-all border-b border-white/5 focus:outline-none focus:ring-4 focus:ring-gold focus:scale-105 focus:z-20 focus:bg-gold/25 ${
                        selectedCategory === 'recent'
                          ? 'bg-gold/15 text-gold border-l-2 border-l-gold shadow-inner font-black'
                          : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <History size={12} className="text-gold" />
                        <span className="truncate pr-1.5">{isRtl ? 'المشاهدة مؤخراً' : 'Recent'}</span>
                      </div>
                    </button>

                    <button
                      data-tv-focusable="true"
                      data-tv-pane="categories"
                      tabIndex={0}
                      onClick={() => setSelectedCategory('')}
                      className={`w-full flex items-center justify-between px-3 py-2 text-[10px] sm:text-xs font-bold transition-all border-b border-white/5 focus:outline-none focus:ring-4 focus:ring-gold focus:scale-105 focus:z-20 focus:bg-gold/25 ${
                        selectedCategory === ''
                          ? 'bg-gold/15 text-gold border-l-2 border-l-gold shadow-inner font-black'
                          : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                      }`}
                    >
                      <span className="truncate pr-1.5">{isRtl ? 'جميع المجموعات' : 'All Groups'}</span>
                      <span className="text-[9px] font-mono text-zinc-500 shrink-0">{channels.length}</span>
                    </button>

                    {visibleCategories.map((cat, catIdx) => (
                      <CategoryButton
                        key={`${cat.category_id}-${catIdx}`}
                        cat={cat}
                        catIdx={catIdx}
                        isSelected={selectedCategory === cat.category_id}
                        onSelect={setSelectedCategory}
                        onReorder={(c: any, i: number) => {
                          setReorderTarget({
                            type: 'category',
                            id: c.category_id,
                            index: i,
                            name: c.category_name
                          });
                          setTargetPosInput(String(i + 1));
                        }}
                        isRtl={isRtl}
                      />
                    ))}
                  </>
                )}
              </div>
        </aside>

        {/* Column 2: Posters Grid for Movies & Series (flex-1) or Channel List for Live TV */}
        <section className={`${
          mediaType === 'movie' || mediaType === 'series'
            ? 'flex-1' 
            : 'w-64 sm:w-72 md:w-80 lg:w-96'
        } bg-black/40 backdrop-blur-md border-r border-white/5 flex flex-col shrink-0 transition-all duration-300 ${isRtl ? 'border-l border-r-0' : ''}`}>
          
          <div className="p-2.5 border-b border-white/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5 text-gold text-[11px] font-black uppercase">
              <Tv size={14} />
              <span>{isRtl ? (mediaType === 'movie' ? 'قائمة الأفلام' : mediaType === 'series' ? 'قائمة المسلسلات' : 'قائمة القنوات') : 'Channels'}</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 font-bold">
              {loading && filteredChannels.length === 0 ? '...' : (selectedCategory === 'recent' ? getRecents().length : filteredChannels.length)}
            </span>
          </div>

          <div className="flex-1 overflow-hidden p-1.5 sm:p-2">
            {loading && filteredChannels.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-gold p-4 text-center">
                <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin shadow-lg shadow-gold/20" />
                <span className="text-xs font-bold text-zinc-300">
                </span>
              </div>
            ) : (
            <VirtualizedChannelList
              items={selectedCategory === 'recent' ? getRecents().map((r: any) => ({ ...r, stream_id: r.id })) : filteredChannels}
              selectedChannelId={selectedChannel?.stream_id}
              activePlayingMovieId={activePlayingMovie?.stream_id}
              favorites={favorites}
              isRtl={isRtl}
              mediaType={mediaType}
              onSelectChannel={(ch: ParsedChannel) => {
                if (selectedChannel?.stream_id === ch.stream_id) return;
                addToRecents(ch);
                setSelectedChannel(ch);
                if (mediaType === 'series') {
                  setSelectedSeriesDetailsItem(ch);
                } else if (mediaType === 'movie') {
                  setActivePlayingMovie(ch);
                  setMovieDetailsModal(ch);
                  setDetailLoading(true);
                  setMediaDetailInfo(null);
                  fetchMediaDetails(ch.stream_id, mediaType, activePlaylist!).then(info => {
                    setMediaDetailInfo(info);
                    setDetailLoading(false);
                  });
                } else {
                  if (multiViewMode !== 'none') {
                    setMultiChannels(prev => {
                      const next = [...prev];
                      next[activeSlot] = ch;
                      return next;
                    });
                  }
                }
              }}
              onDoubleClickChannel={(ch: ParsedChannel) => {
                setSelectedChannel(ch);
                toggleFullscreen();
              }}

              onToggleFavorite={toggleFavorite}
              onMoveChannel={(streamId: string, direction: 'up' | 'down', e: React.MouseEvent) => moveChannel(streamId, direction, e)}
              onReorderChannel={(item: any) => {
                setReorderTarget({
                  type: 'channel',
                  id: item.stream_id,
                  index: item.realIdx,
                  name: item.name
                });
                setTargetPosInput(String(item.realIdx + 1));
              }}
            />
            )}
          </div>
        </section>

        {/* Column 3: Player + Satellite Receiver Section (Only for Live & Favorites) */}
        {(mediaType === 'live' || mediaType === 'favorites') && (
        <main 
          ref={fullscreenContainerRef}
          className={`flex-1 flex flex-col bg-transparent relative min-w-0 h-full overflow-hidden select-none ${
            isFullscreen ? 'fixed inset-0 z-[9999] p-0' : 'p-2 sm:p-3'
          } ${isFullscreen && !showControls ? 'cursor-none' : 'cursor-default'}`}
          onMouseMove={triggerControlsVisibility}
          onTouchMove={triggerControlsVisibility}
          onClick={toggleControlsVisibility}
        >
          {/* Top Bar inside Player (Only in non-fullscreen) */}
          {!isFullscreen && (
            <div className="flex items-center justify-start gap-2 mb-2 shrink-0">
              <div className="flex items-center gap-1.5 bg-black/60 p-1 rounded-full border border-white/10">
                <button 
                  data-tv-focusable="true" 
                  data-tv-pane="player-controls"
                  onClick={() => { setMultiViewMode('none'); setActiveSlot(0); }} 
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase transition-all focus:ring-2 focus:ring-gold ${multiViewMode === 'none' ? 'bg-gold text-black shadow-md' : 'text-zinc-400 hover:text-white'}`}
                >
                  {isRtl ? 'شاشة واحدة' : 'Single'}
                </button>
                <button 
                  data-tv-focusable="true" 
                  data-tv-pane="player-controls"
                  onClick={() => {
                    setMultiViewMode('dual');
                    if (activeSlot > 1) setActiveSlot(0);
                    setMultiChannels(prev => {
                      const next = [...prev];
                      if (!next[0] && (selectedChannel || activePlayingMovie)) next[0] = selectedChannel || activePlayingMovie;
                      if (!next[1]) {
                        const curId = next[0]?.stream_id;
                        const idx = Math.max(0, filteredChannels.findIndex(c => c.stream_id === curId));
                        next[1] = filteredChannels[(idx + 1) % filteredChannels.length] || null;
                      }
                      return next;
                    });
                  }}
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase transition-all focus:ring-2 focus:ring-gold ${multiViewMode === 'dual' ? 'bg-gold text-black shadow-md' : 'text-zinc-400 hover:text-white'}`}
                >
                  {isRtl ? 'شاشتين' : 'Dual'}
                </button>
                <button 
                  data-tv-focusable="true" 
                  data-tv-pane="player-controls"
                  onClick={() => {
                    setMultiViewMode('quad');
                    setMultiChannels(prev => {
                      const next = [...prev];
                      if (!next[0] && (selectedChannel || activePlayingMovie)) next[0] = selectedChannel || activePlayingMovie;
                      const curId = next[0]?.stream_id;
                      const baseIdx = Math.max(0, filteredChannels.findIndex(c => c.stream_id === curId));
                      for (let i = 1; i < 4; i++) {
                        if (!next[i]) {
                          next[i] = filteredChannels[(baseIdx + i) % filteredChannels.length] || null;
                        }
                      }
                      return next;
                    });
                  }}
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase transition-all focus:ring-2 focus:ring-gold ${multiViewMode === 'quad' ? 'bg-gold text-black shadow-md' : 'text-zinc-400 hover:text-white'}`}
                >
                  {isRtl ? 'أربع شاشات' : 'Quad'}
                </button>
              </div>
            </div>
          )}

          {/* Player Container(s) Grid */}
          <div 
            className={`relative w-full h-full flex-1 min-h-0 grid gap-1.5 sm:gap-2 bg-black rounded-2xl overflow-hidden ${
              multiViewMode === 'quad' ? 'grid-cols-2 grid-rows-2' : 
              multiViewMode === 'dual' ? 'grid-cols-2 grid-rows-1' : 
              'grid-cols-1 grid-rows-1'
            }`}
            onDoubleClick={toggleFullscreen}
          >
            { (multiViewMode === 'quad' ? [0, 1, 2, 3] : multiViewMode === 'dual' ? [0, 1] : [0]).map((slotIdx) => {
              const isActive = activeSlot === slotIdx && !activeVodPlayer && !movieDetailsModal;
              const slotChannel = multiChannels[slotIdx] || (slotIdx === 0 ? (selectedChannel || activePlayingMovie) : null);

              return (
                <MultiVideoSlot
                  key={`slot-${slotIdx}`}
                  slotIdx={slotIdx}
                  channel={slotChannel}
                  isActive={isActive}
                  multiViewMode={multiViewMode}
                  activePlaylist={activePlaylist}
                  mediaType={mediaType}
                  settings={settings}
                  volume={volume}
                  isMuted={isMuted}
                  brightness={brightness}
                  aspectRatio={aspectRatio}
                  isRtl={isRtl}
                  loading={loading}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isActive && multiViewMode === 'none') {
                      toggleFullscreen();
                    } else {
                      setActiveSlot(slotIdx);
                      triggerControlsVisibility();
                    }
                  }}
                  onDoubleClick={toggleFullscreen}
                  onRegisterVideo={handleRegisterVideo}
                  onRegisterHls={handleRegisterHls}
                  onTracksUpdate={handleTracksUpdate}
                  onPlayingChange={setIsPlaying}
                />
              );
            })}

            {/* Quick Zapping HUD Notification Banner */}
            <AnimatePresence>
              {zappingInfo && (
                <motion.div
                  initial={{ opacity: 0, y: -25, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -15, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="absolute top-4 sm:top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
                >
                  <div className="flex items-center gap-3 px-4 sm:px-6 py-2 sm:py-2.5 rounded-2xl bg-zinc-950/95 border-2 border-gold/70 text-white shadow-[0_15px_45px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
                    {zappingInfo.number > 0 && (
                      <span className="px-2.5 py-1 rounded-lg bg-gold text-black font-mono font-black text-xs shadow-sm">
                        CH {String(zappingInfo.number).padStart(3, '0')}
                      </span>
                    )}
                    {zappingInfo.logo && (
                      <img src={zappingInfo.logo} className="w-6 h-6 object-contain rounded" alt="" onError={e => e.currentTarget.style.display='none'} />
                    )}
                    <span className="text-xs sm:text-sm font-black text-white">{zappingInfo.name}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>



            {/* Floating Audio Menu */}
            <AnimatePresence>
              {showAudioMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 15, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className={`absolute bottom-[180px] sm:bottom-[210px] ${isRtl ? 'right-4 sm:right-10' : 'left-4 sm:left-10'} z-[100] w-72 sm:w-80 bg-zinc-950/98 border-2 border-[var(--theme-primary,rgba(239,68,68,0.6))] rounded-3xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.95)] backdrop-blur-2xl text-white`}
                >
                  <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[var(--theme-primary,#ef4444)] shadow-[0_0_10px_var(--theme-glow,rgba(239,68,68,0.8))]" />
                      <h3 className="text-xs font-black uppercase text-[var(--theme-primary,#fca5a5)] tracking-wider">
                        {isRtl ? 'إعدادات ومسارات الصوت' : 'Audio Track Selection'}
                      </h3>
                    </div>
                    <button onClick={() => setShowAudioMenu(false)} className="text-zinc-400 hover:text-white p-1"><X size={16} /></button>
                  </div>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto no-scrollbar">
                    {(activeTracksData.audioTracks.length > 0 ? activeTracksData.audioTracks : [
                      { id: 0, name: isRtl ? 'مسار الصوت الأساسي (Stereo الأصلية)' : 'Track 1 (Default Stereo)' },
                      { id: 1, name: isRtl ? 'صوت المعلق الثاني / الإضافي' : 'Track 2 (Commentary / Alt)' }
                    ]).map((track, idx) => {
                      const isSelected = activeTracksData.currentAudio === track.id || selectedAudioTrack.includes(track.name);
                      return (
                        <button
                          key={`${track.id}-${idx}`}
                          onClick={() => handleSelectAudioTrack(track.id, track.name)}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all ${
                            isSelected ? 'bg-red-500/20 border-red-500 text-white shadow-md' : 'bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Volume2 size={14} className={isSelected ? 'text-red-400' : 'text-zinc-500'} />
                            <span className="truncate">{track.name}</span>
                          </div>
                          {isSelected && <Check size={14} className="text-red-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Floating Subtitle Menu */}
            <AnimatePresence>
              {showSubMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 15, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className={`absolute bottom-[180px] sm:bottom-[210px] ${isRtl ? 'right-20 sm:right-32' : 'left-20 sm:left-32'} z-[100] w-72 sm:w-80 bg-zinc-950/98 border-2 border-emerald-500/60 rounded-3xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.95)] backdrop-blur-2xl text-white`}
                >
                  <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                      <h3 className="text-xs font-black uppercase text-emerald-300 tracking-wider">
                        {isRtl ? 'الترجمة واللغات (CC)' : 'Subtitles & Closed Captions'}
                      </h3>
                    </div>
                    <button onClick={() => setShowSubMenu(false)} className="text-zinc-400 hover:text-white p-1"><X size={16} /></button>
                  </div>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto no-scrollbar">
                    <button
                      onClick={() => handleSelectSubtitleTrack(-1, isRtl ? 'إيقاف الترجمة (Off)' : 'Subtitles Off')}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all ${
                        activeTracksData.currentSubtitle === -1 || selectedSubtitleTrack.includes('Off') || selectedSubtitleTrack.includes('مغلق')
                          ? 'bg-emerald-500/20 border-emerald-500 text-white shadow-md' : 'bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <EyeOff size={14} className="text-zinc-400" />
                        <span className="truncate">{isRtl ? 'إيقاف الترجمة (Off)' : 'Subtitles Off'}</span>
                      </div>
                      {(activeTracksData.currentSubtitle === -1 || selectedSubtitleTrack.includes('Off') || selectedSubtitleTrack.includes('مغلق')) && (
                        <Check size={14} className="text-emerald-400 shrink-0" />
                      )}
                    </button>
                    {(activeTracksData.subtitleTracks.length > 0 ? activeTracksData.subtitleTracks : [
                      { id: 0, name: isRtl ? 'العربية (Arabic Subtitles)' : 'Arabic (ar)' },
                      { id: 1, name: isRtl ? 'الإنجليزية (English Subtitles)' : 'English (en)' }
                    ]).map((track, idx) => {
                      const isSelected = activeTracksData.currentSubtitle === track.id || selectedSubtitleTrack.includes(track.name);
                      return (
                        <button
                          key={`${track.id}-${idx}`}
                          onClick={() => handleSelectSubtitleTrack(track.id, track.name)}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all ${
                            isSelected ? 'bg-emerald-500/20 border-emerald-500 text-white shadow-md' : 'bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Layers size={14} className={isSelected ? 'text-emerald-400' : 'text-zinc-500'} />
                            <span className="truncate">{track.name}</span>
                          </div>
                          {isSelected && <Check size={14} className="text-emerald-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Floating Quality Menu */}
            <AnimatePresence>
              {showQualityMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 15, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className={`absolute bottom-[180px] sm:bottom-[210px] ${isRtl ? 'right-36 sm:right-56' : 'left-36 sm:left-56'} z-[100] w-72 sm:w-80 bg-zinc-950/98 border-2 border-gold/60 rounded-3xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.95)] backdrop-blur-2xl text-white`}
                >
                  <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-gold shadow-[0_0_10px_var(--theme-glow,rgba(229,160,13,0.8))]" />
                      <h3 className="text-xs font-black uppercase text-gold tracking-wider">
                        {isRtl ? 'جودة ودقة البث' : 'Video Resolution & Quality'}
                      </h3>
                    </div>
                    <button onClick={() => setShowQualityMenu(false)} className="text-zinc-400 hover:text-white p-1"><X size={16} /></button>
                  </div>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto no-scrollbar">
                    <button
                      onClick={() => handleSelectQuality(-1, isRtl ? 'تلقائي (Auto 4K/HD Adapt)' : 'Auto Adaptive (4K/HD)')}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all ${
                        activeTracksData.currentLevel === -1 || selectedQuality.includes('Auto') || selectedQuality.includes('تلقائي')
                          ? 'bg-gold/20 border-gold text-white shadow-md' : 'bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Sparkles size={14} className="text-gold" />
                        <span className="truncate">{isRtl ? 'تلقائي (Auto Adaptive)' : 'Auto Adaptive (Best)'}</span>
                      </div>
                      {(activeTracksData.currentLevel === -1 || selectedQuality.includes('Auto') || selectedQuality.includes('تلقائي')) && (
                        <Check size={14} className="text-gold shrink-0" />
                      )}
                    </button>
                    {(activeTracksData.levels.length > 0 ? activeTracksData.levels : [
                      { id: 0, name: 'Full HD (1080p)' },
                      { id: 1, name: 'HD (720p)' },
                      { id: 2, name: 'SD (576p)' }
                    ]).map((level, idx) => {
                      const isSelected = activeTracksData.currentLevel === level.id || selectedQuality.includes(level.name);
                      return (
                        <button
                          key={`${level.id}-${idx}`}
                          onClick={() => handleSelectQuality(level.id, level.name)}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all ${
                            isSelected ? 'bg-gold/20 border-gold text-white shadow-md' : 'bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Monitor size={14} className={isSelected ? 'text-gold' : 'text-zinc-500'} />
                            <span className="truncate">{level.name}</span>
                          </div>
                          {isSelected && <Check size={14} className="text-gold shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* SATELLITE RECEIVER OSD INFOBAR (Restored fully with Signal/Quality & Color Keys) */}
            <div className={`absolute bottom-1.5 left-1.5 right-1.5 sm:bottom-3 sm:left-3 sm:right-3 p-1.5 sm:p-2 bg-zinc-950/96 border border-gold/30 backdrop-blur-3xl rounded-lg sm:rounded-xl flex flex-col gap-1 sm:gap-1.5 z-50 shadow-[0_15px_50px_rgba(0,0,0,0.95)] transition-all duration-300 ${
              (isFullscreen && showControls)
                ? 'opacity-100 translate-y-0 pointer-events-auto' 
                : 'opacity-0 translate-y-6 pointer-events-none'
            }`}>
              {/* Infobar Header */}
              <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="px-1.5 py-0.5 bg-gradient-to-r from-gold/40 to-gold/10 border border-gold/50 rounded-md text-gold font-mono text-[10px] sm:text-xs font-black tracking-widest shadow-[0_0_10px_rgba(212,175,55,0.15)] shrink-0">
                    CH {String(filteredChannels.findIndex(c => c.stream_id === (multiChannels[activeSlot]?.stream_id || selectedChannel?.stream_id)) + 1 || 1).padStart(3, '0')}
                  </div>
                  {(multiChannels[activeSlot]?.stream_icon || selectedChannel?.stream_icon) && (
                    <img 
                      src={multiChannels[activeSlot]?.stream_icon || selectedChannel?.stream_icon} 
                      className="w-7 h-7 object-contain rounded bg-black/40 border border-white/10 shrink-0" 
                      alt="" 
                      onError={e => e.currentTarget.style.display='none'} 
                    />
                  )}
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h2 className="text-sm sm:text-base font-black text-white truncate leading-tight" title={multiChannels[activeSlot]?.name || selectedChannel?.name}>
                        {multiChannels[activeSlot]?.name || selectedChannel?.name || (isRtl ? 'اختر قناة...' : 'Select Channel...')}
                      </h2>
                    </div>
                    <span className="text-[9px] text-gold/70 font-black uppercase tracking-[0.1em] mt-0.5">
                      {multiChannels[activeSlot]?.category_name || selectedChannel?.category_name || (isRtl ? 'البث المباشر' : 'Live Broadcast')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                   <div className="flex flex-col items-end">
                     <div className="px-2 py-0.5 bg-black/60 border border-gold/30 rounded-lg text-gold font-mono text-[11px] sm:text-xs font-black shadow-inner">
                       {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                     </div>
                   </div>
                </div>
              </div>

              {/* Infobar Middle: EPG Progress & Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-1.5 sm:gap-2">
                <div className="w-full flex-1 flex flex-col gap-1">
                  {(() => {
                    const current = getCurrentProgram(multiChannels[activeSlot] || selectedChannel);
                    const next = getNextProgram(multiChannels[activeSlot] || selectedChannel);
                    if (current) {
                      const total = current.stop.getTime() - current.start.getTime();
                      const elapsed = currentTime.getTime() - current.start.getTime();
                      const progress = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
                      const startTime = current.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const stopTime = current.stop.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const nextStartTime = next ? next.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                      return (
                        <>
                          <div className="flex items-center justify-between text-[10px] font-black">
                            <div className="flex items-center gap-1.5 text-zinc-100 min-w-0">
                              <span className="px-1.5 py-0 bg-gold/20 text-gold text-[8px] font-black rounded-sm shrink-0">NOW</span>
                              <span className="text-gold font-mono text-[9px] shrink-0">{startTime} - {stopTime}</span>
                              <span className="truncate">{current.title}</span>
                            </div>
                            <span className="text-gold font-mono shrink-0">{progress}%</span>
                          </div>
                          <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-gold" style={{ width: `${progress}%` }} />
                          </div>
                          <div className="flex items-center gap-1.5 text-[9px] text-zinc-400 font-bold min-w-0">
                            <span className="px-1.5 py-0 bg-zinc-800 text-zinc-300 text-[8px] rounded-sm shrink-0">NEXT</span>
                            {nextStartTime && <span className="text-zinc-400 font-mono text-[9px] shrink-0">{nextStartTime}</span>}
                            <span className="truncate">{next ? next.title : (isRtl ? 'لا يوجد معلومات إضافية' : 'No Information Available')}</span>
                          </div>
                        </>
                      );
                    }
                    return (
                      <>
                        <div className="flex items-center justify-between text-[10px] font-black">
                          <div className="flex items-center gap-1.5 text-zinc-100 min-w-0">
                            <span className="px-1.5 py-0 bg-gold/20 text-gold text-[8px] font-black rounded-sm shrink-0">NOW</span>
                            <span className="truncate">{isRtl ? 'البث المباشر (لا يتوفر دليل برامج حالياً)' : 'Live Broadcast (No EPG Data)'}</span>
                          </div>
                          <span className="text-gold font-mono shrink-0">LIVE</span>
                        </div>
                        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="w-full h-full bg-gold" />
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button 
                    data-tv-focusable="true"
                    data-tv-pane="player-controls"
                    onClick={() => setShowEpgTimeline(true)} 
                    className="px-2.5 py-1 bg-white/5 border border-white/10 hover:border-gold rounded-lg text-[9px] font-black uppercase text-zinc-200 hover:text-gold transition-all flex items-center gap-1 focus:ring-2 focus:ring-gold"
                  >
                    <Clock size={11} className="text-gold" />
                    <span>{isRtl ? 'الدليل' : 'EPG'}</span>
                  </button>
                  <button 
                    data-tv-focusable="true"
                    data-tv-pane="player-controls"
                    onClick={() => setShowEpgGrid(true)} 
                    className="px-2.5 py-1 bg-gold text-black border border-gold rounded-lg text-[9px] font-black uppercase hover:bg-gold/80 transition-all flex items-center gap-1 shadow-[0_0_10px_rgba(212,175,55,0.3)] focus:ring-2 focus:ring-black"
                  >
                    <LayoutGrid size={11} />
                    <span>{isRtl ? 'الجدول' : 'Grid'}</span>
                  </button>
                  <button 
                    data-tv-focusable="true"
                    data-tv-pane="player-controls"
                    onClick={() => {
                      const cur = multiChannels[activeSlot] || selectedChannel;
                      if (cur) toggleFavorite(cur.stream_id);
                    }}
                    className={`px-2.5 py-1 border rounded-lg text-[9px] font-black uppercase transition-all flex items-center gap-1 focus:ring-2 focus:ring-gold ${
                      (multiChannels[activeSlot] || selectedChannel) && favorites.includes((multiChannels[activeSlot]?.stream_id || selectedChannel?.stream_id) as string)
                        ? 'bg-gold text-black border-gold shadow-[0_0_10px_rgba(212,175,55,0.3)]' : 'bg-white/5 border-white/10 text-zinc-200 hover:border-gold hover:text-gold'
                    }`}
                  >
                    <Star size={11} className={(multiChannels[activeSlot] || selectedChannel) && favorites.includes((multiChannels[activeSlot]?.stream_id || selectedChannel?.stream_id) as string) ? 'fill-black text-black' : 'text-gold'} />
                    <span>{isRtl ? 'المفضلة' : 'Favorite'}</span>
                  </button>
                </div>
              </div>

              {/* Infobar Footer: Satellite Receiver Color Keys */}
              <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 sm:gap-4">
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <button 
                    data-tv-focusable="true"
                    data-tv-pane="player-controls"
                    onClick={() => { setShowAudioMenu(!showAudioMenu); setShowSubMenu(false); setShowQualityMenu(false); }} 
                    className="flex items-center gap-1 px-2 py-1 bg-red-950/40 border border-red-500/40 rounded-lg text-red-300 text-[9px] font-black hover:bg-red-900/60 transition-all shadow-sm focus:ring-2 focus:ring-red-500"
                  >
                    <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                    {isRtl ? 'الصوت' : 'AUDIO'}
                  </button>
                  <button 
                    data-tv-focusable="true"
                    data-tv-pane="player-controls"
                    onClick={() => { setShowSubMenu(!showSubMenu); setShowAudioMenu(false); setShowQualityMenu(false); }} 
                    className="flex items-center gap-1 px-2 py-1 bg-emerald-950/40 border border-emerald-500/40 rounded-lg text-emerald-300 text-[9px] font-black hover:bg-emerald-900/60 transition-all shadow-sm focus:ring-2 focus:ring-emerald-500"
                  >
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
                    {isRtl ? 'الترجمة' : 'SUB'}
                  </button>
                  <button 
                    data-tv-focusable="true"
                    data-tv-pane="player-controls"
                    onClick={() => { setShowQualityMenu(!showQualityMenu); setShowAudioMenu(false); setShowSubMenu(false); }} 
                    className="flex items-center gap-1 px-2 py-1 bg-gold/10 border border-gold/40 rounded-lg text-gold text-[9px] font-black hover:bg-gold/20 transition-all shadow-sm focus:ring-2 focus:ring-gold"
                  >
                    <div className="w-2 h-2 rounded-full bg-gold shadow-[0_0_6px_var(--theme-glow,rgba(229,160,13,0.8))]" />
                    {selectedQuality.split(' ')[0] || (isRtl ? 'الجودة' : 'QUAL')}
                  </button>
                  <button 
                    data-tv-focusable="true"
                    data-tv-pane="player-controls"
                    onClick={() => {
                      const ratios: Array<'16:9' | '4:3' | 'fill' | 'fit'> = ['16:9', '4:3', 'fill', 'fit'];
                      const nextRatio = ratios[(ratios.indexOf(aspectRatio) + 1) % ratios.length];
                      setAspectRatio(nextRatio);
                    }} 
                    className="flex items-center gap-1 px-2 py-1 bg-gold/10 border border-gold/40 rounded-lg text-gold text-[9px] font-black hover:bg-gold/20 transition-all shadow-sm focus:ring-2 focus:ring-gold"
                  >
                    <div className="w-2 h-2 rounded-full bg-gold shadow-[0_0_6px_var(--theme-glow,rgba(229,160,13,0.8))]" />
                    {aspectRatio.toUpperCase()}
                  </button>
                  <button 
                    data-tv-focusable="true"
                    data-tv-pane="player-controls"
                    onClick={() => setIsMuted(!isMuted)} 
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black transition-all shadow-sm border focus:ring-2 focus:ring-gold ${isMuted ? 'bg-red-500/20 border-red-500 text-red-300' : 'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/10'}`}
                  >
                    {isMuted ? <VolumeX size={12} className="text-red-400" /> : <Volume2 size={12} className="text-gold" />}
                    <span>{isMuted ? (isRtl ? 'كتم' : 'Mute') : `${Math.round(volume * 100)}%`}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 sm:gap-3">
                  {/* Dedicated Channel Flipping Buttons (CH- / CH+) */}
                  <div className="flex items-center gap-1 bg-black/60 p-1 rounded-xl border border-gold/30 shadow-inner">
                    <button 
                      onClick={(e) => { e.stopPropagation(); switchChannelByOffset(-1); }}
                      className="flex items-center gap-1 px-2.5 py-1 text-zinc-200 hover:text-gold hover:bg-white/10 rounded-lg text-xs font-bold transition-all"
                      title={isRtl ? 'القناة السابقة (CH-)' : 'Previous Channel (CH-)'}
                    >
                      <ChevronUp size={16} className="text-gold" />
                      <span className="font-mono text-[11px] hidden sm:inline">CH-</span>
                    </button>
                    <div className="w-[1px] h-4 bg-white/10" />
                    <button 
                      onClick={(e) => { e.stopPropagation(); switchChannelByOffset(1); }}
                      className="flex items-center gap-1 px-2.5 py-1 text-zinc-200 hover:text-gold hover:bg-white/10 rounded-lg text-xs font-bold transition-all"
                      title={isRtl ? 'القناة التالية (CH+)' : 'Next Channel (CH+)'}
                    >
                      <span className="font-mono text-[11px] hidden sm:inline">CH+</span>
                      <ChevronDown size={16} className="text-gold" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1 bg-black/50 p-1 rounded-xl border border-white/15">
                    <button 
                      data-tv-focusable="true"
                      data-tv-pane="player-controls"
                      onClick={(e) => {
                        e.stopPropagation();
                        const vid = getTargetVideoElement(activeSlot);
                        if (vid) { if (vid.paused) vid.play(); else vid.pause(); }
                      }}
                      className="w-8 h-8 sm:w-9 sm:h-9 bg-gold text-black rounded-lg flex items-center justify-center hover:scale-105 transition-all shadow-[0_0_15px_rgba(212,175,55,0.4)] focus:ring-4 focus:ring-black"
                    >
                      {isPlaying ? <Pause size={18} className="fill-black" /> : <Play size={18} className="fill-black ml-0.5" />}
                    </button>
                  </div>
                  <button 
                    data-tv-focusable="true"
                    data-tv-pane="player-controls"
                    onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} 
                    className="p-2 sm:p-2.5 bg-white/5 border border-white/10 text-white rounded-xl hover:bg-gold hover:text-black transition-all shadow-inner focus:ring-4 focus:ring-gold"
                  >
                    {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Floating button in Fullscreen when controls are hidden */}
            {isFullscreen && !showControls && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowControls(true);
                  triggerControlsVisibility();
                }}
                className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 px-5 py-2.5 rounded-full bg-zinc-950/90 border border-gold/60 text-gold text-xs font-black shadow-[0_10px_30px_rgba(0,0,0,0.9)] backdrop-blur-xl flex items-center gap-2 hover:bg-gold hover:text-black transition-all cursor-pointer animate-pulse"
              >
                <Sliders size={14} />
                <span>{isRtl ? 'عرض شريط القناة والمعلومات' : 'Show Channel Bar & Info'}</span>
              </button>
            )}
          </div>
        </main>
        )}
      </div>

      {/* Rich Movie / Series Details Modal */}
      <AnimatePresence>
        {movieDetailsModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/92 backdrop-blur-2xl select-none"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className={`w-[90vw] max-w-2xl max-h-[78vh] bg-zinc-950/98 border-2 border-gold/50 rounded-2xl p-3 sm:p-4 shadow-2xl flex flex-col overflow-hidden ${isRtl ? 'font-cairo text-right' : 'text-left'}`}
            >
              {/* Header */}
              <div className={`flex items-center justify-between pb-2 border-b border-white/10 shrink-0 ${isRtl ? 'flex-row-reverse' : ''}`}>
                <div className={`flex items-center gap-2.5 min-w-0 ${isRtl ? 'flex-row-reverse' : ''}`}>
                  <div className="p-1.5 sm:p-2 rounded-xl bg-gold/20 text-gold shrink-0">
                    {mediaType === 'movie' ? <Film size={16} /> : <Clapperboard size={16} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider truncate">
                      {movieDetailsModal.name}
                    </h2>
                    <p className="text-[9px] sm:text-[10px] text-gold/80 font-bold uppercase truncate mt-0.5">
                      {movieDetailsModal?.category_name || (mediaType === 'movie' ? 'فيلم سينمائي' : 'مسلسل تلفزيوني')}
                    </p>
                  </div>
                </div>
                <button
                  data-tv-focusable="true"
                  data-tv-modal="details"
                  tabIndex={0}
                  onClick={() => setMovieDetailsModal(null)}
                  className="p-1.5 text-zinc-400 hover:text-white focus:text-gold focus:ring-4 focus:ring-gold rounded-full transition-all outline-none"
                  title={isRtl ? 'إغلاق (Esc)' : 'Close (Esc)'}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Scrollable Modal Content */}
              <div className="py-3 flex flex-col md:flex-row gap-3 sm:gap-4 overflow-y-auto no-scrollbar flex-1">
                {/* Poster Image */}
                <div className="w-20 sm:w-28 aspect-[2/3] rounded-xl overflow-hidden border border-gold/30 shadow-xl shrink-0 mx-auto md:mx-0">
                  <img src={movieDetailsModal.stream_icon} className="w-full h-full object-cover" onError={e => e.currentTarget.style.display='none'} alt="" />
                </div>

                {/* Details & Episode Selector */}
                <div className="flex-1 flex flex-col gap-3 min-w-0">
                  {(() => {
                    const plot = mediaDetailInfo?.info?.plot || mediaDetailInfo?.info?.description;
                    const isPlaceholder = plot && (plot.includes('لا تتوفر تفاصيل') || plot.includes('No information') || plot.includes('No description'));
                    if (!plot || isPlaceholder) return null;
                    return (
                      <div>
                        <h3 className="text-[11px] sm:text-xs font-black uppercase text-gold tracking-widest mb-1">
                          {isRtl ? 'قصة الفيلم / المسلسل' : 'Synopsis & Plot'}
                        </h3>
                        <p className="text-xs sm:text-sm text-zinc-200 leading-relaxed max-h-24 overflow-y-auto no-scrollbar font-medium">
                          {plot}
                        </p>
                      </div>
                    );
                  })()}

                  {mediaDetailInfo?.info?.cast && (
                    <div>
                      <h3 className="text-[11px] sm:text-xs font-black uppercase text-gold tracking-widest mb-0.5">
                        {isRtl ? 'طاقم العمل والممثلون' : 'Cast & Actors'}
                      </h3>
                      <p className="text-xs text-zinc-400 truncate">{mediaDetailInfo.info.cast}</p>
                    </div>
                  )}

                  {/* Subtitles & Audio Languages Badges extracted from subscription */}
                  {Boolean(
                    (mediaDetailInfo?.info?.subtitles && (mediaDetailInfo.info.subtitles.length > 0 || Object.keys(mediaDetailInfo.info.subtitles).length > 0)) ||
                    (mediaDetailInfo?.movie_data?.subtitles && mediaDetailInfo.movie_data.subtitles.length > 0) ||
                    mediaDetailInfo?.info?.audio ||
                    mediaDetailInfo?.info?.audio_streams
                  ) && (
                    <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex flex-col gap-2">
                      {/* Available Subtitles */}
                      {Boolean((mediaDetailInfo?.info?.subtitles && (Array.isArray(mediaDetailInfo.info.subtitles) ? mediaDetailInfo.info.subtitles.length > 0 : Object.keys(mediaDetailInfo.info.subtitles).length > 0)) || (mediaDetailInfo?.movie_data?.subtitles && mediaDetailInfo.movie_data.subtitles.length > 0)) && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] sm:text-xs text-emerald-400 font-bold flex items-center gap-1 shrink-0">
                            <Layers size={13} />
                            {isRtl ? 'الترجمة المتوفرة:' : 'Subtitles:'}
                          </span>
                          {(Array.isArray(mediaDetailInfo?.info?.subtitles)
                            ? mediaDetailInfo.info.subtitles
                            : Object.values(mediaDetailInfo?.info?.subtitles || mediaDetailInfo?.movie_data?.subtitles || {})
                          ).slice(0, 6).map((sub: any, sIdx: number) => {
                            const code = typeof sub === 'string' ? sub : (sub.language || sub.lang || sub.container || 'ar');
                            return (
                              <span key={sIdx} className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] sm:text-[10px] font-bold">
                                {formatLanguageLabel(code, isRtl)}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Available Audio Tracks */}
                      {Boolean(mediaDetailInfo?.info?.audio || mediaDetailInfo?.info?.audio_streams) && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] sm:text-xs text-red-400 font-bold flex items-center gap-1 shrink-0">
                            <Volume2 size={13} />
                            {isRtl ? 'لغات الصوت:' : 'Audio:'}
                          </span>
                          {(Array.isArray(mediaDetailInfo?.info?.audio || mediaDetailInfo?.info?.audio_streams)
                            ? (mediaDetailInfo?.info?.audio || mediaDetailInfo?.info?.audio_streams)
                            : [mediaDetailInfo?.info?.audio || mediaDetailInfo?.info?.audio_streams]
                          ).slice(0, 6).map((aud: any, aIdx: number) => {
                            const code = typeof aud === 'string' ? aud : (aud.language || aud.lang || 'Stereo');
                            return (
                              <span key={aIdx} className="px-2 py-0.5 rounded-md bg-red-500/20 text-red-300 border border-red-500/30 text-[9px] sm:text-[10px] font-bold">
                                {formatLanguageLabel(code, isRtl)}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Seasons & Episodes Selector for Series */}
                  {seriesSeasonsData.length > 0 && (
                    <div className="mt-1 space-y-2 border-t border-white/10 pt-2.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black uppercase text-gold tracking-widest">
                          {isRtl ? 'المواسم والحلقات' : 'Seasons & Episodes'}
                        </h3>
                        <span className="text-[10px] sm:text-xs text-zinc-400 font-bold">
                          {seriesSeasonsData.length} {isRtl ? 'مواسم' : 'Seasons'}
                        </span>
                      </div>

                      {/* Season Tabs */}
                      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                        {seriesSeasonsData.map((s, sIdx) => {
                          const isSelected = selectedSeasonNum === s.seasonNumber;
                          return (
                            <button
                              key={`${s.seasonNumber}-${sIdx}`}
                              data-tv-focusable="true"
                              data-tv-modal="details"
                              tabIndex={0}
                              onClick={() => setSelectedSeasonNum(s.seasonNumber)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border outline-none focus:ring-4 focus:ring-gold focus:scale-105 ${
                                isSelected
                                  ? 'bg-gold text-black border-gold shadow-[0_0_12px_rgba(212,175,55,0.4)]'
                                  : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:border-gold/40'
                              }`}
                            >
                              {s.title}
                            </button>
                          );
                        })}
                      </div>

                      {/* Episodes List */}
                      <div className="max-h-40 sm:max-h-48 overflow-y-auto no-scrollbar space-y-2 pr-1">
                        {(seriesSeasonsData.find(s => s.seasonNumber === selectedSeasonNum)?.episodes || seriesSeasonsData[0]?.episodes || []).map((ep: ParsedChannel, epIdx: number) => (
                          <div
                            key={`${ep.stream_id}-${epIdx}`}
                            data-tv-focusable="true"
                            data-tv-modal="details"
                            tabIndex={0}
                            onClick={() => {
                              setSelectedChannel(ep);
                              if (settings.useExternalPlayer) {
                                launchExternalPlayer(ep.url);
                              } else {
                                setActivePlayingMovie(ep);
                                setActiveVodPlayer(ep);
                              }
                              setMovieDetailsModal(null);
                            }}
                            className="flex items-center justify-between p-2.5 rounded-xl bg-black/60 border border-white/10 hover:border-gold/60 hover:bg-gold/15 focus:ring-4 focus:ring-gold focus:border-gold focus:bg-gold/25 focus:scale-[1.01] transition-all group cursor-pointer outline-none"
                          >
                              <div className="w-8 h-8 rounded-lg bg-gold/20 flex items-center justify-center text-gold font-mono font-bold group-hover:scale-110 shrink-0 transition-transform">
                                {ep.episode || epIdx + 1}
                              </div>
                              <div className="min-w-0 flex-1 ml-3">
                                <p className="text-xs sm:text-sm font-bold text-white group-hover:text-gold transition-colors truncate">
                                  {ep.name}
                                </p>
                              </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Fixed Sticky Action Buttons in Footer - Only for Movies */}
              <div className="pt-3 border-t border-white/10 flex items-center gap-3 shrink-0">
                {mediaType === 'movie' && (
                  <button
                    data-tv-focusable="true"
                    data-tv-modal="details"
                    data-tv-play-now="true"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedChannel(movieDetailsModal);
                      if (settings.useExternalPlayer) {
                        launchExternalPlayer(movieDetailsModal.url);
                      } else {
                        setActivePlayingMovie(movieDetailsModal);
                        setActiveVodPlayer(movieDetailsModal);
                      }
                      setMovieDetailsModal(null);
                    }}
                    className="px-8 py-2.5 bg-gradient-to-r from-gold to-amber-500 hover:from-amber-400 hover:to-amber-500 text-black rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 focus:ring-4 focus:ring-amber-300 focus:scale-105 shadow-md transition-all outline-none cursor-pointer border border-amber-300/40"
                  >
                    <Play size={16} className="fill-black" />
                    <span>{isRtl ? 'تشغيل الفيلم' : 'Play Movie'}</span>
                  </button>
                )}
                <button
                  data-tv-focusable="true"
                  data-tv-modal="details"
                  tabIndex={0}
                  onClick={() => toggleFavorite(movieDetailsModal.stream_id)}
                  className={`p-3 rounded-xl border transition-all outline-none focus:ring-4 focus:ring-gold focus:scale-105 ${
                    favorites.includes(movieDetailsModal.stream_id) ? 'bg-gold text-black border-gold' : 'bg-white/5 border-white/10 text-zinc-300 hover:border-gold'
                  }`}
                  title={isRtl ? 'المفضلة' : 'Favorite'}
                >
                  <Star size={18} className={favorites.includes(movieDetailsModal.stream_id) ? 'fill-black' : ''} />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Position Reorder Modal Dialog */}
      <AnimatePresence>
        {reorderTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md select-none"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className={`w-full max-w-md bg-zinc-950 border-2 border-gold/50 rounded-3xl p-6 shadow-2xl flex flex-col ${isRtl ? 'font-cairo text-right' : 'text-left'}`}
            >
              <div className={`flex items-center justify-between pb-3 border-b border-white/10 ${isRtl ? 'flex-row-reverse' : ''}`}>
                <div className={`flex items-center gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
                  <Move size={20} className="text-gold" />
                  <h3 className="text-sm font-black text-gold uppercase tracking-wider">
                    {isRtl ? 'نقل المجموعات أو القنوات' : 'Reorder Position'}
                  </h3>
                </div>
                <button onClick={() => setReorderTarget(null)} className="text-zinc-400 hover:text-white"><X size={18} /></button>
              </div>

              <div className="py-4 space-y-4">
                <p className="text-xs text-zinc-300">
                  {isRtl ? `نقل "${reorderTarget.name}" من الترتيب الحالي #${reorderTarget.index + 1}:` : `Move "${reorderTarget.name}" from #${reorderTarget.index + 1}:`}
                </p>

                <div className="flex items-center gap-3">
                  <label className="text-xs text-gold font-bold whitespace-nowrap">{isRtl ? 'إلى الرقم الجديد:' : 'To position #:'}</label>
                  <div className="flex items-center gap-1 bg-black/80 p-1 rounded-2xl border border-gold/40 shadow-inner">
                    <button 
                      onClick={() => {
                        const current = parseInt(targetPosInput, 10) || 1;
                        setTargetPosInput(String(Math.max(1, current - 1)));
                      }}
                      className="p-2 text-gold hover:bg-gold/20 rounded-xl transition-all active:scale-125"
                      title="رفع لأعلى"
                    >
                      <ChevronUp size={18} />
                    </button>

                    <input 
                      type="number" 
                      min="1" 
                      max={reorderTarget.type === 'category' ? categories.length : channels.length} 
                      value={targetPosInput} 
                      onChange={e => setTargetPosInput(e.target.value)} 
                      className="w-16 bg-white/10 border border-white/10 rounded-xl px-2 py-1.5 text-center text-sm text-gold font-mono font-black outline-none focus:border-gold"
                    />

                    <button 
                      onClick={() => {
                        const current = parseInt(targetPosInput, 10) || 1;
                        const max = reorderTarget.type === 'category' ? categories.length : channels.length;
                        setTargetPosInput(String(Math.min(max, current + 1)));
                      }}
                      className="p-2 text-gold hover:bg-gold/20 rounded-xl transition-all active:scale-125"
                      title="تنزيل لأسفل"
                    >
                      <ChevronDown size={18} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-2">
                <button onClick={() => setReorderTarget(null)} className="px-4 py-2 bg-white/10 text-white rounded-xl text-xs font-bold">
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button 
                  onClick={() => moveItemToPosition(reorderTarget.type, reorderTarget.id, parseInt(targetPosInput, 10) || 1)} 
                  className="px-5 py-2 bg-gold text-black rounded-xl text-xs font-black uppercase hover:bg-gold/80"
                >
                  {isRtl ? 'تطبيق النقل' : 'Apply Position'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Series Seasons & Episodes Details Modal */}
      {selectedSeriesDetailsItem && (
        <SeriesDetailsModal
          series={selectedSeriesDetailsItem}
          activePlaylist={activePlaylist}
          isRtl={isRtl}
          onClose={() => setSelectedSeriesDetailsItem(null)}
          onPlayEpisode={(episode, seasonEpisodes, epIdx) => {
            setSelectedSeriesDetailsItem(null);
            if (settings.useExternalPlayer) {
              launchExternalPlayer((episode as any).url);
            } else {
              setActiveVodPlayer(episode as any);
              setSelectedChannel(episode as any);
            }
          }}
        />
      )}

      {/* Dedicated VOD Player Modal for Movies & Series */}
      {activeVodPlayer && (
        <VodPlayerModal
          media={activeVodPlayer}
          mediaType={mediaType === 'series' ? 'series' : 'movie'}
          activePlaylist={activePlaylist}
          settings={settings}
          isRtl={isRtl}
          onClose={() => setActiveVodPlayer(null)}
          episodesList={mediaType === 'series' ? (seriesSeasonsData.find(s => s.seasonNumber === selectedSeasonNum)?.episodes || seriesSeasonsData.flatMap(s => s.episodes)) : undefined}
          onSelectMedia={(next: any) => {
            setActiveVodPlayer(next);
            setSelectedChannel(next);
          }}
        />
      )}

      {/* Parental PIN Modal */}
      {showPinModal && activePlaylist?.pin && (
        <PinUnlockModal
          isOpen={showPinModal}
          onClose={onBack}
          onSuccess={() => {
            setIsUnlocked(true);
            setShowPinModal(false);
          }}
          correctPin={activePlaylist.pin}
          playlistName={activePlaylist.name}
          language={settings.language}
        />
      )}
      {showEpgGrid && (
        <EPGGrid
          isOpen={showEpgGrid}
          onClose={() => setShowEpgGrid(false)}
          channels={channels.filter(c => !isMovieItem(c.name) && !isSeriesItem(c.name)).map((c: any) => ({
            id: c.stream_id || c.id || String(Math.random()),
            name: c.name,
            logo: c.logo || c.stream_icon,
            url: c.url || '',
            category: c.category || c.category_id || 'عام',
            type: 'live' as const,
            stream_id: c.stream_id
          }))}
          epgData={xmltvData}
          onSelectChannel={(ch) => {
            const found = channels.find((c: any) => (c.stream_id === ch.stream_id) || (c.id === ch.id) || (c.name === ch.name));
            if (found) setSelectedChannel(found);
            setShowEpgGrid(false);
          }}
          onPlayArchive={playArchive}
          settings={settings}
        />
      )}
    </div>
  );
}
