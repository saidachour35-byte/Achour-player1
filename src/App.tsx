import React, { useState, useEffect } from 'react';
import { getPublicId } from './lib/firebase';
import Dashboard from './components/Dashboard';
import SplashScreen from './components/SplashScreen';
import AnimatedBackground from './components/AnimatedBackground';
import { motion, AnimatePresence } from 'framer-motion';
import { AppSettings, Language, Playlist } from './types';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './lib/firebase';
import { applyRoyalTheme } from './utils/themeManager';
import { DEFAULT_PLAYERS } from './components/SettingsView';
import { runStorageCleanup } from './utils/storageCleanup';
import { parseTVKeyEvent, executeBackHandler, isTextInput } from './utils/tvNavigation';
import { isFireTV } from './utils/platform';

const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  hiddenCategories: [],
  hiddenLiveCategories: [],
  hiddenMovieCategories: [],
  hiddenSeriesCategories: [],
  timeFormat: '24h',
  viewMode: 'list',
  useExternalPlayer: false,
  externalPlayers: DEFAULT_PLAYERS,
  selectedPlayer: 'Achour Player (مدمج - Native)',
  installedPlayers: ['Achour Player (مدمج - Native)'],
  activePlaylistId: null,
  searchHistory: {
    movies: [],
    series: [],
  },
  royalThemeColor: 'royal-gold',
  icon3DStyle: 'style-gold-3d',
  backgroundStyle: 'anim-golden-dust',
  customBackground: null,
  vpnEnabled: true,
  vpnRegion: 'auto',
  vpnMode: 'auto-relay',
  dashboardLayout: 'layout-smarttv-hero',
  splashSoundTrack: 'cinematic_netflix',
  splashStyle: 'modern_cinematic',
  iconScale: 'medium',
  zoomScale: 98,
  kidsModeActive: false,
  kidsModePin: '1234',
  notifications: [],
};

import XtreamDebugOverlay from './components/XtreamDebugOverlay';

export default function App() {
  const [userId, setUserId] = useState<string>(() => getPublicId());
  const [showSplash, setShowSplash] = useState(true);
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('achour_settings_v2');
    let initial = DEFAULT_SETTINGS;
    
    // Auto-detect Fire TV for better defaults
    if (isFireTV()) {
      initial = {
        ...initial,
        selectedPlayer: 'Fire TV Player (مشغل فاير تي في)',
        useExternalPlayer: false // Use internal player configured for Fire TV by default
      };
    }

    if (!saved) return initial;
    try {
      const parsed = JSON.parse(saved);
      return {
        ...initial,
        ...parsed,
        searchHistory: {
          ...initial.searchHistory,
          ...(parsed.searchHistory || {})
        }
      };
    } catch (e) {
      return initial;
    }
  });

  // Load active playlist for 15s preloading
  useEffect(() => {
    const loadActivePlaylist = async () => {
      try {
        const localSaved = localStorage.getItem('achour_local_playlists');
        const localList: Playlist[] = localSaved ? JSON.parse(localSaved) : [];
        if (settings.activePlaylistId) {
          const found = localList.find(p => p.id === settings.activePlaylistId);
          if (found) {
            setActivePlaylist(found);
            return;
          }
          try {
            const snap = await getDoc(doc(db, 'playlists', settings.activePlaylistId));
            if (snap.exists()) {
              setActivePlaylist({ id: snap.id, ...snap.data() } as Playlist);
              return;
            }
          } catch (e) {}
        }
        if (localList.length > 0) {
          setActivePlaylist(localList[0]);
          return;
        }
        try {
          const q = query(collection(db, 'playlists'), where('userId', '==', userId));
          const res = await getDocs(q);
          if (!res.empty) {
            setActivePlaylist({ id: res.docs[0].id, ...res.docs[0].data() } as Playlist);
          }
        } catch (e) {}
      } catch (err) {}
    };
    loadActivePlaylist();
  }, [userId, settings.activePlaylistId]);

  useEffect(() => {
    // Safety fallback timer for 15-second splash screen to prevent any infinite stall
    const splashTimer = setTimeout(() => {
      setShowSplash(false);
    }, 16000);

    try {
      const id = getPublicId();
      if (id) setUserId(id);

      runStorageCleanup();
    } catch (err) {
      console.warn('App initialization storage notice:', err);
    }

    return () => clearTimeout(splashTimer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('achour_settings_v2', JSON.stringify(settings));
    } catch (e) {}
    document.documentElement.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = settings.language;
    applyRoyalTheme(settings.royalThemeColor || 'royal-gold');
  }, [settings]);

  // Global Hardware Back Key Interceptor for Android TV, Fire TV & Android Phones
  useEffect(() => {
    const triggerBack = (): boolean => {
      const handled = executeBackHandler();
      if (handled) return true;

      // Dispatched custom event for child components
      const event = new CustomEvent('app_back_pressed');
      window.dispatchEvent(event);
      return false;
    };

    (window as any).handleAndroidBack = () => {
      triggerBack();
    };

    const handleGlobalBack = (e: KeyboardEvent) => {
      const action = parseTVKeyEvent(e);
      if (action === 'BACK') {
        if (e.key === 'Backspace' && isTextInput(document.activeElement)) {
          return;
        }

        const handled = triggerBack();
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalBack, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleGlobalBack, { capture: true });
      delete (window as any).handleAndroidBack;
    };
  }, []);

  return (
    <div className={`min-h-screen w-full bg-[#080808] text-white selection:bg-[#D4AF37]/30 ${settings.language === 'ar' ? 'font-cairo' : 'font-sans'} relative overflow-x-hidden`}>
      {/* App Backgrounds */}
      <AnimatedBackground settings={settings} />

      {/* Hidden Debug Overlay */}
      <XtreamDebugOverlay />

      {/* Animated 3D Logo & Intro Music Splash Screen */}
      <AnimatePresence>
        {showSplash && (
          <SplashScreen 
            onComplete={() => setShowSplash(false)} 
            royalThemeId={settings.royalThemeColor || 'royal-gold'} 
            soundTrack={settings.splashSoundTrack || 'cinematic_netflix'}
            splashStyle={settings.splashStyle || 'floating_3d'}
            activePlaylist={activePlaylist}
            userId={userId}
            language={settings.language || 'en'}
          />
        )}
      </AnimatePresence>

      {/* Main Dashboard & Content */}
      <div 
        className="relative z-10 min-h-screen w-full transition-transform duration-200"
        style={{
          transform: `scale(${(settings.zoomScale || 100) / 100})`,
          transformOrigin: 'center center'
        }}
      >
        {userId && (
          <Dashboard 
            userId={userId} 
            settings={settings} 
            onUpdateSettings={setSettings} 
            onTriggerSplash={() => setShowSplash(true)}
          />
        )}
      </div>
    </div>
  );
}

