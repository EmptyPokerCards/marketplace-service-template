import { proxyFetch } from '../proxy';

export interface AppStoreItem {
  rank?: number;
  appName: string;
  developer: string;
  appId: string; // Bundle ID
  numericId?: string;
  rating: number;
  ratingCount: number;
  price: string;
  inAppPurchases: boolean;
  category: string;
  lastUpdated: string;
  size: string;
  icon: string;
}

function formatBytes(bytes: number | string): string {
  const num = typeof bytes === 'string' ? parseInt(bytes) : bytes;
  if (isNaN(num) || num <= 0) return 'Unknown';
  const mb = num / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function normalizeApp(app: any, rank?: number): AppStoreItem {
  return {
    rank,
    appName: app.trackCensoredName || app.trackName || 'Unknown App',
    developer: app.artistName || 'Unknown Developer',
    appId: app.bundleId || '',
    numericId: app.trackId?.toString() || '',
    rating: parseFloat((app.averageUserRating || 0).toFixed(1)),
    ratingCount: app.userRatingCount || 0,
    price: app.formattedPrice || (app.price === 0 ? 'Free' : `$${app.price}`),
    inAppPurchases: app.features?.includes('iosAppStoreInAppPurchases') || false,
    category: app.primaryGenreName || (app.genres && app.genres[0]) || 'Utilities',
    lastUpdated: app.currentVersionReleaseDate ? app.currentVersionReleaseDate.split('T')[0] : 'Unknown',
    size: formatBytes(app.fileSizeBytes),
    icon: app.artworkUrl100 || app.artworkUrl512 || app.artworkUrl60 || '',
  };
}

export async function searchAppStore(query: string, country: string = 'US', limit: number = 20): Promise<AppStoreItem[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${country.toLowerCase()}&entity=software&limit=${limit}`;
  
  try {
    const res = await proxyFetch(url);
    if (!res.ok) throw new Error(`iTunes Search API error: ${res.status}`);
    
    const data = (await res.json()) as { results: any[] };
    return data.results.map((app, idx) => normalizeApp(app, idx + 1));
  } catch (error) {
    console.error(`[AppStore Scraper] Search failed for "${query}":`, error);
    throw error;
  }
}

export async function lookupAppStore(appId: string, country: string = 'US'): Promise<AppStoreItem | null> {
  const isNumeric = /^\d+$/.test(appId);
  const param = isNumeric ? `id=${appId}` : `bundleId=${appId}`;
  const url = `https://itunes.apple.com/lookup?${param}&country=${country.toLowerCase()}`;

  try {
    const res = await proxyFetch(url);
    if (!res.ok) throw new Error(`iTunes Lookup API error: ${res.status}`);

    const data = (await res.json()) as { results: any[] };
    if (!data.results || data.results.length === 0) {
      return null;
    }
    return normalizeApp(data.results[0]);
  } catch (error) {
    console.error(`[AppStore Scraper] Lookup failed for "${appId}":`, error);
    throw error;
  }
}

export async function getAppStoreRankings(
  country: string = 'US',
  category: string = 'all',
  limit: number = 50
): Promise<AppStoreItem[]> {
  const feedType = 'top-free';
  const url = `https://rss.applemarketingtools.com/api/v2/${country.toLowerCase()}/apps/${feedType}/${limit}/apps.json`;

  try {
    const res = await proxyFetch(url);
    if (!res.ok) throw new Error(`Apple RSS feed error: ${res.status}`);

    const data = (await res.json()) as any;
    const rssApps = data.feed?.results || [];
    if (rssApps.length === 0) return [];

    const appIds = rssApps.map((a: any) => a.id);
    const lookupUrl = `https://itunes.apple.com/lookup?id=${appIds.join(',')}&country=${country.toLowerCase()}`;
    
    const lookupRes = await proxyFetch(lookupUrl);
    if (!lookupRes.ok) {
      return rssApps.map((a: any, idx: number) => ({
        rank: idx + 1,
        appName: a.name,
        developer: a.artistName,
        appId: a.id,
        rating: 0,
        ratingCount: 0,
        price: 'Free',
        inAppPurchases: false,
        category: a.genres?.[0]?.name || 'App',
        lastUpdated: 'Unknown',
        size: 'Unknown',
        icon: a.artworkUrl100 || '',
      }));
    }

    const lookupData = (await lookupRes.json()) as { results: any[] };
    const lookupMap = new Map<string, any>();
    lookupData.results.forEach((app) => {
      lookupMap.set(app.trackId.toString(), app);
    });

    let results = rssApps.map((rssApp: any, idx: number) => {
      const details = lookupMap.get(rssApp.id);
      if (details) {
        return normalizeApp(details, idx + 1);
      }
      return {
        rank: idx + 1,
        appName: rssApp.name,
        developer: rssApp.artistName,
        appId: rssApp.id,
        rating: 0,
        ratingCount: 0,
        price: 'Free',
        inAppPurchases: false,
        category: rssApp.genres?.[0]?.name || 'App',
        lastUpdated: 'Unknown',
        size: 'Unknown',
        icon: rssApp.artworkUrl100 || '',
      };
    });

    if (category && category !== 'all' && category !== 'games') {
      const catLower = category.toLowerCase();
      results = results.filter((app) => app.category.toLowerCase().includes(catLower));
    } else if (category === 'games') {
      results = results.filter(
        (app) => app.category.toLowerCase() === 'games' || app.category.toLowerCase() === 'action'
      );
    }

    return results;
  } catch (error) {
    console.error(`[AppStore Scraper] Failed to fetch rankings for country=${country}:`, error);
    throw error;
  }
}
