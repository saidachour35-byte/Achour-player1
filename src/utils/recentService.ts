
const RECENT_KEY = 'achour_recently_watched';
const MAX_RECENTS = 20;

export interface RecentChannel {
  id: string;
  name: string;
  logo?: string;
  url: string;
  category?: string;
  timestamp: number;
}

export const getRecents = (): RecentChannel[] => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};

export const addToRecents = (channel: any) => {
  try {
    const recents = getRecents();
    const filtered = recents.filter(r => r.id !== channel.stream_id && r.id !== channel.id);
    
    const newItem: RecentChannel = {
      id: channel.stream_id || channel.id,
      name: channel.name,
      logo: channel.stream_icon || channel.logo,
      url: channel.url,
      category: channel.category_name || channel.category,
      timestamp: Date.now()
    };
    
    const updated = [newItem, ...filtered].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('recents_updated'));
  } catch (e) {}
};
