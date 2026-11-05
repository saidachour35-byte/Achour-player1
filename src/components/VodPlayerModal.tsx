import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Sliders,
  Subtitles as SubtitleIcon,
  Languages,
  Maximize2,
  ListVideo,
  Clock,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Check,
  Zap,
  Settings,
  PlayCircle
} from 'lucide-react';
import { VodItem, SeriesEpisode } from '../types';
import { pushBackHandler } from '../utils/tvNavigation';

export interface VodPlayerModalProps {
  item?: VodItem;
  media?: any;
  episodes?: SeriesEpisode[];
  episodesList?: any[];
  currentEpisodeIndex?: number;
  mediaType?: 'movie' | 'series';
  activePlaylist?: any;
  settings?: any;
  isRtl?: boolean;
  onClose: () => void;
  onSelectEpisode?: (index: number) => void;
  onSelectMedia?: (media: any) => void;
  onToggleFavorite?: (item: any) => void;
  isFavorite?: boolean;
}

type AspectRatioMode = 'fit' | 'fill' | 'zoom' | '16:9' | '4:3';
type ActivePopup = 'none' | 'audio' | 'subtitles' | 'quality' | 'aspect' | 'speed' | 'sleep' | 'episodes' | 'subtitle-settings';

const extractAudioTracksFromManifest = (manifestText: string, streamUrl: string) => {
  const tracks: Array<{ id: number; name: string; lang: string }> = [];
  const regex = /#EXT-X-MEDIA:TYPE=AUDIO[^\n]*?NAME="([^"]+)"[^\n]*?(?:LANGUAGE="([^"]+)")?/gi;
  let match;
  let idx = 0;
  while ((match = regex.exec(manifestText)) !== null) {
    const name = match[1];
    const lang = match[2] || name;
    tracks.push({
      id: idx++,
      name: name,
      lang: lang
    });
  }
  if (tracks.length === 0 && streamUrl) {
    try {
      const u = new URL(streamUrl);
      const audioParam = u.searchParams.get('audio') || u.searchParams.get('lang') || u.searchParams.get('audio_track');
      if (audioParam) {
        tracks.push({
          id: 0,
          name: `Audio (${audioParam})`,
          lang: audioParam
        });
      }
    } catch (e) {}
  }
  return tracks;
};

export const VodPlayerModal: React.FC<VodPlayerModalProps> = ({
  item,
  media,
  episodes,
  episodesList,
  currentEpisodeIndex = 0,
  mediaType = 'movie',
  activePlaylist,
  settings,
  isRtl = true,
  onClose,
  onSelectEpisode,
  onSelectMedia,
  onToggleFavorite,
  isFavorite = false
}) => {
  const activeVod = item || media || {};
  const vodEpisodes = episodes || episodesList || [];

  // Video element and container refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoNextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  // Playback States
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [buffered, setBuffered] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioMode>('fit');
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isSeeking, setIsSeeking] = useState<boolean>(false);

  // Resume State
  const [showResumePrompt, setShowResumePrompt] = useState<boolean>(false);
  const [savedResumeTime, setSavedResumeTime] = useState<number>(0);

  // Auto-Next Episode State
  const [showAutoNextPrompt, setShowAutoNextPrompt] = useState<boolean>(false);
  const [autoNextCountdown, setAutoNextCountdown] = useState<number>(10);

  // Popups & Active Drawers
  const [activePopup, setActivePopup] = useState<ActivePopup>('none');

  // HLS & Stream Specs
  const [audioTracks, setAudioTracks] = useState<Array<{ id: number; name: string; lang: string }>>([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number>(-1);
  
  const [hlsQualities, setHlsQualities] = useState<Array<{ id: number; height: number; bitrate: number; name: string }>>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1); // -1 is Auto
  const [realResolution, setRealResolution] = useState<string>('');

  // Subtitle States
  const [subtitles, setSubtitles] = useState<Array<{ id: number; name: string; lang: string; mode: string }>>([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState<number>(-1); // -1 is Off
  const [subSyncOffset, setSubSyncOffset] = useState<number>(0); // Seconds offset (-5 to +5)
  const [subFontSize, setSubFontSize] = useState<'sm' | 'md' | 'lg' | 'xl'>('lg');
  const [subColor, setSubColor] = useState<string>('#FFFFFF');
  const [subBg, setSubBg] = useState<'none' | 'semi' | 'black'>('semi');

  // Sleep Timer
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [sleepTimerTimeLeft, setSleepTimerTimeLeft] = useState<number | null>(null);

  // Key debouncing
  const lastKeyTimeRef = useRef<number>(0);

  // Stream URL resolver
  const vodId = activeVod.id || activeVod.stream_id || activeVod.title || 'vod_1';
  const streamUrl = activeVod.stream_url || activeVod.url || activeVod.direct_source || '';
  const isSeries = mediaType === 'series' || (vodEpisodes && vodEpisodes.length > 0);
  const currentEpisode = isSeries ? vodEpisodes[currentEpisodeIndex] : null;
  const activeStreamUrl = currentEpisode?.stream_url || currentEpisode?.url || currentEpisode?.direct_source || streamUrl;
  
  const displayTitle = isSeries
    ? `${activeVod.title || activeVod.name || 'مسلسل'} - S${currentEpisode?.season_num || 1} E${currentEpisode?.episode_num || currentEpisodeIndex + 1}: ${currentEpisode?.title || currentEpisode?.name || ''}`
    : activeVod.title || activeVod.name || 'عرض فيديو';

  // 1. Initialize Player & Load Stream
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeStreamUrl) return;

    // Check for saved progress
    const progressKey = `vod_progress_${vodId}_${currentEpisodeIndex}`;
    const savedProgress = localStorage.getItem(progressKey);
    if (savedProgress) {
      const parsedTime = parseFloat(savedProgress);
      if (!isNaN(parsedTime) && parsedTime > 15) {
        setSavedResumeTime(parsedTime);
        setShowResumePrompt(true);
      }
    }

    if (Hls.isSupported() && activeStreamUrl.includes('.m3u8')) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      const hls = new Hls({
        enableWorker: false, // Critical for Fire TV and Android TV stability
        lowLatencyMode: false,
        backBufferLength: 30
      });

      hlsRef.current = hls;
      hls.loadSource(activeStreamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const qualities = data.levels.map((lvl, index) => ({
          id: index,
          height: lvl.height || 0,
          bitrate: lvl.bitrate || 0,
          name: lvl.height ? `${lvl.height}p` : `Level ${index + 1}`
        }));
        setHlsQualities(qualities);

        let extractedTracks: Array<{ id: number; name: string; lang: string }> = [];
        if (hls.audioTracks && hls.audioTracks.length > 0) {
          extractedTracks = hls.audioTracks.map((tr, index) => ({
            id: index,
            name: tr.name || tr.lang || `الصوت ${index + 1}`,
            lang: tr.lang || ''
          }));
          setSelectedAudioTrack(hls.audioTrack);
        }

        if (activeStreamUrl.includes('.m3u8')) {
          fetch(activeStreamUrl)
            .then(res => res.text())
            .then(text => {
              const manifestAudioTracks = extractAudioTracksFromManifest(text, activeStreamUrl);
              if (manifestAudioTracks.length > 0) {
                setAudioTracks(manifestAudioTracks);
              } else if (extractedTracks.length > 0) {
                setAudioTracks(extractedTracks);
              }
            })
            .catch(() => {
              if (extractedTracks.length > 0) setAudioTracks(extractedTracks);
            });
        } else {
          if (extractedTracks.length > 0) setAudioTracks(extractedTracks);
        }

        if (isPlaying) {
          video.play().catch(() => setIsPlaying(false));
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        const level = hls.levels[data.level];
        if (level && level.height) {
          setRealResolution(`${level.width || 1280}x${level.height}`);
        }
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        setSelectedAudioTrack(data.id);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl') || activeStreamUrl.match(/\.(mp4|mkv|webm|m3u8)($|\?)/i)) {
      video.src = activeStreamUrl;
      if (isPlaying) {
        video.play().catch(() => setIsPlaying(false));
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeStreamUrl, currentEpisodeIndex, vodId]);

  // 2. Video Events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetaData = () => {
      setDuration(video.duration || 0);
      if (video.videoWidth && video.videoHeight) {
        setRealResolution(`${video.videoWidth}x${video.videoHeight}`);
      }

      const tracks: Array<{ id: number; name: string; lang: string; mode: string }> = [];
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        tracks.push({
          id: i,
          name: track.label || track.language || `ترجمة ${i + 1}`,
          lang: track.language || '',
          mode: track.mode
        });
      }
      setSubtitles(tracks);
    };

    const handleTimeUpdate = () => {
      if (!isSeeking) {
        setCurrentTime(video.currentTime);
        if (Math.floor(video.currentTime) % 5 === 0 && video.duration > 0) {
          const progressKey = `vod_progress_${vodId}_${currentEpisodeIndex}`;
          localStorage.setItem(progressKey, video.currentTime.toString());
        }
      }

      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      if (isSeries && currentEpisodeIndex < (vodEpisodes.length - 1)) {
        // Auto-play next episode immediately without prompt
        handleNextEpisode();
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetaData);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetaData);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, [isSeeking, isSeries, currentEpisodeIndex, vodEpisodes.length, vodId]);

  // 3. Auto-Next Countdown
  useEffect(() => {
    if (!showAutoNextPrompt) return;

    if (autoNextCountdown <= 0) {
      handleNextEpisode();
      setShowAutoNextPrompt(false);
      return;
    }

    autoNextTimeoutRef.current = setTimeout(() => {
      setAutoNextCountdown((prev) => prev - 1);
    }, 1000);

    return () => {
      if (autoNextTimeoutRef.current) clearTimeout(autoNextTimeoutRef.current);
    };
  }, [showAutoNextPrompt, autoNextCountdown]);

  // 4. Sleep Timer
  useEffect(() => {
    if (sleepTimerMinutes === null) {
      setSleepTimerTimeLeft(null);
      return;
    }

    setSleepTimerTimeLeft(sleepTimerMinutes * 60);
    const interval = setInterval(() => {
      setSleepTimerTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          if (videoRef.current) {
            videoRef.current.pause();
            setIsPlaying(false);
          }
          setSleepTimerMinutes(null);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [sleepTimerMinutes]);

  // 5. Controls Auto-Hide
  const resetControlsTimeout = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && activePopup === 'none' && !showResumePrompt && !showAutoNextPrompt) {
        setShowControls(false);
      }
    }, 5000);
  }, [isPlaying, activePopup, showResumePrompt, showAutoNextPrompt]);

  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying, activePopup, resetControlsTimeout]);

  // Actions
  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      setShowControls(true);
    } else {
      video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      resetControlsTimeout();
    }
  };

  const handleSeekChange = (newTime: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSkipTime = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, Math.min(duration, video.currentTime + seconds));
    video.currentTime = target;
    setCurrentTime(target);
    resetControlsTimeout();
  };

  const handleSelectAudioTrack = (trackId: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackId;
      setSelectedAudioTrack(trackId);
    }
    setActivePopup('none');
  };

  const handleSelectQuality = (qualityId: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = qualityId;
      setSelectedQuality(qualityId);
    }
    setActivePopup('none');
  };

  const handleSelectSubtitle = (subId: number) => {
    const video = videoRef.current;
    if (!video) return;

    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = i === subId ? 'showing' : 'disabled';
    }
    setSelectedSubtitle(subId);
    setActivePopup('none');
  };

  const handleSubSyncChange = (delta: number) => {
    const video = videoRef.current;
    setSubSyncOffset((prev) => {
      const next = parseFloat((prev + delta).toFixed(1));
      if (video) {
        for (let i = 0; i < video.textTracks.length; i++) {
          const track = video.textTracks[i];
          if (track.cues) {
            for (let j = 0; j < track.cues.length; j++) {
              const cue = track.cues[j] as VTTCue;
              cue.startTime += delta;
              cue.endTime += delta;
            }
          }
        }
      }
      return next;
    });
  };

  const handleResumeConfirm = (resume: boolean) => {
    setShowResumePrompt(false);
    const video = videoRef.current;
    if (!video) return;

    if (resume && savedResumeTime > 0) {
      video.currentTime = savedResumeTime;
      setCurrentTime(savedResumeTime);
    } else {
      video.currentTime = 0;
      setCurrentTime(0);
      const progressKey = `vod_progress_${vodId}_${currentEpisodeIndex}`;
      localStorage.removeItem(progressKey);
    }
    video.play().then(() => setIsPlaying(true)).catch(() => {});
  };

  const handleNextEpisode = () => {
    if (isSeries && currentEpisodeIndex < vodEpisodes.length - 1) {
      if (onSelectEpisode) {
        onSelectEpisode(currentEpisodeIndex + 1);
      } else if (onSelectMedia && vodEpisodes[currentEpisodeIndex + 1]) {
        onSelectMedia(vodEpisodes[currentEpisodeIndex + 1]);
      }
      setShowAutoNextPrompt(false);
    }
  };

  const handlePrevEpisode = () => {
    if (isSeries && currentEpisodeIndex > 0) {
      if (onSelectEpisode) {
        onSelectEpisode(currentEpisodeIndex - 1);
      } else if (onSelectMedia && vodEpisodes[currentEpisodeIndex - 1]) {
        onSelectMedia(vodEpisodes[currentEpisodeIndex - 1]);
      }
    }
  };

  // Register pushBackHandler for TV remote and Android Phone back button
  useEffect(() => {
    const unregister = pushBackHandler(() => {
      if (showResumePrompt) {
        handleResumeConfirm(false);
        return true;
      }
      if (showAutoNextPrompt) {
        setShowAutoNextPrompt(false);
        return true;
      }
      if (activePopup !== 'none') {
        setActivePopup('none');
        return true;
      }
      onClose();
      return true;
    });

    return unregister;
  }, [showResumePrompt, showAutoNextPrompt, activePopup, onClose]);

  // D-Pad Remote Navigation Key Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      if (now - lastKeyTimeRef.current < 120) return;
      lastKeyTimeRef.current = now;

      resetControlsTimeout();

      if (e.key === 'Escape' || e.key === 'Back' || e.keyCode === 10009 || e.keyCode === 461) {
        e.preventDefault();
        e.stopPropagation();

        if (showResumePrompt) {
          handleResumeConfirm(false);
          return;
        }

        if (showAutoNextPrompt) {
          setShowAutoNextPrompt(false);
          return;
        }

        if (activePopup !== 'none') {
          setActivePopup('none');
          if (lastFocusedElementRef.current) {
            lastFocusedElementRef.current.focus();
          }
          return;
        }

        if (showControls) {
          setShowControls(false);
          return;
        }

        onClose();
        return;
      }

      const key = e.key;

      if (!showControls) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(key)) {
          setShowControls(true);
          return;
        }
      }

      if (activePopup !== 'none') {
        const popupEl = containerRef.current?.querySelector('.vod-popup-container, .vod-drawer-container');
        if (popupEl) {
          const focusableItems = Array.from(
            popupEl.querySelectorAll<HTMLElement>('button, [tabindex="0"]')
          );

          if (focusableItems.length > 0) {
            const activeIdx = focusableItems.findIndex((el) => el === document.activeElement);

            if (key === 'ArrowDown') {
              e.preventDefault();
              const nextIdx = activeIdx < focusableItems.length - 1 ? activeIdx + 1 : 0;
              focusableItems[nextIdx].focus();
            } else if (key === 'ArrowUp') {
              e.preventDefault();
              const prevIdx = activeIdx > 0 ? activeIdx - 1 : focusableItems.length - 1;
              focusableItems[prevIdx].focus();
            } else if (key === 'Enter' || key === ' ') {
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.click();
              }
            }
          }
        }
        return;
      }

      const controlButtons = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>('[data-tv-focusable="true"]') || []
      );

      if (controlButtons.length === 0) return;

      const currentActive = document.activeElement as HTMLElement;
      let currentIndex = controlButtons.indexOf(currentActive);
      if (currentIndex === -1) currentIndex = 0;

      if (key === 'ArrowRight') {
        if (currentActive.classList.contains('vod-seekbar-input')) {
          e.preventDefault();
          handleSkipTime(-10);
        } else {
          e.preventDefault();
          const nextIdx = (currentIndex + 1) % controlButtons.length;
          controlButtons[nextIdx].focus();
        }
      } else if (key === 'ArrowLeft') {
        if (currentActive.classList.contains('vod-seekbar-input')) {
          e.preventDefault();
          handleSkipTime(10);
        } else {
          e.preventDefault();
          const prevIdx = (currentIndex - 1 + controlButtons.length) % controlButtons.length;
          controlButtons[prevIdx].focus();
        }
      } else if (key === 'ArrowUp') {
        e.preventDefault();
        if (currentActive.classList.contains('vod-bottom-btn')) {
          const seekbar = containerRef.current?.querySelector<HTMLElement>('.vod-seekbar-input');
          if (seekbar) seekbar.focus();
        } else if (currentActive.classList.contains('vod-seekbar-input')) {
          const centerPlayBtn = containerRef.current?.querySelector<HTMLElement>('.vod-center-play-btn');
          if (centerPlayBtn) centerPlayBtn.focus();
        } else if (currentActive.classList.contains('vod-center-play-btn')) {
          const topBackBtn = containerRef.current?.querySelector<HTMLElement>('.vod-top-back-btn');
          if (topBackBtn) topBackBtn.focus();
        }
      } else if (key === 'ArrowDown') {
        e.preventDefault();
        if (currentActive.classList.contains('vod-top-back-btn')) {
          const centerPlayBtn = containerRef.current?.querySelector<HTMLElement>('.vod-center-play-btn');
          if (centerPlayBtn) centerPlayBtn.focus();
        } else if (currentActive.classList.contains('vod-center-play-btn')) {
          const seekbar = containerRef.current?.querySelector<HTMLElement>('.vod-seekbar-input');
          if (seekbar) seekbar.focus();
        } else if (currentActive.classList.contains('vod-seekbar-input')) {
          const playPauseBtn = containerRef.current?.querySelector<HTMLElement>('.vod-bottom-play-btn');
          if (playPauseBtn) playPauseBtn.focus();
        }
      } else if (key === 'Enter' || key === ' ') {
        if (currentActive && currentActive.click) {
          currentActive.click();
        } else {
          togglePlayPause();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showControls, activePopup, showResumePrompt, showAutoNextPrompt, isPlaying, duration, resetControlsTimeout]);

  const openPopup = (type: ActivePopup, triggerEl?: HTMLElement | null) => {
    if (triggerEl) {
      lastFocusedElementRef.current = triggerEl;
    }
    setActivePopup(type);
    setShowControls(true);

    setTimeout(() => {
      const popup = containerRef.current?.querySelector('.vod-popup-container, .vod-drawer-container');
      const firstBtn = popup?.querySelector<HTMLElement>('button, [tabindex="0"]');
      if (firstBtn) firstBtn.focus();
    }, 50);
  };

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const pad = (num: number) => num.toString().padStart(2, '0');

    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  };

  const getAspectRatioClass = () => {
    switch (aspectRatio) {
      case 'fill':
        return 'object-cover w-full h-full';
      case 'zoom':
        return 'object-none scale-125 w-full h-full';
      case '16:9':
        return 'object-contain aspect-video w-full h-full';
      case '4:3':
        return 'object-contain aspect-[4/3] w-full h-full';
      case 'fit':
      default:
        return 'object-contain w-full h-full';
    }
  };

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden select-none font-sans text-white ${isRtl ? 'dir-rtl' : 'dir-ltr'}`}
      onMouseMove={resetControlsTimeout}
      onClick={resetControlsTimeout}
      tabIndex={-1}
    >
      {/* 1. Main Video Container */}
      <div className="relative w-full h-full flex items-center justify-center bg-black">
        <video
          ref={videoRef}
          className={`transition-all duration-300 ${getAspectRatioClass()}`}
          playsInline
          autoPlay
          onClick={togglePlayPause}
        />

        <style>{`
          video::cue {
            font-size: ${
              subFontSize === 'sm'
                ? '1rem'
                : subFontSize === 'md'
                ? '1.35rem'
                : subFontSize === 'lg'
                ? '1.8rem'
                : '2.4rem'
            } !important;
            color: ${subColor} !important;
            background-color: ${
              subBg === 'none'
                ? 'transparent'
                : subBg === 'black'
                ? 'rgba(0, 0, 0, 0.95)'
                : 'rgba(0, 0, 0, 0.65)'
            } !important;
            text-shadow: 0 2px 4px rgba(0,0,0,0.8);
            font-family: inherit;
          }
        `}</style>

        {/* 2. Sleep Timer Badge */}
        {sleepTimerTimeLeft !== null && (
          <div className="absolute top-4 left-4 z-40 bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-gold/40 text-gold flex items-center gap-2 text-xs font-mono shadow-lg">
            <Clock className="w-3.5 h-3.5 animate-pulse" />
            <span>إيقاف تلقائي: {formatTime(sleepTimerTimeLeft)}</span>
          </div>
        )}

        {/* 3. Auto-Next Episode Overlay */}
        {showAutoNextPrompt && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-6">
            <div className="bg-gray-900 border border-gold/40 rounded-2xl p-6 max-w-md w-full text-center shadow-2xl space-y-4">
              <div className="w-14 h-14 bg-gold/10 text-gold rounded-full flex items-center justify-center mx-auto border border-gold/30">
                <Play className="w-7 h-7 fill-current mr-0.5" />
              </div>
              <h3 className="text-xl font-bold text-white">الحلقة التالية بعد {autoNextCountdown} ثوانٍ</h3>
              <p className="text-sm text-gray-300">
                {vodEpisodes[currentEpisodeIndex + 1]?.title || `الحلقة ${currentEpisodeIndex + 2}`}
              </p>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={handleNextEpisode}
                  tabIndex={0}
                  className="px-6 py-2.5 rounded-xl bg-gold hover:bg-gold-light text-black font-bold text-sm shadow-lg transition-transform active:scale-95 focus:ring-2 focus:ring-gold"
                >
                  تشغيل الآن
                </button>
                <button
                  onClick={() => setShowAutoNextPrompt(false)}
                  tabIndex={0}
                  className="px-5 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-semibold border border-gray-700 focus:ring-2 focus:ring-gold"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 4. Resume Last Position Prompt */}
        {showResumePrompt && (
          <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-6">
            <div className="bg-gray-900 border border-gold/40 rounded-2xl p-6 max-w-md w-full text-center shadow-2xl space-y-4">
              <div className="w-14 h-14 bg-gold/10 text-gold rounded-full flex items-center justify-center mx-auto border border-gold/30">
                <RotateCcw className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-bold text-white">استئناف المشاهدة</h3>
              <p className="text-sm text-gray-300">
                هل ترغب في مواصلة العرض من الدقيقة <span className="text-gold font-mono font-bold">{formatTime(savedResumeTime)}</span>؟
              </p>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => handleResumeConfirm(true)}
                  tabIndex={0}
                  className="px-6 py-2.5 rounded-xl bg-gold hover:bg-gold-light text-black font-bold text-sm shadow-lg transition-transform active:scale-95 focus:ring-2 focus:ring-gold"
                >
                  متابعة من حيث توقفت
                </button>
                <button
                  onClick={() => handleResumeConfirm(false)}
                  tabIndex={0}
                  className="px-5 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-semibold border border-gray-700 focus:ring-2 focus:ring-gold"
                >
                  بدء من البداية
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 5. Center Play/Pause Large Action Indicator */}
        {showControls && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <button
              onClick={togglePlayPause}
              data-tv-focusable="true"
              tabIndex={0}
              className="vod-center-play-btn pointer-events-auto w-20 h-20 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md text-gold border border-gold/40 flex items-center justify-center transition-all transform hover:scale-110 active:scale-95 shadow-2xl focus:ring-4 focus:ring-gold"
            >
              {isPlaying ? (
                <Pause className="w-10 h-10 fill-current" />
              ) : (
                <Play className="w-10 h-10 fill-current mr-1" />
              )}
            </button>
          </div>
        )}

        {/* 6. Player Top Header Control Bar */}
        <div
          className={`absolute top-0 inset-x-0 z-30 p-4 bg-gradient-to-b from-black/90 via-black/50 to-transparent transition-opacity duration-300 flex items-center justify-between ${
            showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onClose}
              data-tv-focusable="true"
              tabIndex={0}
              className="vod-top-back-btn p-2.5 rounded-xl bg-gray-900/80 hover:bg-gray-800 text-gray-200 border border-gray-700/60 focus:ring-2 focus:ring-gold transition-colors flex items-center gap-2"
              title="رجوع"
            >
              <ChevronRight className="w-5 h-5 text-gold" />
              <span className="text-sm font-semibold hidden sm:inline">إغلاق</span>
            </button>

            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white truncate max-w-md sm:max-w-xl">
                {displayTitle}
              </h2>
              {realResolution && (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-gold/20 text-gold border border-gold/30">
                    {realResolution}
                  </span>
                  {activeVod.container_extension && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-gray-800 text-gray-300 border border-gray-700 uppercase">
                      {activeVod.container_extension}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Top Actions */}
          <div className="flex items-center gap-2">
            {onToggleFavorite && (
              <button
                onClick={() => onToggleFavorite(activeVod)}
                data-tv-focusable="true"
                tabIndex={0}
                className={`p-2.5 rounded-xl border transition-colors focus:ring-2 focus:ring-gold ${
                  isFavorite
                    ? 'bg-gold/20 border-gold/50 text-gold'
                    : 'bg-gray-900/80 border-gray-700/60 text-gray-300 hover:bg-gray-800'
                }`}
                title={isFavorite ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
              >
                <Sparkles className="w-5 h-5" />
              </button>
            )}

            {/* Episode button moved to bottom */}
          </div>
        </div>

        {/* 7. Player Bottom Footer Controls Bar */}
        <div
          className={`absolute bottom-0 inset-x-0 z-30 p-4 sm:p-6 bg-gradient-to-t from-black/95 via-black/75 to-transparent transition-opacity duration-300 space-y-3 ${
            showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-mono text-gray-300 px-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <div className="relative flex items-center">
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={(e) => handleSeekChange(parseFloat(e.target.value))}
                data-tv-focusable="true"
                tabIndex={0}
                className="vod-seekbar-input w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-gold focus:outline-none focus:ring-2 focus:ring-gold"
                style={{
                  background: `linear-gradient(to left, var(--theme-primary, #e5a00d) ${
                    (currentTime / (duration || 1)) * 100
                  }%, rgba(255, 255, 255, 0.2) ${(currentTime / (duration || 1)) * 100}%)`
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-2">
              <button
                onClick={togglePlayPause}
                data-tv-focusable="true"
                tabIndex={0}
                className="vod-bottom-btn vod-bottom-play-btn p-3 rounded-xl bg-gold hover:bg-gold-light text-black font-bold focus:ring-4 focus:ring-amber-300 focus:bg-amber-400 focus:scale-110 shadow-xl transition-all cursor-pointer outline-none"
                title={isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current mr-0.5" />}
              </button>

              <button
                onClick={() => handleSkipTime(-10)}
                data-tv-focusable="true"
                tabIndex={0}
                className="vod-bottom-btn p-3 rounded-xl bg-gray-900/90 hover:bg-gray-800 text-gray-200 border border-gray-700/60 focus:ring-4 focus:ring-amber-300 focus:bg-amber-500 focus:text-black focus:scale-110 shadow-xl transition-all cursor-pointer outline-none"
                title="إرجاع 10 ثوانٍ"
              >
                <RotateCcw className="w-5 h-5" />
              </button>

              <button
                onClick={() => handleSkipTime(10)}
                data-tv-focusable="true"
                tabIndex={0}
                className="vod-bottom-btn p-3 rounded-xl bg-gray-900/90 hover:bg-gray-800 text-gray-200 border border-gray-700/60 focus:ring-4 focus:ring-amber-300 focus:bg-amber-500 focus:text-black focus:scale-110 shadow-xl transition-all cursor-pointer outline-none"
                title="تقديم 10 ثوانٍ"
              >
                <RotateCw className="w-5 h-5" />
              </button>

              {isSeries && (
                <>
                  <button
                    onClick={handlePrevEpisode}
                    disabled={currentEpisodeIndex <= 0}
                    data-tv-focusable="true"
                    tabIndex={0}
                    className="vod-bottom-btn p-3 rounded-xl bg-gray-900/90 hover:bg-gray-800 text-gray-200 border border-gray-700/60 disabled:opacity-40 focus:ring-4 focus:ring-amber-300 focus:bg-amber-500 focus:text-black focus:scale-110 shadow-xl transition-all cursor-pointer outline-none"
                    title="الحلقة السابقة"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleNextEpisode}
                    disabled={currentEpisodeIndex >= vodEpisodes.length - 1}
                    data-tv-focusable="true"
                    tabIndex={0}
                    className="vod-bottom-btn p-3 rounded-xl bg-gray-900/90 hover:bg-gray-800 text-gray-200 border border-gray-700/60 disabled:opacity-40 focus:ring-4 focus:ring-amber-300 focus:bg-amber-500 focus:text-black focus:scale-110 shadow-xl transition-all cursor-pointer outline-none"
                    title="الحلقة التالية"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
              <button
                onClick={(e) => openPopup('audio', e.currentTarget)}
                data-tv-focusable="true"
                tabIndex={0}
                className={`vod-bottom-btn p-3 rounded-xl border transition-all flex items-center gap-2 text-xs font-semibold focus:ring-4 focus:ring-amber-300 focus:bg-amber-500 focus:text-black focus:scale-110 shadow-xl cursor-pointer outline-none ${
                  activePopup === 'audio'
                    ? 'bg-gold/20 border-gold text-gold'
                    : 'bg-gray-900/90 border-gray-700/60 text-gray-200 hover:bg-gray-800'
                }`}
                title="مسارات الصوت"
              >
                <Languages className="w-5 h-5 text-gold" />
                <span className="hidden md:inline">الصوت</span>
              </button>

              <button
                onClick={(e) => openPopup('subtitles', e.currentTarget)}
                data-tv-focusable="true"
                tabIndex={0}
                className={`vod-bottom-btn p-3 rounded-xl border transition-all flex items-center gap-2 text-xs font-semibold focus:ring-4 focus:ring-amber-300 focus:bg-amber-500 focus:text-black focus:scale-110 shadow-xl cursor-pointer outline-none ${
                  selectedSubtitle !== -1 || activePopup === 'subtitles'
                    ? 'bg-gold/20 border-gold text-gold'
                    : 'bg-gray-900/90 border-gray-700/60 text-gray-200 hover:bg-gray-800'
                }`}
                title="الترجمة"
              >
                <SubtitleIcon className="w-5 h-5 text-gold" />
                <span className="hidden md:inline">الترجمة</span>
              </button>

              <button
                onClick={(e) => openPopup('quality', e.currentTarget)}
                data-tv-focusable="true"
                tabIndex={0}
                className={`vod-bottom-btn p-3 rounded-xl border transition-all flex items-center gap-2 text-xs font-semibold focus:ring-4 focus:ring-amber-300 focus:bg-amber-500 focus:text-black focus:scale-110 shadow-xl cursor-pointer outline-none ${
                  activePopup === 'quality'
                    ? 'bg-gold/20 border-gold text-gold'
                    : 'bg-gray-900/90 border-gray-700/60 text-gray-200 hover:bg-gray-800'
                }`}
                title="الجودة"
              >
                <Zap className="w-5 h-5 text-gold" />
                <span className="hidden md:inline">الجودة</span>
              </button>

              <button
                onClick={(e) => openPopup('aspect', e.currentTarget)}
                data-tv-focusable="true"
                tabIndex={0}
                className={`vod-bottom-btn p-3 rounded-xl border transition-all flex items-center gap-2 text-xs font-semibold focus:ring-4 focus:ring-amber-300 focus:bg-amber-500 focus:text-black focus:scale-110 shadow-xl cursor-pointer outline-none ${
                  activePopup === 'aspect'
                    ? 'bg-gold/20 border-gold text-gold'
                    : 'bg-gray-900/90 border-gray-700/60 text-gray-200 hover:bg-gray-800'
                }`}
                title="نسبة الشاشة"
              >
                <Maximize2 className="w-5 h-5 text-gold" />
                <span className="hidden md:inline">الأبعاد</span>
              </button>

              <button
                onClick={(e) => openPopup('speed', e.currentTarget)}
                data-tv-focusable="true"
                tabIndex={0}
                className={`vod-bottom-btn p-3 rounded-xl border transition-all flex items-center gap-2 text-xs font-semibold focus:ring-4 focus:ring-amber-300 focus:bg-amber-500 focus:text-black focus:scale-110 shadow-xl cursor-pointer outline-none ${
                  playbackSpeed !== 1 || activePopup === 'speed'
                    ? 'bg-gold/20 border-gold text-gold'
                    : 'bg-gray-900/90 border-gray-700/60 text-gray-200 hover:bg-gray-800'
                }`}
                title="سرعة التشغيل"
              >
                <Sliders className="w-5 h-5 text-gold" />
                <span className="hidden md:inline">{playbackSpeed}x</span>
              </button>

              <button
                onClick={(e) => openPopup('sleep', e.currentTarget)}
                data-tv-focusable="true"
                tabIndex={0}
                className={`vod-bottom-btn p-3 rounded-xl border transition-all flex items-center gap-2 text-xs font-semibold focus:ring-4 focus:ring-amber-300 focus:bg-amber-500 focus:text-black focus:scale-110 shadow-xl cursor-pointer outline-none ${
                  sleepTimerMinutes !== null || activePopup === 'sleep'
                    ? 'bg-gold/20 border-gold text-gold'
                    : 'bg-gray-900/90 border-gray-700/60 text-gray-200 hover:bg-gray-800'
                }`}
                title="مؤقت النوم"
              >
                <Clock className="w-5 h-5 text-gold" />
                <span className="hidden md:inline">مؤقت</span>
              </button>

              {isSeries && (
                <button
                  onClick={(e) => openPopup('episodes', e.currentTarget)}
                  data-tv-focusable="true"
                  tabIndex={0}
                  className={`vod-bottom-btn p-2.5 rounded-xl border transition-colors flex items-center gap-1.5 text-xs font-semibold focus:ring-2 focus:ring-gold ${
                    activePopup === 'episodes'
                      ? 'bg-gold/20 border-gold text-gold'
                      : 'bg-gray-900/80 border-gray-700/60 text-gray-300 hover:bg-gray-800'
                  }`}
                  title="قائمة الحلقات"
                >
                  <ListVideo className="w-4 h-4 text-gold" />
                  <span className="hidden md:inline">الحلقات</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 8. POPUPS */}
        {activePopup === 'audio' && (
          <div className="vod-popup-container absolute bottom-24 right-6 z-40 bg-gray-900/95 backdrop-blur-xl border border-gold/40 rounded-2xl p-4 w-72 shadow-2xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <h4 className="text-sm font-bold text-gold flex items-center gap-2">
                <Languages className="w-4 h-4" />
                اختر مسار الصوت
              </h4>
              <button
                onClick={() => setActivePopup('none')}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto no-scrollbar">
              {audioTracks.length > 0 ? (
                audioTracks.map((tr) => (
                  <button
                    key={tr.id}
                    onClick={() => handleSelectAudioTrack(tr.id)}
                    tabIndex={0}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors focus:ring-2 focus:ring-gold ${
                      selectedAudioTrack === tr.id
                        ? 'bg-gold/20 text-gold border border-gold/40'
                        : 'text-gray-200 hover:bg-gray-800'
                    }`}
                  >
                    <span>{tr.name}</span>
                    {selectedAudioTrack === tr.id && <Check className="w-4 h-4" />}
                  </button>
                ))
              ) : (
                <div className="p-3 text-center text-xs text-gray-400">
                  يتوفر المسار الافتراضي للبث فقط
                </div>
              )}
            </div>
          </div>
        )}

        {activePopup === 'subtitles' && (
          <div className="vod-popup-container absolute bottom-24 right-6 z-40 bg-gray-900/95 backdrop-blur-xl border border-gold/40 rounded-2xl p-4 w-80 shadow-2xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <h4 className="text-sm font-bold text-gold flex items-center gap-2">
                <SubtitleIcon className="w-4 h-4" />
                إعدادات ومسارات الترجمة
              </h4>
              <button
                onClick={() => setActivePopup('none')}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1 max-h-40 overflow-y-auto no-scrollbar">
              <button
                onClick={() => handleSelectSubtitle(-1)}
                tabIndex={0}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors focus:ring-2 focus:ring-gold ${
                  selectedSubtitle === -1
                    ? 'bg-gold/20 text-gold border border-gold/40'
                    : 'text-gray-200 hover:bg-gray-800'
                }`}
              >
                <span>إيقاف الترجمة</span>
                {selectedSubtitle === -1 && <Check className="w-4 h-4" />}
              </button>

              {subtitles.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => handleSelectSubtitle(sub.id)}
                  tabIndex={0}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors focus:ring-2 focus:ring-gold ${
                    selectedSubtitle === sub.id
                      ? 'bg-gold/20 text-gold border border-gold/40'
                      : 'text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <span>{sub.name}</span>
                  {selectedSubtitle === sub.id && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>

            <button
              onClick={() => setActivePopup('subtitle-settings')}
              tabIndex={0}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-gold border border-gray-700 focus:ring-2 focus:ring-gold"
            >
              <Settings className="w-3.5 h-3.5" />
              تخصيص الحجم / اللون / المزامنة
            </button>
          </div>
        )}

        {activePopup === 'subtitle-settings' && (
          <div className="vod-popup-container absolute bottom-24 right-6 z-40 bg-gray-900/95 backdrop-blur-xl border border-gold/40 rounded-2xl p-4 w-80 shadow-2xl space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <h4 className="text-sm font-bold text-gold flex items-center gap-2">
                <Settings className="w-4 h-4" />
                تخصيص مظهر الترجمة
              </h4>
              <button
                onClick={() => setActivePopup('subtitles')}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-gray-300 font-medium block">تزامن الترجمة (ثوانٍ):</label>
              <div className="flex items-center justify-between bg-gray-800/80 rounded-xl p-2 border border-gray-700">
                <button
                  onClick={() => handleSubSyncChange(-0.5)}
                  tabIndex={0}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-bold text-gold focus:ring-2 focus:ring-gold"
                >
                  -0.5s
                </button>
                <span className="text-xs font-mono font-bold text-white">{subSyncOffset > 0 ? `+${subSyncOffset}` : subSyncOffset}s</span>
                <button
                  onClick={() => handleSubSyncChange(0.5)}
                  tabIndex={0}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-bold text-gold focus:ring-2 focus:ring-gold"
                >
                  +0.5s
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-gray-300 font-medium block">حجم الخط:</label>
              <div className="grid grid-cols-4 gap-1.5">
                {(['sm', 'md', 'lg', 'xl'] as const).map((sz) => (
                  <button
                    key={sz}
                    onClick={() => setSubFontSize(sz)}
                    tabIndex={0}
                    className={`py-1.5 rounded-lg text-xs font-bold uppercase border focus:ring-2 focus:ring-gold ${
                      subFontSize === sz
                        ? 'bg-gold text-black border-gold'
                        : 'bg-gray-800 text-gray-300 border-gray-700'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-gray-300 font-medium block">لون النص:</label>
              <div className="flex items-center gap-2">
                {[
                  { name: 'أبيض', color: '#FFFFFF' },
                  { name: 'أصفر', color: '#FFD700' },
                  { name: 'سماوي', color: '#00FFFF' },
                  { name: 'أخضر', color: '#00FF00' }
                ].map((c) => (
                  <button
                    key={c.color}
                    onClick={() => setSubColor(c.color)}
                    tabIndex={0}
                    className="w-7 h-7 rounded-full border-2 focus:ring-2 focus:ring-gold flex items-center justify-center"
                    style={{ backgroundColor: c.color, borderColor: subColor === c.color ? 'var(--theme-primary, #e5a00d)' : 'transparent' }}
                  >
                    {subColor === c.color && <Check className="w-4 h-4 text-black" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-gray-300 font-medium block">خلفية النص:</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'none', name: 'بدون' },
                  { id: 'semi', name: 'شافة' },
                  { id: 'black', name: 'سوداء' }
                ].map((bg) => (
                  <button
                    key={bg.id}
                    onClick={() => setSubBg(bg.id as any)}
                    tabIndex={0}
                    className={`py-1.5 rounded-lg text-xs font-bold border focus:ring-2 focus:ring-gold ${
                      subBg === bg.id
                        ? 'bg-gold text-black border-gold'
                        : 'bg-gray-800 text-gray-300 border-gray-700'
                    }`}
                  >
                    {bg.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activePopup === 'quality' && (
          <div className="vod-popup-container absolute bottom-24 right-6 z-40 bg-gray-900/95 backdrop-blur-xl border border-gold/40 rounded-2xl p-4 w-72 shadow-2xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <h4 className="text-sm font-bold text-gold flex items-center gap-2">
                <Zap className="w-4 h-4" />
                جودة العرض
              </h4>
              <button
                onClick={() => setActivePopup('none')}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1 max-h-56 overflow-y-auto no-scrollbar">
              <button
                onClick={() => handleSelectQuality(-1)}
                tabIndex={0}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors focus:ring-2 focus:ring-gold ${
                  selectedQuality === -1
                    ? 'bg-gold/20 text-gold border border-gold/40'
                    : 'text-gray-200 hover:bg-gray-800'
                }`}
              >
                <span>تلقائي (تلقائي الحجم)</span>
                {selectedQuality === -1 && <Check className="w-4 h-4" />}
              </button>

              {hlsQualities.map((q) => (
                <button
                  key={q.id}
                  onClick={() => handleSelectQuality(q.id)}
                  tabIndex={0}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors focus:ring-2 focus:ring-gold ${
                    selectedQuality === q.id
                      ? 'bg-gold/20 text-gold border border-gold/40'
                      : 'text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <span>{q.name}</span>
                  {selectedQuality === q.id && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {activePopup === 'aspect' && (
          <div className="vod-popup-container absolute bottom-24 right-6 z-40 bg-gray-900/95 backdrop-blur-xl border border-gold/40 rounded-2xl p-4 w-64 shadow-2xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <h4 className="text-sm font-bold text-gold flex items-center gap-2">
                <Maximize2 className="w-4 h-4" />
                أبعاد الشاشة
              </h4>
              <button
                onClick={() => setActivePopup('none')}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              {[
                { id: 'fit', label: 'تناسب تلقائي (Fit)' },
                { id: 'fill', label: 'تعبئة الشاشة (Fill)' },
                { id: 'zoom', label: 'تكبير (Zoom)' },
                { id: '16:9', label: '16:9 العريض' },
                { id: '4:3', label: '4:3 الكلاسيكي' }
              ].map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => {
                    setAspectRatio(mode.id as AspectRatioMode);
                    setActivePopup('none');
                  }}
                  tabIndex={0}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors focus:ring-2 focus:ring-gold ${
                    aspectRatio === mode.id
                      ? 'bg-gold/20 text-gold border border-gold/40'
                      : 'text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <span>{mode.label}</span>
                  {aspectRatio === mode.id && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {activePopup === 'speed' && (
          <div className="vod-popup-container absolute bottom-24 right-6 z-40 bg-gray-900/95 backdrop-blur-xl border border-gold/40 rounded-2xl p-4 w-64 shadow-2xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <h4 className="text-sm font-bold text-gold flex items-center gap-2">
                <Sliders className="w-4 h-4" />
                سرعة العرض
              </h4>
              <button
                onClick={() => setActivePopup('none')}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                <button
                  key={speed}
                  onClick={() => {
                    if (videoRef.current) videoRef.current.playbackRate = speed;
                    setPlaybackSpeed(speed);
                    setActivePopup('none');
                  }}
                  tabIndex={0}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors focus:ring-2 focus:ring-gold ${
                    playbackSpeed === speed
                      ? 'bg-gold/20 text-gold border border-gold/40'
                      : 'text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <span>{speed === 1 ? 'سرعة طبيعية (1.0x)' : `${speed}x`}</span>
                  {playbackSpeed === speed && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {activePopup === 'sleep' && (
          <div className="vod-popup-container absolute bottom-24 right-6 z-40 bg-gray-900/95 backdrop-blur-xl border border-gold/40 rounded-2xl p-4 w-64 shadow-2xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <h4 className="text-sm font-bold text-gold flex items-center gap-2">
                <Clock className="w-4 h-4" />
                مؤقت إيقاف التشغيل
              </h4>
              <button
                onClick={() => setActivePopup('none')}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              {[
                { label: 'إيقاف المؤقت', min: null },
                { label: 'بعد 15 دقيقة', min: 15 },
                { label: 'بعد 30 دقيقة', min: 30 },
                { label: 'بعد 45 دقيقة', min: 45 },
                { label: 'بعد 60 دقيقة', min: 60 }
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => {
                    setSleepTimerMinutes(opt.min);
                    setActivePopup('none');
                  }}
                  tabIndex={0}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors focus:ring-2 focus:ring-gold ${
                    sleepTimerMinutes === opt.min
                      ? 'bg-gold/20 text-gold border border-gold/40'
                      : 'text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <span>{opt.label}</span>
                  {sleepTimerMinutes === opt.min && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {activePopup === 'episodes' && isSeries && (
          <div className="vod-drawer-container absolute inset-y-0 right-0 z-50 w-80 sm:w-96 bg-gray-900/95 backdrop-blur-2xl border-l border-gold/30 p-5 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between pb-4 border-b border-gray-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ListVideo className="w-5 h-5 text-gold" />
                حلقات المسلسل
              </h3>
              <button
                onClick={() => setActivePopup('none')}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 py-4 no-scrollbar">
              {vodEpisodes.map((ep, idx) => {
                const isCurrent = idx === currentEpisodeIndex;
                return (
                  <button
                    key={ep.id || idx}
                    onClick={() => {
                      if (onSelectEpisode) {
                        onSelectEpisode(idx);
                      } else if (onSelectMedia) {
                        onSelectMedia(ep);
                      }
                      setActivePopup('none');
                    }}
                    tabIndex={0}
                    className={`w-full p-3 rounded-xl border text-right transition-all flex items-center justify-between gap-3 focus:ring-2 focus:ring-gold ${
                      isCurrent
                        ? 'bg-gold/20 border-gold text-gold shadow-md'
                        : 'bg-gray-800/60 border-gray-700/60 text-gray-200 hover:bg-gray-800'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">
                        S{ep.season_num || 1} E{ep.episode_num || idx + 1}: {ep.title || ep.name || `الحلقة ${idx + 1}`}
                      </div>
                      {ep.duration && (
                        <div className="text-[10px] text-gray-400 mt-0.5">{ep.duration}</div>
                      )}
                    </div>
                    {isCurrent ? (
                      <div className="w-7 h-7 rounded-full bg-gold text-black flex items-center justify-center shrink-0">
                        <Play className="w-4 h-4 fill-current" />
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-gray-700 text-gray-300 flex items-center justify-center shrink-0">
                        <PlayCircle className="w-4 h-4" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VodPlayerModal;
