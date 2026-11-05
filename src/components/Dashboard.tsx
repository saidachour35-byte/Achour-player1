import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import logoImg from '../assets/logo.jpg';
import { 
  Settings, RefreshCcw, LogOut, Plus, Tv, AlertCircle, CheckCircle2, 
  Clock, Upload, FolderPlus, Copy, Eye, Globe, Server, FileText, Check, X, Star,
  Film, Clapperboard, Crown, Calendar, ShieldCheck, AlertTriangle, ChevronRight,
  Bell, Zap, Baby, Mic, Volume2
} from 'lucide-react';
import PlaylistManager from './PlaylistManager';
import LivePlayer from './LivePlayer';
import SettingsView from './SettingsView';
import AddPlaylistModal from './AddPlaylistModal';
import PinUnlockModal from './PinUnlockModal';
import { AppSettings, Channel, Playlist } from '../types';
import { useI18n } from '../utils/i18n';
import { collection, query, where, getDocs, doc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ICON_3D_STYLES } from '../utils/themeManager';
import { syncFavoritesFromFirestore } from '../utils/favoritesService';
import { testXtreamConnection } from '../utils/iptv';
import { fetchChannels, iptvGlobalCache } from '../utils/iptv';
import { parseExpiryDate, fetchLiveSubscriptionExpiry } from '../utils/subscription';
import { navigateSpatial, parseTVKeyEvent, ensureInitialFocus, pushBackHandler } from '../utils/tvNavigation';

interface DashboardProps {
  userId: string;
  settings: AppSettings;
  onUpdateSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  onTriggerSplash?: () => void;
}

type View = 'home' | 'live' | 'movies' | 'series' | 'sports' | 'settings' | 'add';

// Custom SVG Icons matching TV aspect ratio
const Icons = {
  Live: ({ className, strokeWidth = 1.2, fill = 'none' }: { className?: string; strokeWidth?: number; fill?: string }) => (
    <svg viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={strokeWidth} className={className}>
      <path d="M4 6h12v10H4z" />
      <path d="M6 16v2h8v-2M10 18v2M8 20h4" />
      <rect x="17" y="8" width="3" height="6" rx="1" />
      <circle cx="18.5" cy="10" r="0.5" fill="currentColor" />
      <circle cx="18.5" cy="12" r="0.5" fill="currentColor" />
    </svg>
  ),
  Filme: ({ className, strokeWidth = 1, fill = 'none' }: { className?: string; strokeWidth?: number; fill?: string }) => (
    <svg viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={strokeWidth} className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="12" cy="7" r="1.5" />
      <circle cx="12" cy="17" r="1.5" />
      <circle cx="7" cy="12" r="1.5" />
      <circle cx="17" cy="12" r="1.5" />
    </svg>
  ),
  Serie: ({ className, strokeWidth = 1, fill = 'none' }: { className?: string; strokeWidth?: number; fill?: string }) => (
    <svg viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={strokeWidth} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />
      <path d="M10 10l5 2-5 2z" fill="currentColor" />
    </svg>
  ),
  Playlist: ({ className, strokeWidth = 1.2, fill = 'none' }: { className?: string; strokeWidth?: number; fill?: string }) => (
    <svg viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={strokeWidth} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="7" y1="8" x2="17" y2="8" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="7" y1="16" x2="13" y2="16" />
    </svg>
  ),
  VPN: ({ className, enabled, strokeWidth = 1.5 }: { className?: string; enabled?: boolean; strokeWidth?: number }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M12 8v4" strokeLinecap="round" />
      <path d="M12 16h.01" strokeLinecap="round" />
      {enabled && (
        <motion.circle 
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
          cx="12" cy="12" r="3" fill="currentColor" 
        />
      )}
    </svg>
  )
};

export default function Dashboard({ userId, settings, onUpdateSettings, onTriggerSplash }: DashboardProps) {
  const [currentView, setCurrentView] = useState<View>('home');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [activePlaylistData, setActivePlaylistData] = useState<Playlist | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshToast, setRefreshToast] = useState(false);
  const [activePlaylistName, setActivePlaylistName] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showSpeedTest, setShowSpeedTest] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showKidsUnlock, setShowKidsUnlock] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  const active3DStyle = React.useMemo(() => {
    return ICON_3D_STYLES.find(s => s.id === (settings.icon3DStyle || 'style-gold-3d')) || ICON_3D_STYLES[0];
  }, [settings.icon3DStyle]);

  const { t, isRtl } = useI18n(settings.language);

  // Keep clock updated every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync favorites with Firestore profile on mount
  useEffect(() => {
    if (userId) {
      syncFavoritesFromFirestore(userId).catch(() => {});
    }
  }, [userId]);

  const formattedClock = React.useMemo(() => {
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: settings.timeFormat === '12h',
    };
    return currentTime.toLocaleTimeString(settings.language === 'ar' ? 'ar-EG' : settings.language, options);
  }, [currentTime, settings.timeFormat, settings.language]);

  const formattedDate = React.useMemo(() => {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    return currentTime.toLocaleDateString(settings.language === 'ar' ? 'ar-EG' : settings.language, options);
  }, [currentTime, settings.language]);

  // Compute real subscription info strictly extracted from the active link
  const parsedSubscription = React.useMemo(() => {
    if (!activePlaylistData || !activePlaylistData.expDate) return null;
    const parsed = parseExpiryDate(activePlaylistData.expDate, isRtl);
    if (!parsed || !parsed.hasDate) return null;
    return parsed;
  }, [activePlaylistData?.expDate, isRtl]);



  const fetchActivePlaylist = async () => {
    try {
      // 1. Check local playlists first if active
      const localSaved = localStorage.getItem('achour_local_playlists');
      const localList: Playlist[] = localSaved ? JSON.parse(localSaved) : [];

      if (settings.activePlaylistId) {
        const localFound = localList.find(p => p.id === settings.activePlaylistId);
        if (localFound) {
          setActivePlaylistName(localFound.name || 'IPTV');
          setActivePlaylistData(localFound);
          return;
        }

        try {
          const snap = await getDoc(doc(db, 'playlists', settings.activePlaylistId));
          if (snap.exists()) {
            const data = { id: snap.id, ...snap.data() } as Playlist;
            setActivePlaylistName(data.name || 'IPTV');
            setActivePlaylistData(data);
            return;
          }
        } catch (e) {
          handleFirestoreError(e, OperationType.GET, `playlists/${settings.activePlaylistId}`);
        }
      }

      // Check Firestore list
      const playlistsPath = 'playlists';
      try {
        const q = query(collection(db, playlistsPath), where('userId', '==', userId));
        const res = await getDocs(q);
        if (!res.empty) {
          const first = { id: res.docs[0].id, ...res.docs[0].data() } as Playlist;
          setActivePlaylistName(first.name || 'IPTV');
          setActivePlaylistData(first);
          onUpdateSettings(prev => ({ ...prev, activePlaylistId: first.id }));
          return;
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, playlistsPath);
      }

      // Check local list fallback
      if (localList.length > 0) {
        setActivePlaylistName(localList[0].name || 'IPTV');
        setActivePlaylistData(localList[0]);
        onUpdateSettings(prev => ({ ...prev, activePlaylistId: localList[0].id }));
        return;
      }

      setActivePlaylistName('');
      setActivePlaylistData(null);
    } catch (err) {
      console.warn('Could not fetch active playlist name', err);
    }
  };

  useEffect(() => {
    fetchActivePlaylist();
  }, [userId, settings.activePlaylistId]);

  // Pre-load IPTV data
  useEffect(() => {
    if (activePlaylistData) {
      ['live', 'movie', 'series'].forEach(async (type) => {
        try {
          await fetchChannels(activePlaylistData);
        } catch (e) {
          console.warn(`Failed to pre-load ${type} channels:`, e);
        }
      });
    }
  }, [activePlaylistData]);

  // Background fetch/sync of live subscription expiration if not already present
  useEffect(() => {
    if (activePlaylistData && (activePlaylistData.expDate === undefined || activePlaylistData.expDate === null)) {
      fetchLiveSubscriptionExpiry(activePlaylistData).then(exp => {
        if (exp !== null && exp !== undefined) {
          setActivePlaylistData(prev => prev ? ({ ...prev, expDate: exp }) : null);
          try {
            const rawLocal = localStorage.getItem('achour_local_playlists');
            if (rawLocal) {
              const list: Playlist[] = JSON.parse(rawLocal);
              const updated = list.map(p => p.id === activePlaylistData.id ? ({ ...p, expDate: exp }) : p);
              localStorage.setItem('achour_local_playlists', JSON.stringify(updated));
            }
          } catch (e) {}
        }
      }).catch(() => {});
    }
  }, [activePlaylistData?.id, activePlaylistData?.url]);

  // Auto-Initial Focus for TV Remote Navigation
  useEffect(() => {
    if (currentView === 'home') {
      const timer = setTimeout(() => {
        // Focus the first interactive card if nothing or body is focused
        if (!document.activeElement || document.activeElement === document.body) {
          ensureInitialFocus();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentView]);

  // Register comprehensive back handlers for modals, subviews, and home dashboard
  useEffect(() => {
    const unregister = pushBackHandler(() => {
      // 1. Modals take top priority
      if (showAddModal) {
        setShowAddModal(false);
        return true;
      }
      if (showExitModal) {
        setShowExitModal(false);
        return true;
      }
      if (showSpeedTest) {
        setShowSpeedTest(false);
        return true;
      }
      if (showNotifications) {
        setShowNotifications(false);
        return true;
      }
      if (showKidsUnlock) {
        setShowKidsUnlock(false);
        return true;
      }

      // 2. Subviews (live, movies, series, add, settings) return to home
      if (currentView !== 'home') {
        setCurrentView('home');
        return true;
      }

      // 3. On home dashboard, pressing Back exits directly
      handleExitApp();
      return true;

      return false;
    });

    return unregister;
  }, [showAddModal, showExitModal, currentView]);

  // Universal Keyboard & Remote D-Pad Navigation for Dashboard
  useEffect(() => {
    if (currentView !== 'home') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const action = parseTVKeyEvent(e);

      // 1. Navigation Actions (UP, DOWN, LEFT, RIGHT)
      if (action === 'UP') {
        e.preventDefault();
        navigateSpatial('up', document.body, null, isRtl);
        return;
      }
      if (action === 'DOWN') {
        e.preventDefault();
        navigateSpatial('down', document.body, null, isRtl);
        return;
      }
      if (action === 'LEFT') {
        e.preventDefault();
        navigateSpatial('left', document.body, null, isRtl);
        return;
      }
      if (action === 'RIGHT') {
        e.preventDefault();
        navigateSpatial('right', document.body, null, isRtl);
        return;
      }

      // 2. Activation (OK / SELECT / Enter)
      if (action === 'SELECT') {
        const active = document.activeElement as HTMLElement;
        if (active && typeof active.click === 'function') {
          e.preventDefault();
          active.click();
          return;
        }
      }

      // 3. On home dashboard, pressing Back opens exit modal
      if (action === 'BACK') {
        if (!showAddModal) {
          e.preventDefault();
          handleExitApp();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentView, isRtl, showAddModal, showExitModal]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleExitApp = () => {
    setShowExitModal(false);
    const native = (window as any).AchourNative || (window as any).Android || (window as any).JSBridge;
    if (native && typeof native.exitApp === 'function') {
      native.exitApp();
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      window.close();
      // For some smart TVs
      try { (window as any).tizen?.application.getCurrentApplication().exit(); } catch(e){}
      try { (window as any).webOS?.window.close(); } catch(e){}
    }
  };

  if (currentView === 'live') return <LivePlayer onBack={() => setCurrentView('home')} settings={settings} onUpdateSettings={onUpdateSettings} userId={userId} />;
  if (currentView === 'movies') return <LivePlayer onBack={() => setCurrentView('home')} settings={settings} onUpdateSettings={onUpdateSettings} userId={userId} initialType="movie" />;
  if (currentView === 'series') return <LivePlayer onBack={() => setCurrentView('home')} settings={settings} onUpdateSettings={onUpdateSettings} userId={userId} initialType="series" />;
  
  if (currentView === 'add') return <PlaylistManager onBack={() => setCurrentView('home')} userId={userId} settings={settings} onUpdateSettings={onUpdateSettings} />;

  if (currentView === 'settings') return (
    <SettingsView 
      onBack={() => setCurrentView('home')} 
      settings={settings} 
      onUpdateSettings={onUpdateSettings} 
      userId={userId}
      onTriggerSplash={onTriggerSplash}
    />
  );
  return (
    <>
      <div className={`relative min-h-screen w-full bg-transparent flex flex-col select-none overflow-hidden ${isRtl ? 'text-right font-cairo' : 'text-left font-sans'}`}>
      {/* Background Sparkles */}
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[1vw] h-[1vw] bg-gold rounded-full blur-[2px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[0.5vw] h-[0.5vw] bg-white rounded-full blur-[1px] animate-bokeh" />
      </div>


      {/* Top Header Bar - Symmetrical 3-Column Layout */}
        <div className="relative z-20 flex items-center justify-between gap-4 mb-6 px-6 pt-4 shrink-0 w-full max-w-7xl mx-auto">
          {/* Part 1: Title Section */}
          <div className={`flex-1 flex ${isRtl ? 'justify-end text-right' : 'justify-start text-left'}`}>
            <div className="flex flex-col">
              <h1 className="text-xl sm:text-3xl font-black text-gold tracking-tight uppercase italic leading-tight drop-shadow-lg">
                ACHOUR PLAYER
              </h1>
              <span className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-[0.3em] px-0.5">Premium IPTV System</span>
            </div>
          </div>

          {/* Part 2: Central Logo Section */}
          <div className="flex flex-col items-center justify-center shrink-0">
            <div className="w-20 h-20 sm:w-32 sm:h-32 rounded-3xl sm:rounded-[2.5rem] border-2 border-gold/50 shadow-[0_0_40px_rgba(212,175,55,0.4)] overflow-hidden relative flex items-center justify-center bg-black transition-transform hover:scale-105 duration-300">
              <img 
                src="/logo.jpg" 
                onError={(e) => { e.currentTarget.src = logoImg; }}
                alt="Achour Player" 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent pointer-events-none" />
            </div>
          </div>

          {/* Part 3: Header Controls & Clock */}
          <div className={`flex-1 flex items-center gap-4 ${isRtl ? 'justify-start' : 'justify-end'}`}>
            <div className="flex items-center gap-2 mr-2">
              <button
                data-tv-focusable="true"
                onClick={() => setShowNotifications(true)}
                className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-400 hover:text-gold focus:ring-4 focus:ring-gold transition-all relative"
              >
                <Bell size={20} />
                {settings.notifications && settings.notifications.filter(n => !n.read).length > 0 && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                )}
              </button>
              <button
                data-tv-focusable="true"
                onClick={() => setShowSpeedTest(true)}
                className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-400 hover:text-gold focus:ring-4 focus:ring-gold transition-all"
              >
                <Zap size={20} />
              </button>
              <button
                data-tv-focusable="true"
                onClick={() => {
                  if (settings.kidsModeActive) {
                    setShowKidsUnlock(true);
                  } else {
                    onUpdateSettings(prev => ({ ...prev, kidsModeActive: true }));
                  }
                }}
                className={`p-2.5 rounded-xl border transition-all ${
                  settings.kidsModeActive 
                    ? 'bg-gold text-black border-gold shadow-lg shadow-gold/20' 
                    : 'bg-white/5 border-white/10 text-zinc-400 hover:text-gold'
                } focus:ring-4 focus:ring-gold`}
              >
                <Baby size={20} />
              </button>
            </div>

            <div className={`flex flex-col ${isRtl ? 'items-start' : 'items-end'}`}>
              <span className="text-xl sm:text-3xl font-black text-gold font-mono tracking-wider drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]">{formattedClock}</span>
              <span className="text-[11px] sm:text-sm font-bold text-zinc-400 capitalize mt-1">{formattedDate}</span>
            </div>
          </div>
        </div>

        {/* Real Live Subscription Expiry Bar on Home Dashboard */}
        {parsedSubscription && (
          <div className="relative z-20 px-4 w-full max-w-7xl mx-auto mb-2">
            <div className={`w-full p-2.5 sm:p-3 rounded-2xl border ${
              parsedSubscription.isExpired 
                ? 'bg-red-950/40 border-red-500/40 text-red-200' 
                : 'bg-zinc-950/80 border-gold/40 shadow-lg shadow-gold/5 text-white'
            } flex items-center justify-between gap-3 backdrop-blur-xl ${isRtl ? 'flex-row-reverse text-right' : 'text-left'}`}>
              <div className={`flex items-center gap-2.5 min-w-0 ${isRtl ? 'flex-row-reverse' : ''}`}>
                <div className={`p-1.5 sm:p-2 rounded-xl shrink-0 ${
                  parsedSubscription.isExpired ? 'bg-red-500/20 text-red-400' : 'bg-gold/20 text-gold'
                }`}>
                  <Calendar size={18} />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm font-black text-white truncate">
                      {activePlaylistData?.name || (isRtl ? 'الاشتراك النشط' : 'Active Subscription')}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase font-mono ${
                      parsedSubscription.isExpired ? 'bg-red-500/30 text-red-300' : 'bg-emerald-500/20 text-emerald-300'
                    }`}>
                      {parsedSubscription.isExpired ? (isRtl ? 'منتهي' : 'Expired') : (isRtl ? 'نشط' : 'Active')}
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-400 font-mono font-medium">
                    {isRtl ? 'تاريخ انتهاء الصلاحية:' : 'Expiry Date:'} <strong className="text-gold font-bold">{parsedSubscription.formattedDate}</strong>
                  </span>
                </div>
              </div>

              {!parsedSubscription.isExpired && (
                <div className="px-3 py-1 rounded-xl bg-gold/15 border border-gold/40 text-gold font-mono font-black text-xs sm:text-sm shrink-0">
                  {parsedSubscription.daysRemaining} {isRtl ? 'يوم متبقي' : 'days left'}
                </div>
              )}
            </div>
          </div>
        )}


      {/* Main Content Area */}

        {/* Dynamic Dashboard Layouts */}
        {(() => {
          const VALID_LAYOUTS = [
            'layout-classic-grid',
            'layout-smarttv-hero',
            'layout-sidebar-vertical',
            'layout-metro-tiles',
            'layout-cinema-strip',
            'layout-apple-spotlight',
            'layout-dual-column',
            'layout-minimal-list',
            'layout-honeycomb',
            'layout-floating-dock',
            'layout-staggered-grid',
            'layout-apple-tv',
            'layout-fire-tv',
            'layout-android-tv',
            'layout-modern-bento',
            'layout-sidebar-glass',
            'layout-compact-tiles',
            'layout-full-hero',
            'layout-split-hero',
            'layout-floating-strip'
          ];
          const rawLayout = settings.dashboardLayout || 'layout-classic-grid';
          const activeLayout = VALID_LAYOUTS.includes(rawLayout) ? rawLayout : 'layout-classic-grid';

          const iconScale = settings.iconScale || 'medium';
          const scaleWrapperClass = 
            iconScale === 'small'
              ? 'scale-[0.88] origin-center transition-transform duration-200'
              : iconScale === 'large'
                ? 'scale-[1.10] origin-center transition-transform duration-200'
                : 'scale-100 origin-center transition-transform duration-200';

          return (
            <AnimatePresence mode="wait">
              <motion.div
                key={`hub-layout-${activeLayout}`}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className={`flex-1 flex flex-col justify-center items-center w-full my-auto max-h-[calc(100vh-130px)] overflow-y-auto no-scrollbar px-2 sm:px-4 ${scaleWrapperClass}`}
              >
                {/* ======================================================== */}
                {/* LAYOUT 1: CLASSIC GRID                                   */}
                {/* ======================================================== */}
                {activeLayout === 'layout-classic-grid' && (
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3.5 max-w-4xl w-full py-1">
                    <HubCard 
                      scale={iconScale}
                      onClick={() => setCurrentView('live')} 
                      icon={
                        <div className={`w-10 h-10 sm:w-12 sm:h-12 p-2 rounded-xl flex items-center justify-center transition-all duration-300 ${active3DStyle.cardClass}`}>
                          {active3DStyle.iconImage ? (
                            <img src={active3DStyle.iconImage} alt="" className={active3DStyle.iconClass} />
                          ) : (
                            <Icons.Live className={`w-full h-full text-gold transition-all ${active3DStyle.iconClass}`} {...active3DStyle.iconProps} />
                          )}
                        </div>
                      } 
                      label={t('live')} 
                      subLabel={isRtl ? 'البث المباشر 🔴' : 'Live Broadcast'}
                    />
                    <HubCard 
                      scale={iconScale}
                      onClick={() => setCurrentView('movies')} 
                      icon={
                        <div className={`w-10 h-10 sm:w-12 sm:h-12 p-2 rounded-xl flex items-center justify-center transition-all duration-300 ${active3DStyle.cardClass}`}>
                          {active3DStyle.iconImage ? (
                            <img src={active3DStyle.iconImage} alt="" className={active3DStyle.iconClass} />
                          ) : (
                            <Icons.Filme className={`w-full h-full text-gold transition-all ${active3DStyle.iconClass}`} {...active3DStyle.iconProps} />
                          )}
                        </div>
                      } 
                      label={t('movies')} 
                      subLabel={isRtl ? 'سينما 4K VOD' : '4K Movies'}
                    />
                    <HubCard 
                      scale={iconScale}
                      onClick={() => setCurrentView('series')} 
                      icon={
                        <div className={`w-10 h-10 sm:w-12 sm:h-12 p-2 rounded-xl flex items-center justify-center transition-all duration-300 ${active3DStyle.cardClass}`}>
                          {active3DStyle.iconImage ? (
                            <img src={active3DStyle.iconImage} alt="" className={active3DStyle.iconClass} />
                          ) : (
                            <Icons.Serie className={`w-full h-full text-gold transition-all ${active3DStyle.iconClass}`} {...active3DStyle.iconProps} />
                          )}
                        </div>
                      } 
                      label={t('series')} 
                      subLabel={isRtl ? 'مسلسلات وبرامج' : 'TV Series'}
                    />
                    <HubCard 
                      scale={iconScale}
                      onClick={() => setCurrentView('add')} 
                      icon={
                        <div className={`w-10 h-10 sm:w-12 sm:h-12 p-2 rounded-xl flex items-center justify-center transition-all duration-300 ${active3DStyle.cardClass}`}>
                          {active3DStyle.iconImage ? (
                            <img src={active3DStyle.iconImage} alt="" className={active3DStyle.iconClass} />
                          ) : (
                            <Icons.Playlist className={`w-full h-full text-gold transition-all ${active3DStyle.iconClass}`} {...active3DStyle.iconProps} />
                          )}
                        </div>
                      } 
                      label={isRtl ? 'الاشتراكات' : 'Subscriptions'} 
                      subLabel={isRtl ? 'إدارة القوائم' : 'Portals'}
                    />
                    <HubCard 
                      scale={iconScale}
                      onClick={() => setCurrentView('settings')} 
                      icon={
                        <div className={`w-10 h-10 sm:w-12 sm:h-12 p-2 rounded-xl flex items-center justify-center transition-all duration-300 ${active3DStyle.cardClass}`}>
                          {active3DStyle.iconImage ? (
                            <img src={active3DStyle.iconImage} alt="" className={active3DStyle.iconClass} />
                          ) : (
                            <Settings className={`w-full h-full text-gold transition-all ${active3DStyle.iconClass}`} {...active3DStyle.iconProps} />
                          )}
                        </div>
                      } 
                      label={t('settings')} 
                      subLabel={isRtl ? 'إعدادات النظام' : 'System Options'}
                    />
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 2: SMART TV HERO DASHBOARD                        */}
                {/* ======================================================== */}
                {activeLayout === 'layout-smarttv-hero' && (
                  <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-12 gap-2.5 sm:gap-3.5 items-stretch my-auto py-1">
                    {/* Left Section: Live TV Hero Tile */}
                    <motion.div 
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setCurrentView('live')}
                      className="sm:col-span-5 cursor-pointer glass-card p-3 sm:p-4 rounded-2xl border-2 border-white/60 shadow-gold/20 flex flex-col justify-between relative overflow-hidden group min-h-[140px] sm:min-h-[170px] max-h-[220px] bg-gradient-to-br from-gold/90 via-gold-dark/90 to-black text-white focus:outline-none focus:ring-4 focus:ring-gold transition-all"
                    >
                      <div className="flex items-center justify-between z-10">
                        <span className="px-2 py-0.5 bg-white/20 text-white font-black text-[9px] uppercase tracking-wider rounded-full flex items-center gap-1 border border-white/30 backdrop-blur-md">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
                          {isRtl ? 'البث المباشر' : 'LIVE TV'}
                        </span>
                        <span className="text-white/80 text-[9px] font-mono font-bold">IPTV HD/4K</span>
                      </div>

                      <div className="my-auto text-center flex flex-col items-center justify-center py-1 z-10">
                        <div className="w-9 h-9 sm:w-12 sm:h-12 mb-1 rounded-xl p-1.5 sm:p-2 bg-white/10 border border-white/40 flex items-center justify-center group-hover:scale-105 transition-all shadow-md">
                          <Icons.Live className="w-full h-full text-white" strokeWidth={1.4} />
                        </div>
                        <h2 className="text-sm sm:text-lg font-black text-white uppercase tracking-wider">
                          {t('live')}
                        </h2>
                        <p className="text-[9px] text-white/90 font-bold truncate max-w-full hidden sm:block">
                          {isRtl ? 'جميع القنوات الفضائية والرياضية المباشرة' : 'Live Channels & Sports Streams'}
                        </p>
                      </div>

                      <div className="flex items-center justify-between z-10 pt-1 border-t border-white/20 text-[9px] font-mono text-white/80">
                        <span>{isRtl ? 'انقر للمشاهدة' : 'Click to Watch'}</span>
                        <span className="font-bold">{isRtl ? 'بث مباشر 🔴' : 'Live 🔴'}</span>
                      </div>
                    </motion.div>

                    {/* Middle Section: 2x2 Grid */}
                    <div className="sm:col-span-4 grid grid-cols-2 gap-2 min-h-[140px] sm:min-h-[170px] max-h-[220px]">
                      <motion.button
                        data-tv-focusable="true"
                        tabIndex={0}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setCurrentView('movies')}
                        className="glass-card p-2 sm:p-3 rounded-xl sm:rounded-2xl border border-white/30 hover:border-white focus:outline-none focus:ring-4 focus:ring-gold flex flex-col items-center justify-center text-center group transition-all bg-gradient-to-br from-gold/80 to-gold-dark/80 text-white shadow-md"
                      >
                        <div className="w-7 h-7 sm:w-9 sm:h-9 mb-1 p-1 rounded-lg bg-white/10 text-white group-hover:scale-105 transition-transform flex items-center justify-center">
                          <Icons.Filme className="w-full h-full text-white" strokeWidth={1.4} />
                        </div>
                        <span className="text-[10px] sm:text-xs font-black uppercase text-white tracking-wider truncate w-full">
                          {t('movies')}
                        </span>
                      </motion.button>

                      <motion.button
                        data-tv-focusable="true"
                        tabIndex={0}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setCurrentView('series')}
                        className="glass-card p-2 sm:p-3 rounded-xl sm:rounded-2xl border border-white/30 hover:border-white focus:outline-none focus:ring-4 focus:ring-gold flex flex-col items-center justify-center text-center group transition-all bg-gradient-to-br from-gold/80 to-gold-dark/80 text-white shadow-md"
                      >
                        <div className="w-7 h-7 sm:w-9 sm:h-9 mb-1 p-1 rounded-lg bg-white/10 text-white group-hover:scale-105 transition-transform flex items-center justify-center">
                          <Icons.Serie className="w-full h-full text-white" strokeWidth={1.4} />
                        </div>
                        <span className="text-[10px] sm:text-xs font-black uppercase text-white tracking-wider truncate w-full">
                          {t('series')}
                        </span>
                      </motion.button>

                      <motion.button
                        data-tv-focusable="true"
                        tabIndex={0}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setCurrentView('add')}
                        className="glass-card p-2 sm:p-3 rounded-xl sm:rounded-2xl border border-white/30 hover:border-white focus:outline-none focus:ring-4 focus:ring-gold flex flex-col items-center justify-center text-center group transition-all bg-gradient-to-br from-gold/80 to-gold-dark/80 text-white shadow-md"
                      >
                        <div className="w-7 h-7 sm:w-9 sm:h-9 mb-1 p-1 rounded-lg bg-white/10 text-white group-hover:scale-105 transition-transform flex items-center justify-center">
                          <Icons.Playlist className="w-full h-full text-white" strokeWidth={1.4} />
                        </div>
                        <span className="text-[9px] sm:text-[10px] font-black uppercase text-white tracking-wider truncate w-full">
                          {isRtl ? 'الاشتراكات' : 'Account'}
                        </span>
                      </motion.button>
                    </div>

                    {/* Right Section: Action Column */}
                    <div className="sm:col-span-3 flex flex-col gap-2 min-h-[140px] sm:min-h-[170px] max-h-[220px]">
                      <motion.button
                        data-tv-focusable="true"
                        tabIndex={0}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setCurrentView('settings')}
                        className="flex-1 glass-card p-2.5 rounded-xl border border-gold/40 hover:border-gold focus:outline-none focus:ring-4 focus:ring-gold flex items-center gap-2.5 px-3 transition-all group bg-black/60 text-white shadow-sm"
                      >
                        <div className="p-1.5 rounded-lg bg-gold/20 text-gold group-hover:rotate-45 transition-transform shrink-0">
                          <Settings size={16} />
                        </div>
                        <div className="text-left rtl:text-right min-w-0">
                          <span className="text-xs font-black uppercase text-white block group-hover:text-gold truncate">
                            {t('settings')}
                          </span>
                        </div>
                      </motion.button>

                      <motion.button
                        data-tv-focusable="true"
                        tabIndex={0}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={async () => {
                          setIsRefreshing(true);
                          await fetchActivePlaylist();
                          setIsRefreshing(false);
                          setRefreshToast(true);
                          setTimeout(() => setRefreshToast(false), 2500);
                        }}
                        className="flex-1 glass-card p-2.5 rounded-xl border border-gold/40 hover:border-gold focus:outline-none focus:ring-4 focus:ring-gold flex items-center gap-2.5 px-3 transition-all group bg-black/60 text-white shadow-sm"
                      >
                        <div className="p-1.5 rounded-lg bg-gold/20 text-gold shrink-0">
                          <RefreshCcw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                        </div>
                        <div className="text-left rtl:text-right min-w-0">
                          <span className="text-xs font-black uppercase text-white block group-hover:text-gold truncate">
                            {isRtl ? 'تحديث السيرفر' : 'Reload'}
                          </span>
                        </div>
                      </motion.button>

                      <motion.button
                        data-tv-focusable="true"
                        tabIndex={0}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleExitApp()}
                        className="flex-1 glass-card p-2.5 rounded-xl border border-gold/40 hover:border-gold focus:outline-none focus:ring-4 focus:ring-gold flex items-center gap-2.5 px-3 transition-all group bg-gold/10 text-white shadow-sm"
                      >
                        <div className="p-1.5 rounded-lg bg-gold/20 text-gold shrink-0">
                          <LogOut size={16} />
                        </div>
                        <div className="text-left rtl:text-right min-w-0">
                          <span className="text-xs font-black uppercase text-gold block group-hover:text-gold-light truncate">
                            {isRtl ? 'الخروج' : 'Exit'}
                          </span>
                        </div>
                      </motion.button>
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 3: SIDEBAR VERTICAL NAVIGATION                    */}
                {/* ======================================================== */}
                {activeLayout === 'layout-sidebar-vertical' && (
                  <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-12 gap-3 items-stretch my-auto py-1">
                    {/* Left Rail */}
                    <div className="sm:col-span-3 glass-card p-3 rounded-2xl border border-white/10 flex flex-col gap-1.5 justify-between">
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-mono font-bold text-gold uppercase tracking-widest block px-2">
                          MENU
                        </span>
                        {[
                          { id: 'live', label: t('live'), icon: Icons.Live, action: () => setCurrentView('live') },
                          { id: 'movies', label: t('movies'), icon: Icons.Filme, action: () => setCurrentView('movies') },
                          { id: 'series', label: t('series'), icon: Icons.Serie, action: () => setCurrentView('series') },
                          { id: 'add', label: isRtl ? 'الاشتراكات' : 'Subscriptions', icon: Icons.Playlist, action: () => setCurrentView('add') },
                          { id: 'settings', label: t('settings'), icon: Settings, action: () => setCurrentView('settings') },
                        ].map((item) => {
                          const IconComp = item.icon;
                          return (
                            <motion.button
                              key={item.id}
                              data-tv-focusable="true"
                              tabIndex={0}
                              whileHover={{ x: isRtl ? -3 : 3 }}
                              onClick={item.action}
                              className="w-full p-2 rounded-xl border border-white/5 hover:border-gold/40 bg-black/40 hover:bg-gold/15 flex items-center gap-2.5 transition-all group text-left rtl:text-right"
                            >
                              <div className="p-1.5 rounded-lg bg-gold/20 text-gold group-hover:scale-105 transition-transform">
                                <IconComp className="w-4 h-4" />
                              </div>
                              <span className="text-xs font-black uppercase text-white group-hover:text-gold truncate">
                                {item.label}
                              </span>
                            </motion.button>
                          );
                        })}
                      </div>

                      <button
                        data-tv-focusable="true"
                        tabIndex={0}
                        onClick={() => handleExitApp()}
                        className="w-full p-2 rounded-xl border border-red-500/20 bg-red-950/20 hover:bg-red-900/40 text-red-400 font-bold text-xs uppercase flex items-center justify-center gap-1.5 transition-all mt-2"
                      >
                        <LogOut size={14} />
                        <span>{isRtl ? 'خروج' : 'Exit'}</span>
                      </button>
                    </div>

                    {/* Right Panel */}
                    <div className="sm:col-span-9 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <motion.div
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.02 }}
                        onClick={() => setCurrentView('live')}
                        className="cursor-pointer glass-card p-4 rounded-2xl border border-gold/40 hover:border-gold flex flex-col justify-between bg-gradient-to-br from-gold/15 to-black group min-h-[160px]"
                      >
                        <div className="p-2.5 rounded-xl bg-gold/20 text-gold w-fit group-hover:scale-105 transition-transform">
                          <Icons.Live className="w-7 h-7" />
                        </div>
                        <div>
                          <span className="text-[9px] font-mono text-gold font-bold uppercase tracking-wider block mb-0.5">
                            LIVE TV
                          </span>
                          <h3 className="text-lg font-black text-white uppercase group-hover:text-gold transition-colors">
                            {t('live')}
                          </h3>
                          <p className="text-[10px] text-zinc-400 mt-0.5 line-clamp-1">
                            {isRtl ? 'القنوات المباشرة والبث الرياضي' : 'Live channels & sports'}
                          </p>
                        </div>
                      </motion.div>

                      <motion.div
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.02 }}
                        onClick={() => setCurrentView('movies')}
                        className="cursor-pointer glass-card p-4 rounded-2xl border border-gold/40 hover:border-gold flex flex-col justify-between bg-gradient-to-br from-gold/15 to-black group min-h-[160px]"
                      >
                        <div className="p-2.5 rounded-xl bg-gold/20 text-gold w-fit group-hover:scale-105 transition-transform">
                          <Icons.Filme className="w-7 h-7" />
                        </div>
                        <div>
                          <span className="text-[9px] font-mono text-gold font-bold uppercase tracking-wider block mb-0.5">
                            CINEMA VOD
                          </span>
                          <h3 className="text-lg font-black text-white uppercase group-hover:text-gold transition-colors">
                            {t('movies')}
                          </h3>
                          <p className="text-[10px] text-zinc-400 mt-0.5 line-clamp-1">
                            {isRtl ? 'أفلام عربية وأجنبية بدقة 4K' : '4K movies library'}
                          </p>
                        </div>
                      </motion.div>

                      <motion.div
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.02 }}
                        onClick={() => setCurrentView('series')}
                        className="cursor-pointer glass-card p-4 rounded-2xl border border-gold/40 hover:border-gold flex flex-col justify-between bg-gradient-to-br from-gold/15 to-black group min-h-[160px]"
                      >
                        <div className="p-2.5 rounded-xl bg-gold/20 text-gold w-fit group-hover:scale-105 transition-transform">
                          <Icons.Serie className="w-7 h-7" />
                        </div>
                        <div>
                          <span className="text-[9px] font-mono text-gold font-bold uppercase tracking-wider block mb-0.5">
                            TV SHOWS
                          </span>
                          <h3 className="text-lg font-black text-white uppercase group-hover:text-gold transition-colors">
                            {t('series')}
                          </h3>
                          <p className="text-[10px] text-zinc-400 mt-0.5 line-clamp-1">
                            {isRtl ? 'مسلسلات متجددة يومياً' : 'TV shows & series'}
                          </p>
                        </div>
                      </motion.div>
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 4: METRO GLASS 3D TILES                           */}
                {/* ======================================================== */}
                {activeLayout === 'layout-metro-tiles' && (
                  <div className="w-full max-w-4xl grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 items-stretch my-auto py-1">
                    <motion.div
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setCurrentView('live')}
                      className="col-span-2 row-span-2 cursor-pointer glass-card p-4 sm:p-5 rounded-2xl border-2 border-gold/50 shadow-md flex flex-col justify-between group bg-gradient-to-br from-gold/20 via-black to-black min-h-[160px] sm:min-h-[180px]"
                    >
                      <div className="p-2.5 rounded-xl bg-gold text-black w-fit group-hover:scale-105 transition-transform shadow-md">
                        <Icons.Live className="w-7 h-7" />
                      </div>
                      <div>
                        <span className="text-[9px] font-mono font-bold text-gold uppercase tracking-wider block">
                          FEATURED
                        </span>
                        <h2 className="text-xl sm:text-2xl font-black text-white uppercase group-hover:text-gold transition-colors">
                          {t('live')}
                        </h2>
                      </div>
                    </motion.div>

                    <motion.div
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }}
                      onClick={() => setCurrentView('movies')}
                      className="col-span-2 cursor-pointer glass-card p-3 sm:p-3.5 rounded-2xl border border-gold/40 hover:border-gold flex items-center gap-3 group bg-black/60"
                    >
                      <div className="p-2 rounded-xl bg-gold/20 text-gold group-hover:scale-105 transition-transform">
                        <Icons.Filme className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-black text-white uppercase group-hover:text-gold">
                          {t('movies')}
                        </h3>
                        <p className="text-[10px] text-zinc-400">Cinematic VOD</p>
                      </div>
                    </motion.div>

                    <motion.div
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }}
                      onClick={() => setCurrentView('series')}
                      className="col-span-2 cursor-pointer glass-card p-3 sm:p-3.5 rounded-2xl border border-gold/40 hover:border-gold flex items-center gap-3 group bg-black/60"
                    >
                      <div className="p-2 rounded-xl bg-gold/20 text-gold group-hover:scale-105 transition-transform">
                        <Icons.Serie className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-black text-white uppercase group-hover:text-gold">
                          {t('series')}
                        </h3>
                        <p className="text-[10px] text-zinc-400">TV Shows</p>
                      </div>
                    </motion.div>

                    <motion.div
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }}
                      onClick={() => setCurrentView('add')}
                      className="col-span-1 cursor-pointer glass-card p-2.5 sm:p-3 rounded-xl border border-amber-500/30 hover:border-amber-400 flex flex-col items-center justify-center text-center group bg-black/60"
                    >
                      <Icons.Playlist className="w-5 h-5 text-amber-400 mb-1" />
                      <span className="text-[10px] font-bold uppercase text-white truncate w-full">{isRtl ? 'الاشتراكات' : 'Account'}</span>
                    </motion.div>

                    <motion.div
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }}
                      onClick={() => setCurrentView('settings')}
                      className="col-span-1 cursor-pointer glass-card p-2.5 sm:p-3 rounded-xl border border-gold/30 hover:border-gold flex flex-col items-center justify-center text-center group bg-black/60"
                    >
                      <Settings className="w-5 h-5 text-gold mb-1" />
                      <span className="text-[10px] font-bold uppercase text-white truncate w-full">{t('settings')}</span>
                    </motion.div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 5: CINEMATIC FLOWING STRIP                        */}
                {/* ======================================================== */}
                {activeLayout === 'layout-cinema-strip' && (
                  <div className="w-full max-w-5xl py-2 overflow-x-auto scrollbar-hide my-auto">
                    <div className="flex items-center gap-3 px-2 min-w-max">
                      {[
                        { id: 'live', title: t('live'), desc: 'Live Stream TV', icon: Icons.Live, action: () => setCurrentView('live') },
                        { id: 'movies', title: t('movies'), desc: 'Cinema VOD', icon: Icons.Filme, action: () => setCurrentView('movies') },
                        { id: 'series', title: t('series'), desc: 'Drama & Shows', icon: Icons.Serie, action: () => setCurrentView('series') },
                        { id: 'add', title: isRtl ? 'الاشتراكات' : 'Subscriptions', desc: 'Portals', icon: Icons.Playlist, action: () => setCurrentView('add') },
                        { id: 'settings', title: t('settings'), desc: 'System Config', icon: Settings, action: () => setCurrentView('settings') },
                      ].map((strip) => {
                        const StripIcon = strip.icon;
                        return (
                          <motion.div
                            key={strip.id}
                            data-tv-focusable="true"
                            tabIndex={0}
                            role="button"
                            whileHover={{ scale: 1.03, y: -4 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={strip.action}
                            className="w-32 h-44 sm:w-40 sm:h-52 cursor-pointer glass-card p-3.5 sm:p-4 rounded-2xl sm:rounded-3xl border-2 border-gold/40 hover:border-gold shadow-lg flex flex-col justify-between relative overflow-hidden group transition-all bg-black/70"
                          >
                            <div className="p-2 sm:p-2.5 rounded-xl bg-white/10 text-white w-fit group-hover:scale-105 transition-transform">
                              <StripIcon className="w-6 h-6 sm:w-7 sm:h-7 text-gold" />
                            </div>
                            <div>
                              <span className="text-[8px] sm:text-[9px] font-mono font-bold text-zinc-400 uppercase tracking-wider block mb-0.5">
                                {strip.desc}
                              </span>
                              <h3 className="text-sm sm:text-base font-black uppercase text-white group-hover:text-gold transition-colors truncate">
                                {strip.title}
                              </h3>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 6: APPLE TV SPOTLIGHT SHOWCASE                    */}
                {/* ======================================================== */}
                {activeLayout === 'layout-apple-spotlight' && (
                  <div className="w-full max-w-5xl flex flex-col gap-3 my-auto py-2">
                    <motion.div
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.01 }}
                      onClick={() => setCurrentView('live')}
                      className="cursor-pointer glass-card p-4 sm:p-6 rounded-2xl sm:rounded-3xl border-2 border-gold/50 shadow-md bg-gradient-to-r from-gold-dark/40 via-zinc-900 to-black flex items-center justify-between gap-4 relative overflow-hidden group"
                    >
                      <div className="space-y-1.5 z-10 text-left rtl:text-right">
                        <span className="px-2.5 py-0.5 bg-gold/20 text-gold border border-gold/40 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider">
                          APPLE TV SPOTLIGHT 
                        </span>
                        <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight group-hover:text-gold transition-colors">
                          {t('live')}
                        </h2>
                        <p className="text-[10px] sm:text-xs text-zinc-300 max-w-md hidden sm:block">
                          {isRtl ? 'تجربة تلفزيونية سينمائية فائقة الوضوح مع عرض مباشر وتوصيات ذكية' : 'Cinematic streaming experience with live broadcast'}
                        </p>
                      </div>
                      <div className="p-3.5 sm:p-5 rounded-2xl bg-gold/20 border border-gold text-gold group-hover:scale-105 transition-transform shadow-lg shrink-0">
                        <Icons.Live className="w-9 h-9 sm:w-12 sm:h-12" />
                      </div>
                    </motion.div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {[
                        { id: 'movies', title: t('movies'), icon: Icons.Filme, action: () => setCurrentView('movies'), color: 'border-blue-500/40' },
                        { id: 'series', title: t('series'), icon: Icons.Serie, action: () => setCurrentView('series'), color: 'border-purple-500/40' },
                        { id: 'add', title: isRtl ? 'الاشتراكات' : 'Account', icon: Icons.Playlist, action: () => setCurrentView('add'), color: 'border-amber-500/40' },
                        { id: 'settings', title: t('settings'), icon: Settings, action: () => setCurrentView('settings'), color: 'border-gold/40' },
                      ].map((card) => {
                        const CardIcon = card.icon;
                        return (
                          <motion.button
                            key={card.id}
                            data-tv-focusable="true"
                            tabIndex={0}
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={card.action}
                            className={`p-3 glass-card rounded-xl sm:rounded-2xl border ${card.color} hover:border-white bg-black/60 flex items-center gap-2.5 text-left rtl:text-right group transition-all`}
                          >
                            <div className="p-2 rounded-lg bg-white/10 text-white group-hover:scale-105 transition-transform shrink-0">
                              <CardIcon className="w-5 h-5 text-gold" />
                            </div>
                            <span className="text-xs font-black text-white uppercase tracking-wider group-hover:text-gold transition-colors truncate">
                              {card.title}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 7: DUAL SPLIT COLUMN                              */}
                {/* ======================================================== */}
                {activeLayout === 'layout-dual-column' && (
                  <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-2 gap-3.5 my-auto py-2">
                    <motion.div 
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }} 
                      onClick={() => setCurrentView('live')} 
                      className="cursor-pointer glass-card p-4 sm:p-6 rounded-2xl sm:rounded-3xl border-2 border-cyan-500/50 shadow-lg bg-gradient-to-br from-cyan-950/50 to-black flex flex-col justify-between group min-h-[160px]"
                    >
                      <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-400 w-fit">
                        <Icons.Live className="w-8 h-8 sm:w-10 sm:h-10" />
                      </div>
                      <div className="space-y-1 mt-4">
                        <span className="text-[9px] font-mono font-bold text-cyan-400 uppercase tracking-wider block">COLUMN A • DIRECT</span>
                        <h2 className="text-xl sm:text-2xl font-black uppercase text-white group-hover:text-cyan-300">{t('live')}</h2>
                      </div>
                    </motion.div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <motion.div 
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.03 }} 
                        onClick={() => setCurrentView('movies')} 
                        className="cursor-pointer glass-card p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-gold/40 bg-black/60 flex flex-col justify-between group"
                      >
                        <Icons.Filme className="w-6 h-6 text-gold" />
                        <h3 className="text-xs sm:text-sm font-black uppercase text-white group-hover:text-gold mt-2">{t('movies')}</h3>
                      </motion.div>
                      <motion.div 
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.03 }} 
                        onClick={() => setCurrentView('series')} 
                        className="cursor-pointer glass-card p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-gold/40 bg-black/60 flex flex-col justify-between group"
                      >
                        <Icons.Serie className="w-6 h-6 text-gold" />
                        <h3 className="text-xs sm:text-sm font-black uppercase text-white group-hover:text-gold mt-2">{t('series')}</h3>
                      </motion.div>
                      <motion.div 
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.03 }} 
                        onClick={() => setCurrentView('add')} 
                        className="cursor-pointer glass-card p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-gold/40 bg-black/60 flex flex-col justify-between group"
                      >
                        <Icons.Playlist className="w-6 h-6 text-gold" />
                        <h3 className="text-[10px] sm:text-xs font-black uppercase text-white group-hover:text-gold mt-2">{isRtl ? 'الاشتراكات' : 'Account'}</h3>
                      </motion.div>
                      <motion.div 
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.03 }} 
                        onClick={() => setCurrentView('settings')} 
                        className="cursor-pointer glass-card p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-gold/40 bg-black/60 flex flex-col justify-between group"
                      >
                        <Settings className="w-6 h-6 text-gold" />
                        <h3 className="text-[10px] sm:text-xs font-black uppercase text-white group-hover:text-gold mt-2">{t('settings')}</h3>
                      </motion.div>
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 8: MINIMAL LUXURY VERTICAL LIST                   */}
                {/* ======================================================== */}
                {activeLayout === 'layout-minimal-list' && (
                  <div className="w-full max-w-xl flex flex-col gap-2 my-auto py-2">
                    {[
                      { id: 'live', label: t('live'), icon: Icons.Live, action: () => setCurrentView('live') },
                      { id: 'movies', label: t('movies'), icon: Icons.Filme, action: () => setCurrentView('movies') },
                      { id: 'series', label: t('series'), icon: Icons.Serie, action: () => setCurrentView('series') },
                      { id: 'add', label: isRtl ? 'الاشتراكات وإدارة السيرفرات' : 'Subscriptions & Portals', icon: Icons.Playlist, action: () => setCurrentView('add') },
                      { id: 'settings', label: t('settings'), icon: Settings, action: () => setCurrentView('settings') },
                    ].map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <motion.button
                          key={item.id}
                          data-tv-focusable="true"
                          tabIndex={0}
                          whileHover={{ x: isRtl ? -4 : 4 }}
                          onClick={item.action}
                          className="w-full p-2.5 sm:p-3 rounded-xl sm:rounded-2xl glass-card border border-gold/30 hover:border-gold bg-black/80 flex items-center justify-between group transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-gold/20 text-gold">
                              <ItemIcon className="w-5 h-5" />
                            </div>
                            <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-white group-hover:text-gold transition-colors">
                              {item.label}
                            </span>
                          </div>
                          <span className="text-xs font-mono text-gold">➔</span>
                        </motion.button>
                      );
                    })}
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 9: HONEYCOMB MATRIX                               */}
                {/* ======================================================== */}
                {activeLayout === 'layout-honeycomb' && (
                  <div className="w-full max-w-4xl flex flex-col items-center justify-center my-auto py-2 space-y-2.5">
                    <div className="flex justify-center gap-2.5 sm:gap-3">
                      <motion.div 
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.05 }} 
                        onClick={() => setCurrentView('live')} 
                        className="w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 glass-card rounded-2xl sm:rounded-3xl border-2 border-gold/50 bg-black/75 flex flex-col items-center justify-center cursor-pointer group shadow-md"
                      >
                        <Icons.Live className="w-7 h-7 sm:w-8 sm:h-8 text-gold mb-1 group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] sm:text-xs font-black uppercase text-white">{t('live')}</span>
                      </motion.div>
                      <motion.div 
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.05 }} 
                        onClick={() => setCurrentView('movies')} 
                        className="w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 glass-card rounded-2xl sm:rounded-3xl border-2 border-gold/50 bg-black/75 flex flex-col items-center justify-center cursor-pointer group shadow-md"
                      >
                        <Icons.Filme className="w-7 h-7 sm:w-8 sm:h-8 text-gold mb-1 group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] sm:text-xs font-black uppercase text-white">{t('movies')}</span>
                      </motion.div>
                    </div>
                    <div className="flex justify-center gap-2.5 sm:gap-3">
                      <motion.div 
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.05 }} 
                        onClick={() => setCurrentView('series')} 
                        className="w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 glass-card rounded-2xl sm:rounded-3xl border-2 border-gold/50 bg-black/75 flex flex-col items-center justify-center cursor-pointer group shadow-md"
                      >
                        <Icons.Serie className="w-7 h-7 sm:w-8 sm:h-8 text-gold mb-1 group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] sm:text-xs font-black uppercase text-white">{t('series')}</span>
                      </motion.div>
                      <motion.div 
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.05 }} 
                        onClick={() => setCurrentView('add')} 
                        className="w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 glass-card rounded-2xl sm:rounded-3xl border-2 border-gold/50 bg-black/75 flex flex-col items-center justify-center cursor-pointer group shadow-md"
                      >
                        <Icons.Playlist className="w-7 h-7 sm:w-8 sm:h-8 text-gold mb-1 group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] sm:text-xs font-black uppercase text-white">{isRtl ? 'الاشتراكات' : 'Account'}</span>
                      </motion.div>
                      <motion.div 
                        data-tv-focusable="true"
                        tabIndex={0}
                        role="button"
                        whileHover={{ scale: 1.05 }} 
                        onClick={() => setCurrentView('settings')} 
                        className="w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 glass-card rounded-2xl sm:rounded-3xl border-2 border-gold/50 bg-gold/15 flex flex-col items-center justify-center cursor-pointer group shadow-md"
                      >
                        <Settings className="w-7 h-7 sm:w-8 sm:h-8 text-gold mb-1 group-hover:rotate-45 transition-transform" />
                        <span className="text-[10px] sm:text-xs font-black uppercase text-white">{t('settings')}</span>
                      </motion.div>
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 10: FLOATING GLASS DOCK                           */}
                {/* ======================================================== */}
                {activeLayout === 'layout-floating-dock' && (
                  <div className="w-full max-w-4xl flex flex-col items-center justify-center my-auto py-4">
                    <div className="text-center space-y-1 mb-6">
                      <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase tracking-widest">MAC GLASS DOCK</span>
                      <h2 className="text-xl sm:text-2xl font-black uppercase text-white tracking-wider">ACHOUR PLAYER PORTAL</h2>
                    </div>
                    <div className="glass-card p-2.5 sm:p-3.5 rounded-2xl sm:rounded-3xl border border-white/20 shadow-xl flex items-center gap-2 sm:gap-3 bg-black/80 backdrop-blur-xl">
                      {[
                        { id: 'live', label: t('live'), icon: Icons.Live, action: () => setCurrentView('live') },
                        { id: 'movies', label: t('movies'), icon: Icons.Filme, action: () => setCurrentView('movies') },
                        { id: 'series', label: t('series'), icon: Icons.Serie, action: () => setCurrentView('series') },
                        { id: 'add', label: isRtl ? 'الاشتراكات' : 'Account', icon: Icons.Playlist, action: () => setCurrentView('add') },
                        { id: 'settings', label: t('settings'), icon: Settings, action: () => setCurrentView('settings') },
                      ].map((dock) => {
                        const DockIcon = dock.icon;
                        return (
                          <motion.button
                            key={dock.id}
                            data-tv-focusable="true"
                            tabIndex={0}
                            whileHover={{ scale: 1.15, y: -4 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={dock.action}
                            className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white/10 hover:bg-gold hover:text-black text-white flex flex-col items-center justify-center transition-all shadow-md group relative focus:ring-4 focus:ring-gold"
                            title={dock.label}
                          >
                            <DockIcon className="w-6 h-6 sm:w-7 sm:h-7" />
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 11: STAGGERED BENTO BOX                           */}
                {/* ======================================================== */}
                {activeLayout === 'layout-staggered-grid' && (
                  <div className="w-full max-w-4xl grid grid-cols-1 sm:grid-cols-3 gap-2.5 my-auto py-2">
                    <motion.div 
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }} 
                      onClick={() => setCurrentView('live')} 
                      className="sm:col-span-2 cursor-pointer glass-card p-4 sm:p-5 rounded-2xl border-2 border-pink-500/40 bg-gradient-to-r from-pink-950/40 to-black flex items-center justify-between group"
                    >
                      <div>
                        <span className="text-[9px] font-mono text-pink-400 font-bold uppercase">FEATURED</span>
                        <h2 className="text-xl sm:text-2xl font-black uppercase text-white group-hover:text-pink-300">{t('live')}</h2>
                      </div>
                      <Icons.Live className="w-9 h-9 sm:w-11 sm:h-11 text-pink-400 shrink-0" />
                    </motion.div>
                    <motion.div 
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }} 
                      onClick={() => setCurrentView('movies')} 
                      className="cursor-pointer glass-card p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-blue-500/30 bg-black/60 flex flex-col justify-between group"
                    >
                      <Icons.Filme className="w-7 h-7 text-blue-400" />
                      <h3 className="text-sm font-black uppercase text-white group-hover:text-gold mt-2">{t('movies')}</h3>
                    </motion.div>
                    <motion.div 
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }} 
                      onClick={() => setCurrentView('series')} 
                      className="cursor-pointer glass-card p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-purple-500/30 bg-black/60 flex flex-col justify-between group"
                    >
                      <Icons.Serie className="w-7 h-7 text-purple-400" />
                      <h3 className="text-sm font-black uppercase text-white group-hover:text-gold mt-2">{t('series')}</h3>
                    </motion.div>
                    <motion.div 
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }} 
                      onClick={() => setCurrentView('add')} 
                      className="cursor-pointer glass-card p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-amber-500/30 bg-black/60 flex flex-col justify-between group"
                    >
                      <Icons.Playlist className="w-7 h-7 text-amber-400" />
                      <h3 className="text-sm font-black uppercase text-white group-hover:text-gold mt-2">{isRtl ? 'الاشتراكات' : 'Account'}</h3>
                    </motion.div>
                    <motion.div 
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.02 }} 
                      onClick={() => setCurrentView('settings')} 
                      className="cursor-pointer glass-card p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-gold/30 bg-gold/15 flex flex-col justify-between group"
                    >
                      <Settings className="w-7 h-7 text-gold" />
                      <h3 className="text-sm font-black uppercase text-white group-hover:text-gold mt-2">{t('settings')}</h3>
                    </motion.div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 12: APPLE TV SPOTLIGHT                            */}
                {/* ======================================================== */}
                {activeLayout === 'layout-apple-tv' && (
                  <div className="w-full max-w-5xl flex flex-col gap-3 my-auto py-2">
                    <motion.div 
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.01 }} 
                      onClick={() => setCurrentView('live')} 
                      className="cursor-pointer glass-card p-4 sm:p-6 rounded-2xl sm:rounded-3xl border-2 border-gold/50 shadow-md bg-gradient-to-r from-gold-dark/40 via-zinc-900 to-black flex items-center justify-between group"
                    >
                      <div>
                        <span className="text-[9px] font-mono text-gold uppercase font-bold">APPLE TV SPOTLIGHT</span>
                        <h2 className="text-2xl sm:text-3xl font-black uppercase text-white group-hover:text-gold">{t('live')}</h2>
                      </div>
                      <Icons.Live className="w-10 h-10 sm:w-12 sm:h-12 text-gold shrink-0" />
                    </motion.div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {[
                        { title: t('movies'), action: () => setCurrentView('movies'), icon: Icons.Filme },
                        { title: t('series'), action: () => setCurrentView('series'), icon: Icons.Serie },
                        { title: isRtl ? 'الاشتراكات' : 'Account', action: () => setCurrentView('add'), icon: Icons.Playlist },
                        { title: t('settings'), action: () => setCurrentView('settings'), icon: Settings },
                      ].map((card, i) => {
                        const IconComp = card.icon;
                        return (
                          <motion.button 
                            key={i} 
                            data-tv-focusable="true"
                            tabIndex={0}
                            whileHover={{ scale: 1.03 }} 
                            onClick={card.action} 
                            className="p-3 glass-card rounded-xl sm:rounded-2xl border border-white/10 hover:border-gold bg-black/60 flex items-center gap-2.5 text-left rtl:text-right"
                          >
                            <IconComp className="w-5 h-5 text-gold shrink-0" />
                            <span className="text-xs font-black uppercase text-white truncate">{card.title}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 13: AMAZON FIRE TV ROW                            */}
                {/* ======================================================== */}
                {activeLayout === 'layout-fire-tv' && (
                  <div className="w-full max-w-5xl flex flex-col gap-3 my-auto py-2">
                    <motion.div 
                      data-tv-focusable="true"
                      tabIndex={0}
                      role="button"
                      whileHover={{ scale: 1.01 }} 
                      onClick={() => setCurrentView('live')} 
                      className="cursor-pointer p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl bg-gradient-to-r from-gold via-gold-dark to-black border-2 border-gold/50 text-white flex items-center justify-between shadow-lg"
                    >
                      <div>
                        <span className="px-2.5 py-0.5 bg-white/20 rounded-full text-[9px] font-bold uppercase">FEATURED BANNER</span>
                        <h2 className="text-xl sm:text-2xl font-black uppercase mt-1">{t('live')}</h2>
                      </div>
                      <Icons.Live className="w-9 h-9 sm:w-11 sm:h-11 shrink-0" />
                    </motion.div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <motion.button 
                        data-tv-focusable="true"
                        tabIndex={0}
                        whileHover={{ scale: 1.03 }} 
                        onClick={() => setCurrentView('movies')} 
                        className="p-3 sm:p-4 glass-card rounded-xl sm:rounded-2xl border border-gold/30 bg-black/60 flex flex-col items-center gap-1.5"
                      >
                        <Icons.Filme className="w-6 h-6 sm:w-7 sm:h-7 text-gold" />
                        <span className="text-xs font-black text-white">{t('movies')}</span>
                      </motion.button>
                      <motion.button 
                        data-tv-focusable="true"
                        tabIndex={0}
                        whileHover={{ scale: 1.03 }} 
                        onClick={() => setCurrentView('series')} 
                        className="p-3 sm:p-4 glass-card rounded-xl sm:rounded-2xl border border-gold/30 bg-black/60 flex flex-col items-center gap-1.5"
                      >
                        <Icons.Serie className="w-6 h-6 sm:w-7 sm:h-7 text-gold" />
                        <span className="text-xs font-black text-white">{t('series')}</span>
                      </motion.button>
                      <motion.button 
                        data-tv-focusable="true"
                        tabIndex={0}
                        whileHover={{ scale: 1.03 }} 
                        onClick={() => setCurrentView('add')} 
                        className="p-3 sm:p-4 glass-card rounded-xl sm:rounded-2xl border border-gold/30 bg-black/60 flex flex-col items-center gap-1.5"
                      >
                        <Icons.Playlist className="w-6 h-6 sm:w-7 sm:h-7 text-gold" />
                        <span className="text-xs font-black text-white">{isRtl ? 'الاشتراكات' : 'Account'}</span>
                      </motion.button>
                      <motion.button 
                        data-tv-focusable="true"
                        tabIndex={0}
                        whileHover={{ scale: 1.03 }} 
                        onClick={() => setCurrentView('settings')} 
                        className="p-3 sm:p-4 glass-card rounded-xl sm:rounded-2xl border border-gold/30 bg-black/60 flex flex-col items-center gap-1.5"
                      >
                        <Settings className="w-6 h-6 sm:w-7 sm:h-7 text-gold" />
                        <span className="text-xs font-black text-white">{t('settings')}</span>
                      </motion.button>
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 14: ANDROID TV LEANBACK                           */}
                {/* ======================================================== */}
                {activeLayout === 'layout-android-tv' && (
                  <div className="w-full max-w-3xl flex flex-col gap-2.5 my-auto py-2">
                    {[
                      { title: t('live'), action: () => setCurrentView('live'), icon: Icons.Live, color: 'border-gold/40 bg-gold/10' },
                      { title: t('movies'), action: () => setCurrentView('movies'), icon: Icons.Filme, color: 'border-gold/40 bg-gold/10' },
                      { title: t('series'), action: () => setCurrentView('series'), icon: Icons.Serie, color: 'border-gold/40 bg-gold/10' },
                      { title: t('settings'), action: () => setCurrentView('settings'), icon: Settings, color: 'border-gold/40 bg-gold/15' },
                    ].map((row, i) => {
                      const RowIcon = row.icon;
                      return (
                        <motion.div 
                          key={i} 
                          data-tv-focusable="true"
                          tabIndex={0}
                          role="button"
                          whileHover={{ scale: 1.02, x: isRtl ? -6 : 6 }} 
                          onClick={row.action} 
                          className={`cursor-pointer p-3 sm:p-3.5 rounded-xl sm:rounded-2xl border-2 ${row.color} glass-card flex items-center justify-between`}
                        >
                          <div className="flex items-center gap-3">
                            <RowIcon className="w-6 h-6 sm:w-7 sm:h-7 text-gold" />
                            <span className="text-sm sm:text-base font-black uppercase text-white">{row.title}</span>
                          </div>
                          <span className="text-xs font-mono text-gold">LEANBACK ➔</span>
                        </motion.div>
                      );
                    })}
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 15: MODERN BENTO GRID                             */}
                {/* ======================================================== */}
                {activeLayout === 'layout-modern-bento' && (
                  <div className="w-full max-w-4xl grid grid-cols-2 sm:grid-cols-4 gap-3 my-auto py-2">
                    <motion.div 
                      data-tv-focusable="true" tabIndex={0} role="button" whileHover={{ scale: 1.02 }} onClick={() => setCurrentView('live')}
                      className="col-span-2 row-span-2 cursor-pointer glass-card p-5 rounded-3xl border-2 border-blue-500/40 bg-gradient-to-br from-blue-950/40 to-black flex flex-col justify-between group min-h-[220px]"
                    >
                      <div className="p-3 rounded-2xl bg-blue-500/20 text-blue-400 w-fit"><Icons.Live className="w-10 h-10" /></div>
                      <div className="space-y-1"><span className="text-[10px] font-mono font-bold text-blue-400 uppercase tracking-widest block">FEATURED LIVE</span><h2 className="text-2xl font-black uppercase text-white group-hover:text-blue-300">{t('live')}</h2></div>
                    </motion.div>
                    <motion.div 
                      data-tv-focusable="true" tabIndex={0} role="button" whileHover={{ scale: 1.02 }} onClick={() => setCurrentView('movies')}
                      className="col-span-2 cursor-pointer glass-card p-4 rounded-3xl border-2 border-gold/40 bg-black/60 flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3"><Icons.Filme className="w-7 h-7 text-gold" /><h3 className="text-base font-black uppercase text-white group-hover:text-gold">{t('movies')}</h3></div>
                      <ChevronRight className="text-gold" size={20} />
                    </motion.div>
                    <motion.div 
                      data-tv-focusable="true" tabIndex={0} role="button" whileHover={{ scale: 1.02 }} onClick={() => setCurrentView('series')}
                      className="col-span-2 cursor-pointer glass-card p-4 rounded-3xl border-2 border-gold/40 bg-black/60 flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3"><Icons.Serie className="w-7 h-7 text-gold" /><h3 className="text-base font-black uppercase text-white group-hover:text-gold">{t('series')}</h3></div>
                      <ChevronRight className="text-gold" size={20} />
                    </motion.div>
                    <motion.div 
                      data-tv-focusable="true" tabIndex={0} role="button" whileHover={{ scale: 1.02 }} onClick={() => setCurrentView('add')}
                      className="cursor-pointer glass-card p-4 rounded-3xl border-2 border-zinc-700 bg-black/60 flex flex-col items-center justify-center group"
                    >
                      <Icons.Playlist className="w-6 h-6 text-zinc-400 group-hover:text-white mb-1" />
                      <span className="text-[10px] font-black text-white uppercase">{isRtl ? 'الحساب' : 'Account'}</span>
                    </motion.div>
                    <motion.div 
                      data-tv-focusable="true" tabIndex={0} role="button" whileHover={{ scale: 1.02 }} onClick={() => setCurrentView('settings')}
                      className="cursor-pointer glass-card p-4 rounded-3xl border-2 border-zinc-700 bg-black/60 flex flex-col items-center justify-center group"
                    >
                      <Settings className="w-6 h-6 text-zinc-400 group-hover:text-white mb-1" />
                      <span className="text-[10px] font-black text-white uppercase">{t('settings')}</span>
                    </motion.div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 16: GLASS SIDEBAR NAV                             */}
                {/* ======================================================== */}
                {activeLayout === 'layout-sidebar-glass' && (
                  <div className="w-full max-w-5xl grid grid-cols-12 gap-4 my-auto py-2">
                    <div className="col-span-3 flex flex-col gap-2 p-2 bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10">
                      {[
                        { id: 'live', icon: Icons.Live, action: () => setCurrentView('live') },
                        { id: 'movies', icon: Icons.Filme, action: () => setCurrentView('movies') },
                        { id: 'series', icon: Icons.Serie, action: () => setCurrentView('series') },
                        { id: 'add', icon: Icons.Playlist, action: () => setCurrentView('add') },
                        { id: 'settings', icon: Settings, action: () => setCurrentView('settings') },
                      ].map(item => (
                        <motion.button 
                          key={item.id} data-tv-focusable="true" tabIndex={0} whileHover={{ scale: 1.05 }} onClick={item.action}
                          className="w-full aspect-square flex items-center justify-center rounded-2xl bg-black/40 border border-white/5 hover:border-gold text-white hover:text-gold transition-all"
                        >
                          <item.icon size={24} />
                        </motion.button>
                      ))}
                    </div>
                    <div className="col-span-9">
                      <motion.div 
                        data-tv-focusable="true" tabIndex={0} role="button" onClick={() => setCurrentView('live')}
                        className="w-full h-full min-h-[300px] rounded-3xl border-2 border-gold/40 bg-gradient-to-tr from-gold-dark/40 to-black p-8 flex flex-col justify-end group cursor-pointer"
                      >
                         <span className="text-xs font-mono font-bold text-gold uppercase tracking-[0.3em] mb-2">GLASS SIDEBAR HUB</span>
                         <h2 className="text-4xl font-black text-white uppercase group-hover:text-gold transition-colors">{t('live')} TV</h2>
                      </motion.div>
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 17: COMPACT TILES                                 */}
                {/* ======================================================== */}
                {activeLayout === 'layout-compact-tiles' && (
                  <div className="w-full max-w-4xl grid grid-cols-3 sm:grid-cols-5 gap-2 my-auto py-2">
                    {[
                      { title: t('live'), icon: Icons.Live, action: () => setCurrentView('live') },
                      { title: t('movies'), icon: Icons.Filme, action: () => setCurrentView('movies') },
                      { title: t('series'), icon: Icons.Serie, action: () => setCurrentView('series') },
                      { title: isRtl ? 'الاشتراكات' : 'Account', icon: Icons.Playlist, action: () => setCurrentView('add') },
                      { title: t('settings'), icon: Settings, action: () => setCurrentView('settings') },
                    ].map((item, i) => (
                      <motion.button 
                        key={i} data-tv-focusable="true" tabIndex={0} whileHover={{ scale: 1.05 }} onClick={item.action}
                        className="aspect-square flex flex-col items-center justify-center gap-1 bg-zinc-900 border border-white/10 rounded-2xl hover:bg-gold hover:text-black group transition-all"
                      >
                        <item.icon size={28} className="text-gold group-hover:text-black transition-colors" />
                        <span className="text-[10px] font-black uppercase text-white group-hover:text-black text-center px-1 line-clamp-1">{item.title}</span>
                      </motion.button>
                    ))}
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 18: PRISM HOLOGRAM DECK                           */}
                {/* ======================================================== */}
                {activeLayout === 'layout-full-hero' && (
                  <div className="w-full max-w-6xl my-auto py-8">
                    <div className="flex flex-wrap items-center justify-center gap-8 perspective-2000">
                      {[
                        { id: 'live', title: t('live'), icon: Icons.Live, color: 'from-gold via-gold-dark to-black', action: () => setCurrentView('live'), desc: 'Ultra HD Broadcast' },
                        { id: 'movies', title: t('movies'), icon: Icons.Filme, color: 'from-blue-600 via-blue-900 to-black', action: () => setCurrentView('movies'), desc: 'Cinema 4K VOD' },
                        { id: 'series', title: t('series'), icon: Icons.Serie, color: 'from-purple-600 via-purple-900 to-black', action: () => setCurrentView('series'), desc: 'Premium Series' },
                        { id: 'add', title: isRtl ? 'الاشتراكات' : 'Account', icon: Icons.Playlist, color: 'from-emerald-600 via-emerald-900 to-black', action: () => setCurrentView('add'), desc: 'Portals & Playlists' },
                        { id: 'settings', title: t('settings'), icon: Settings, color: 'from-zinc-600 via-zinc-800 to-black', action: () => setCurrentView('settings'), desc: 'System Configuration' },
                      ].map((card, i) => (
                        <motion.div
                          key={card.id}
                          data-tv-focusable="true"
                          tabIndex={0}
                          role="button"
                          initial={{ opacity: 0, y: 50, rotateX: 20 }}
                          animate={{ opacity: 1, y: 0, rotateX: 0 }}
                          transition={{ delay: i * 0.1 }}
                          whileHover={{ scale: 1.1, rotateY: 10, z: 100 }}
                          onClick={card.action}
                          className={`w-48 h-72 rounded-[2rem] bg-gradient-to-br ${card.color} border border-white/20 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] relative overflow-hidden flex flex-col items-center justify-between p-6 group cursor-pointer transition-all duration-500`}
                        >
                          <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                          <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 blur-[40px] rounded-full group-hover:bg-white/20 transition-all" />
                          
                          <div className="p-5 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 shadow-xl group-hover:scale-110 group-hover:border-white/30 transition-all">
                            <card.icon size={40} className="text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]" />
                          </div>
                          
                          <div className="text-center w-full">
                            <h3 className="text-xl font-black text-white uppercase tracking-tight">{card.title}</h3>
                            <div className="h-0.5 w-8 bg-gold mx-auto my-2 group-hover:w-16 transition-all" />
                            <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">{card.desc}</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 19: SPLIT HERO GRID                               */}
                {/* ======================================================== */}
                {activeLayout === 'layout-split-hero' && (
                  <div className="w-full max-w-5xl grid grid-cols-12 gap-3 my-auto py-2">
                    <motion.div 
                      data-tv-focusable="true" tabIndex={0} role="button" onClick={() => setCurrentView('live')}
                      className="col-span-7 h-[280px] rounded-3xl border-2 border-gold/40 bg-black/60 p-8 flex flex-col justify-end group cursor-pointer relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 w-32 h-32 bg-gold/10 blur-[60px] rounded-full" />
                      <h2 className="text-3xl font-black text-white uppercase group-hover:text-gold transition-all">{t('live')} STREAM</h2>
                      <p className="text-xs text-zinc-400 mt-1 uppercase font-bold tracking-widest">{isRtl ? 'البث المباشر المتميز' : 'PREMIUM TV PORTAL'}</p>
                    </motion.div>
                    <div className="col-span-5 grid grid-cols-2 gap-3">
                      <motion.div 
                        data-tv-focusable="true" tabIndex={0} role="button" whileHover={{ scale: 1.05 }} onClick={() => setCurrentView('movies')}
                        className="col-span-2 h-[130px] rounded-3xl bg-blue-600/20 border border-blue-500/30 p-4 flex items-center justify-between group cursor-pointer"
                      >
                        <div><h3 className="text-lg font-black text-white uppercase group-hover:text-blue-300 transition-colors">{t('movies')}</h3><span className="text-[10px] text-blue-400 font-bold uppercase">4K ULTRA VOD</span></div>
                        <Icons.Filme className="w-10 h-10 text-blue-500/40" />
                      </motion.div>
                      <motion.button 
                        data-tv-focusable="true" tabIndex={0} whileHover={{ scale: 1.05 }} onClick={() => setCurrentView('series')}
                        className="h-[135px] rounded-3xl bg-purple-600/20 border border-purple-500/30 flex flex-col items-center justify-center gap-1 group"
                      >
                        <Icons.Serie className="w-8 h-8 text-purple-400 group-hover:text-purple-300" />
                        <span className="text-[10px] font-black text-white uppercase">{t('series')}</span>
                      </motion.button>
                      <motion.button 
                        data-tv-focusable="true" tabIndex={0} whileHover={{ scale: 1.05 }} onClick={() => setCurrentView('settings')}
                        className="h-[135px] rounded-3xl bg-zinc-800/40 border border-white/10 flex flex-col items-center justify-center gap-1 group"
                      >
                        <Settings className="w-8 h-8 text-zinc-400 group-hover:text-white" />
                        <span className="text-[10px] font-black text-white uppercase">{t('settings')}</span>
                      </motion.button>
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* LAYOUT 20: COSMIC NEBULA ORBIT                           */}
                {/* ======================================================== */}
                {activeLayout === 'layout-floating-strip' && (
                  <div className="w-full h-full flex flex-col items-center justify-center my-auto py-4 relative perspective-3000 overflow-hidden">
                    {/* Nebula Background */}
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gold/5 blur-[150px] rounded-full animate-pulse" />
                      <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-white rounded-full blur-[1px] animate-bokeh" />
                      <div className="absolute bottom-1/4 right-1/3 w-1 h-1 bg-gold rounded-full blur-[1px] animate-pulse" />
                    </div>

                    <div className="relative w-[450px] h-[450px] flex items-center justify-center">
                       {/* Cosmic Core */}
                       <motion.div 
                         animate={{ 
                           boxShadow: ['0 0 50px rgba(212,175,55,0.4)', '0 0 100px rgba(212,175,55,0.7)', '0 0 50px rgba(212,175,55,0.4)'] 
                         }}
                         transition={{ duration: 4, repeat: Infinity }}
                         className="w-28 h-28 rounded-full bg-black border-4 border-gold/60 flex items-center justify-center z-30 relative overflow-hidden p-1 shadow-2xl"
                       >
                         <img src="/logo.jpg" alt="" className="w-full h-full object-cover rounded-full" />
                         <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent animate-shimmer" />
                       </motion.div>

                       {/* Orbital Rings */}
                       <div className="absolute inset-0 border border-white/5 rounded-full scale-100" />
                       <div className="absolute inset-0 border border-white/5 rounded-full scale-[0.7]" />

                       {/* Cosmic Items */}
                       {[
                         { id: 'live', icon: Icons.Live, action: () => setCurrentView('live'), angle: -90, color: 'from-red-500 to-red-900', label: t('live') },
                         { id: 'movies', icon: Icons.Filme, action: () => setCurrentView('movies'), angle: -20, color: 'from-blue-500 to-blue-900', label: t('movies') },
                         { id: 'series', icon: Icons.Serie, action: () => setCurrentView('series'), angle: 45, color: 'from-purple-500 to-purple-900', label: t('series') },
                         { id: 'add', icon: Icons.Playlist, action: () => setCurrentView('add'), angle: 135, color: 'from-emerald-500 to-emerald-900', label: isRtl ? 'الاشتراكات' : 'Portals' },
                         { id: 'settings', icon: Settings, action: () => setCurrentView('settings'), angle: 210, color: 'from-zinc-500 to-zinc-900', label: t('settings') },
                       ].map((item, i) => {
                         const radius = 180;
                         const x = radius * Math.cos((item.angle * Math.PI) / 180);
                         const y = radius * Math.sin((item.angle * Math.PI) / 180);

                         return (
                           <motion.button
                             key={item.id}
                             data-tv-focusable="true"
                             tabIndex={0}
                             initial={{ opacity: 0, scale: 0 }}
                             animate={{ opacity: 1, scale: 1 }}
                             transition={{ delay: i * 0.15 }}
                             whileHover={{ scale: 1.25, rotate: 5, z: 200 }}
                             onClick={item.action}
                             style={{ 
                               left: `calc(50% + ${x}px - 36px)`, 
                               top: `calc(50% + ${y}px - 36px)` 
                             }}
                             className="absolute w-20 h-20 rounded-3xl bg-zinc-950 border-2 border-white/10 shadow-[0_20px_40px_rgba(0,0,0,0.5)] flex flex-col items-center justify-center group focus:ring-4 focus:ring-gold focus:scale-125 z-20 transition-all overflow-hidden"
                           >
                              <div className={`absolute inset-0 bg-gradient-to-br ${item.color} opacity-10 group-hover:opacity-40 transition-opacity`} />
                              <item.icon size={32} className="text-white relative z-10 drop-shadow-lg group-hover:scale-110 transition-transform" />
                              <div className="absolute bottom-1 text-[8px] font-black uppercase text-gold/80 tracking-tighter z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                                {item.label}
                              </div>
                           </motion.button>
                         );
                       })}
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          );
        })()}

        {/* Toast Notification */}
        <AnimatePresence>
          {refreshToast && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 bg-zinc-950/95 border border-gold/40 text-gold rounded-2xl shadow-2xl text-[11px] font-bold backdrop-blur-md"
            >
              <CheckCircle2 size={14} className="text-emerald-400" />
              <span>{t('data_refreshed')}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* New Modals */}
        <AnimatePresence>
          {showSpeedTest && (
            <SpeedTestModal 
              serverUrl={activePlaylistData?.url} 
              onClose={() => setShowSpeedTest(false)} 
            />
          )}
          {showNotifications && (
            <NotificationsModal 
              notifications={settings.notifications || []} 
              onClose={() => setShowNotifications(false)}
              onClear={() => onUpdateSettings(prev => ({ ...prev, notifications: [] }))}
              onRead={(id) => onUpdateSettings(prev => ({
                ...prev,
                notifications: (prev.notifications || []).map(n => n.id === id ? { ...n, read: true } : n)
              }))}
            />
          )}
          {showKidsUnlock && (
            <PinUnlockModal 
              isOpen={showKidsUnlock}
              correctPin={settings.kidsModePin || '1234'}
              onSuccess={() => {
                onUpdateSettings(prev => ({ ...prev, kidsModeActive: false }));
                setShowKidsUnlock(false);
              }}
              onClose={() => setShowKidsUnlock(false)}
              playlistName={isRtl ? 'وضع الأطفال' : 'Kids Mode'}
              language={settings.language}
            />
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

// Importing new components
import SpeedTestModal from './SpeedTestModal';
import NotificationsModal from './NotificationsModal';


function HubCard({ 
  onClick, 
  icon, 
  label, 
  subLabel, 
  scale = 'medium' 
}: { 
  onClick: () => void; 
  icon: React.ReactNode; 
  label: string; 
  subLabel?: string;
  scale?: 'small' | 'medium' | 'large';
}) {
  const sizeClasses = 
    scale === 'small' 
      ? 'w-18 sm:w-24 md:w-28 h-22 sm:h-26 md:h-30 p-1.5' 
      : scale === 'large' 
        ? 'w-22 sm:w-30 md:w-34 h-26 sm:h-30 md:h-36 p-2.5' 
        : 'w-20 sm:w-28 md:w-32 h-24 sm:h-28 md:h-34 p-2';

  return (
    <motion.button
      data-tv-focusable="true"
      tabIndex={0}
      whileHover={{ scale: 1.05, y: -2 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={`${sizeClasses} rounded-2xl glass-card border-2 border-gold/40 hover:border-gold focus:outline-none focus:ring-4 focus:ring-gold focus:scale-105 bg-black/75 hover:bg-black/90 shadow-[0_0_15px_rgba(212,175,55,0.2)] flex flex-col items-center justify-between text-center group cursor-pointer transition-all duration-200 relative overflow-hidden shrink-0`}
    >
      <div className="flex-1 flex items-center justify-center group-hover:scale-105 transition-transform duration-200 overflow-hidden">
        {icon}
      </div>
      <div className="flex flex-col items-center gap-0.5 z-10 w-full pt-1 border-t border-white/10 shrink-0">
        <span className="text-[9px] sm:text-[10px] md:text-xs font-black tracking-wider uppercase text-gold group-hover:brightness-125 transition-all truncate w-full">
          {label}
        </span>
        {subLabel && (
          <span className="text-[7px] sm:text-[8px] md:text-[9px] text-zinc-300 font-bold tracking-normal opacity-90 group-hover:opacity-100 transition-opacity truncate w-full">
            {subLabel}
          </span>
        )}
      </div>
    </motion.button>
  );
}
