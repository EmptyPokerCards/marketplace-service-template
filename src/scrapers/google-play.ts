import { proxyFetch } from '../proxy';
import { type AppStoreItem } from './app-store';

function parseGooglePlayAppHtml(html: string, appId: string): AppStoreItem | null {
  try {
    const scriptPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    
    while ((match = scriptPattern.exec(html)) !== null) {
      try {
        const rawJson = match[1].trim();
        const data = JSON.parse(rawJson);
        
        if (
          data &&
          typeof data === 'object' &&
          (data['@type'] === 'SoftwareApplication' || 'aggregateRating' in data)
        ) {
          const ratingData = data.aggregateRating || {};
          const authorData = data.author || {};
          const offers = data.offers || [];
          
          const priceVal = offers[0]?.price;
          const priceStr = priceVal === '0' || priceVal === 0 || !priceVal ? 'Free' : `$${priceVal}`;
          
          const dateRegex = /Updated on<\/div>.*?<div[^>]*>([^<]+)<\/div>/i;
          const dateMatch = html.match(dateRegex);
          let lastUpdated = 'Unknown';
          if (dateMatch) {
            const rawDate = dateMatch[1].trim();
            try {
              lastUpdated = new Date(rawDate).toISOString().split('T')[0];
            } catch {
              lastUpdated = rawDate;
            }
          }
          
          return {
            appName: data.name || 'Unknown',
            developer: authorData.name || 'Unknown',
            appId,
            rating: parseFloat(parseFloat(ratingData.ratingValue || 0).toFixed(1)),
            ratingCount: parseInt((ratingData.ratingCount || 0).toString().replace(/[^\d]/g, '')),
            price: priceStr,
            inAppPurchases: html.includes('Offers in-app purchases') || html.includes('In-app purchases'),
            category: data.applicationCategory || 'Utilities',
            lastUpdated,
            size: 'Varies with device',
            icon: data.image || '',
          };
        }
      } catch (e) {
        continue;
      }
    }
  } catch (err) {
    console.error('[GooglePlay Scraper] JSON-LD extraction error, using regex fallback:', err);
  }

  const nameRegex = /<meta\s+itemprop="name"\s+content="([^"]+)"/i;
  const ratingValueRegex = /<meta\s+itemprop="ratingValue"\s+content="([^"]+)"/i;
  const ratingCountRegex = /<meta\s+itemprop="ratingCount"\s+content="([^"]+)"/i;
  const priceRegex = /<meta\s+itemprop="price"\s+content="([^"]+)"/i;
  const imageRegex = /<meta\s+itemprop="image"\s+content="([^"]+)"/i;
  const developerRegex = /<div\s+itemprop="author"[^>]*>[\s\S]*?<meta\s+itemprop="name"\s+content="([^"]+)"/i;
  const titleRegex = /<title[^>]*>([\s\S]*?)<\/title>/i;
  const devBackupRegex = /href="\/store\/apps\/developer\?id=[^"]+"[^>]*>([^<]+)<\/a>/i;

  const nameMatch = html.match(nameRegex);
  let appName = nameMatch ? nameMatch[1] : '';
  if (!appName) {
    const titleMatch = html.match(titleRegex);
    if (titleMatch) {
      appName = titleMatch[1].replace(' - Apps on Google Play', '').trim();
    }
  }

  if (!appName) return null;

  const ratingMatch = html.match(ratingValueRegex);
  const rating = ratingMatch ? parseFloat(parseFloat(ratingMatch[1]).toFixed(1)) : 0;

  const countMatch = html.match(ratingCountRegex);
  const ratingCount = countMatch ? parseInt(countMatch[1].replace(/[^\d]/g, '')) : 0;

  const priceMatch = html.match(priceRegex);
  let price = priceMatch ? priceMatch[1] : 'Free';
  if (price === '0') price = 'Free';

  const imageMatch = html.match(imageRegex);
  const icon = imageMatch ? imageMatch[1] : '';

  const devMatch = html.match(developerRegex);
  let developer = devMatch ? devMatch[1] : '';
  if (!developer) {
    const devBackup = html.match(devBackupRegex);
    developer = devBackup ? devBackup[1] : 'Unknown';
  }

  return {
    appName,
    developer,
    appId,
    rating,
    ratingCount,
    price,
    inAppPurchases: html.includes('Offers in-app purchases') || html.includes('In-app purchases'),
    category: 'Utilities',
    lastUpdated: 'Unknown',
    size: 'Varies with device',
    icon,
  };
}

export async function lookupGooglePlay(appId: string, country: string = 'US'): Promise<AppStoreItem | null> {
  const url = `https://play.google.com/store/apps/details?id=${appId}&hl=en&gl=${country.toLowerCase()}`;
  
  try {
    const res = await proxyFetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Google Play detail error: ${res.status}`);

    const html = await res.text();
    return parseGooglePlayAppHtml(html, appId);
  } catch (error) {
    console.error(`[GooglePlay Scraper] Lookup failed for "${appId}":`, error);
    throw error;
  }
}

export async function searchGooglePlay(query: string, country: string = 'US', limit: number = 10): Promise<AppStoreItem[]> {
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=en&gl=${country.toLowerCase()}`;

  try {
    const res = await proxyFetch(url);
    if (!res.ok) throw new Error(`Google Play Search error: ${res.status}`);

    const html = await res.text();
    
    const idRegex = /\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g;
    const foundIds = new Set<string>();
    let match;
    while ((match = idRegex.exec(html)) !== null) {
      const id = match[1];
      if (id && !id.includes('%') && id !== 'about' && id.split('.').length > 1) {
        foundIds.add(id);
      }
    }

    const ids = Array.from(foundIds).slice(0, limit);
    if (ids.length === 0) return [];

    const promises = ids.map((id) =>
      lookupGooglePlay(id, country)
        .catch(() => null)
    );
    const results = await Promise.all(promises);
    
    return results
      .filter((app): app is AppStoreItem => app !== null)
      .map((app, idx) => ({ ...app, rank: idx + 1 }));
  } catch (error) {
    console.error(`[GooglePlay Scraper] Search failed for "${query}":`, error);
    throw error;
  }
}

export async function getGooglePlayRankings(
  country: string = 'US',
  category: string = 'all',
  limit: number = 30
): Promise<AppStoreItem[]> {
  const url = `https://play.google.com/store/apps/top?hl=en&gl=${country.toLowerCase()}`;

  try {
    const res = await proxyFetch(url);
    if (!res.ok) throw new Error(`Google Play Top Charts error: ${res.status}`);

    const html = await res.text();

    const idRegex = /\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g;
    const foundIds = new Set<string>();
    let match;
    while ((match = idRegex.exec(html)) !== null) {
      const id = match[1];
      if (id && !id.includes('%') && id.split('.').length > 1) {
        foundIds.add(id);
      }
    }

    const ids = Array.from(foundIds).slice(0, limit);
    if (ids.length === 0) return [];

    const promises = ids.map((id) =>
      lookupGooglePlay(id, country)
        .catch(() => null)
    );
    const results = await Promise.all(promises);

    let finalResults = results
      .filter((app): app is AppStoreItem => app !== null)
      .map((app, idx) => ({ ...app, rank: idx + 1 }));

    if (category && category !== 'all') {
      const catLower = category.toLowerCase();
      finalResults = finalResults.filter((app) => app.category.toLowerCase().includes(catLower));
    }

    return finalResults;
  } catch (error) {
    console.error(`[GooglePlay Scraper] Rankings failed:`, error);
    throw error;
  }
}
