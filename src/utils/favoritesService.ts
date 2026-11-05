import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, sanitizeForFirestore } from '../lib/firebase';
import { FavoriteItem } from '../types';

const STORAGE_KEY = 'achour_favorites';
const STORAGE_ITEMS_KEY = 'achour_favorite_items';
const EVENT_NAME = 'achour_favorites_changed';

/**
 * Reads local cached favorite IDs
 */
export function getLocalFavoriteIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Reads local cached full favorite items
 */
export function getLocalFavoriteItems(): FavoriteItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_ITEMS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Synchronizes favorites from Firestore user profile with local storage.
 * Merges both sets of IDs to ensure no favorites are lost.
 */
export async function syncFavoritesFromFirestore(userId: string): Promise<string[]> {
  const localIds = getLocalFavoriteIds();
  if (!userId) return localIds;

  try {
    const path = `user_preferences/${userId}`;
    const snap = await getDoc(doc(db, 'user_preferences', userId));

    if (snap.exists()) {
      const data = snap.data();
      const remoteIds: string[] = Array.isArray(data.favorites) ? data.favorites.map(String) : [];
      
      // Combine unique IDs
      const combined = Array.from(new Set([...localIds, ...remoteIds]));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(combined));

      if (Array.isArray(data.favoriteItems) && data.favoriteItems.length > 0) {
        const localItems = getLocalFavoriteItems();
        const mergedItemsMap = new Map<string, FavoriteItem>();
        localItems.forEach(i => mergedItemsMap.set(String(i.id), i));
        data.favoriteItems.forEach((i: FavoriteItem) => {
          if (i && i.id) mergedItemsMap.set(String(i.id), i);
        });
        localStorage.setItem(STORAGE_ITEMS_KEY, JSON.stringify(Array.from(mergedItemsMap.values())));
      }

      // If remote differed, sync merged list back
      if (combined.length !== remoteIds.length) {
        await persistFavoritesToFirestore(userId, combined).catch(() => {});
      }

      return combined;
    } else {
      // Document does not exist yet; persist local favorites if any
      if (localIds.length > 0) {
        await persistFavoritesToFirestore(userId, localIds).catch(() => {});
      }
      return localIds;
    }
  } catch (err) {
    console.warn('Firestore favorites sync notice:', err);
    return localIds;
  }
}

/**
 * Persists the favorite IDs and optional items metadata to Firestore
 */
export async function persistFavoritesToFirestore(
  userId: string, 
  favoriteIds: string[], 
  extraItems?: FavoriteItem[]
): Promise<void> {
  if (!userId) return;

  const currentItems = extraItems || getLocalFavoriteItems();
  const filteredItems = currentItems.filter(item => favoriteIds.includes(String(item.id)));

  const rawPayload: any = {
    userId,
    favorites: favoriteIds,
    favoriteItems: filteredItems.slice(0, 500), // Protect payload size limit
    updatedAt: new Date().toISOString()
  };
  const payload = sanitizeForFirestore(rawPayload);

  try {
    await setDoc(doc(db, 'user_preferences', userId), payload, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `user_preferences/${userId}`);
  }

  // Also persist in users/{userId} for direct profile access
  try {
    await setDoc(doc(db, 'users', userId), payload, { merge: true });
  } catch (err) {
    // Non-blocking secondary write
  }
}

/**
 * Toggles a favorite stream/channel ID and persists immediately.
 * Broadcasts changes to all listening views.
 */
export async function toggleFavorite(
  userId: string,
  streamId: string,
  channelInfo?: {
    name?: string;
    logo?: string;
    url?: string;
    category?: string;
    category_id?: string;
    type?: 'live' | 'movie' | 'series';
  }
): Promise<string[]> {
  const currentIds = getLocalFavoriteIds();
  const idStr = String(streamId);
  const exists = currentIds.includes(idStr);
  const nextIds = exists ? currentIds.filter(id => id !== idStr) : [...currentIds, idStr];

  // Update local storage IDs
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextIds));

  // Update cached full items
  let items = getLocalFavoriteItems();
  if (exists) {
    items = items.filter(i => String(i.id) !== idStr);
  } else if (channelInfo) {
    const newItem: FavoriteItem = sanitizeForFirestore({
      id: idStr,
      name: channelInfo.name || `Channel ${idStr}`,
      logo: channelInfo.logo || '',
      url: channelInfo.url || '',
      category: channelInfo.category || channelInfo.category_id || 'عام',
      category_id: channelInfo.category_id || channelInfo.category || 'general',
      type: channelInfo.type || 'live',
      addedAt: new Date().toISOString()
    });
    items = [newItem, ...items.filter(i => String(i.id) !== idStr)];
  }
  localStorage.setItem(STORAGE_ITEMS_KEY, JSON.stringify(items));

  // Broadcast event across UI
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { favorites: nextIds } }));

  // Asynchronously persist to Firestore
  if (userId) {
    persistFavoritesToFirestore(userId, nextIds, items).catch(err => {
      console.warn('Async favorite persistence notice:', err);
    });
  }

  return nextIds;
}

/**
 * Subscribes to favorite changes across tabs and components
 */
export function subscribeFavorites(callback: (favorites: string[]) => void): () => void {
  const handleCustomEvent = (e: any) => {
    if (e.detail?.favorites) {
      callback(e.detail.favorites);
    } else {
      callback(getLocalFavoriteIds());
    }
  };

  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      try {
        const next = e.newValue ? JSON.parse(e.newValue) : [];
        callback(next);
      } catch {
        callback(getLocalFavoriteIds());
      }
    }
  };

  window.addEventListener(EVENT_NAME, handleCustomEvent);
  window.addEventListener('storage', handleStorageEvent);

  return () => {
    window.removeEventListener(EVENT_NAME, handleCustomEvent);
    window.removeEventListener('storage', handleStorageEvent);
  };
}
