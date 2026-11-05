export type PlaylistType = 'm3u' | 'xtream' | 'stalker';

export interface Playlist {
  id: string;
  name: string;
  type: PlaylistType;
  url?: string;
  m3uContent?: string;
  username?: string;
  password?: string;
  portal?: string;
  macAddress?: string;
  isProtected?: boolean;
  pin?: string;
  userId?: string;
  createdAt?: any;
  expDate?: number | string | null;
  epgUrl?: string;
  error?: string;
}

export interface Channel {
  id: string;
  name: string;
  logo?: string;
  url: string;
  category?: string;
  category_id?: string;
  type: 'live' | 'movie' | 'series';
  isFavorite?: boolean;
  stream_id?: string;
}

export interface VodItem {
  id: string | number;
  series_id?: string | number;
  name?: string;
  title?: string;
  logo?: string;
  cover?: string;
  stream_icon?: string;
  url?: string;
  stream_url?: string;
  container_extension?: string;
  stream_id?: string | number;
  category_id?: string;
  category_name?: string;
  rating?: string | number;
  year?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
}

export interface SeriesEpisode {
  id: string | number;
  title?: string;
  name?: string;
  season_num?: number;
  episode_num?: number;
  url?: string;
  stream_url?: string;
  direct_source?: string;
  cover?: string;
  duration?: string;
  info?: any;
}

export interface FavoriteItem {
  id: string;
  name: string;
  logo?: string;
  url: string;
  category?: string;
  category_id?: string;
  type: 'live' | 'movie' | 'series';
  addedAt?: string;
}

export type Language = 'ar' | 'de' | 'en' | 'fr';
export type TimeFormat = '12h' | '24h';
export type ViewMode = 'list' | 'grid';

export interface AppSettings {
  language: Language;
  parentalPassword?: string;
  hiddenCategories: string[];
  hiddenLiveCategories?: string[];
  hiddenMovieCategories?: string[];
  hiddenSeriesCategories?: string[];
  timeFormat: TimeFormat;
  viewMode: ViewMode;
  useExternalPlayer: boolean;
  externalPlayers: string[];
  selectedPlayer: string;
  installedPlayers: string[];
  activePlaylistId: string | null;
  searchHistory: {
    movies: string[];
    series: string[];
  };
  royalThemeColor?: string;
  icon3DStyle?: string;
  backgroundStyle?: string;
  customBackground?: {
    type: 'image' | 'video';
    url: string;
    name?: string;
  } | null;
  categoryOrders?: {
    live?: string[];
    movie?: string[];
    series?: string[];
    favorites?: string[];
  };
  channelOrders?: {
    live?: string[];
    movie?: string[];
    series?: string[];
    favorites?: string[];
  };
  vpnEnabled?: boolean;
  vpnRegion?: 'auto' | 'nl' | 'de' | 'uk' | 'us' | 'ae';
  vpnMode?: 'auto-relay' | 'force-proxy' | 'direct';
  dashboardLayout?: string;
  splashSoundTrack?: 'cinematic_netflix' | 'royal_brass' | 'soft_chime' | 'sub_bass_woosh' | 'mute';
  splashStyle?: 'floating_3d' | 'cinema_pulse' | 'neon_orbit' | 'minimal_zoom' | 'modern_cinematic' | 'tv_gold_crown' | 'minimal_neon';
  iconScale?: 'small' | 'medium' | 'large';
  zoomScale?: number;
  kidsModeActive?: boolean;
  kidsModePin?: string;
  notifications?: NotificationItem[];
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'alert' | 'success' | 'subscription';
  date: string;
  read: boolean;
}

export interface AppState {
  playlists: Playlist[];
  activePlaylistId: string | null;
  channels: Channel[];
  favorites: string[]; // channel ids
  currentChannel: Channel | null;
  searchQuery: string;
  activeCategory: string;
  settings: AppSettings;
}

export interface EPGProgram {
  title: string;
  description?: string;
  start: Date;
  stop: Date;
  channelId: string;
  id?: string;
}

export interface EPGData {
  [channelId: string]: EPGProgram[];
}

