export const MAX_CAPTION_BYTES = 4 * 1024 * 1024;
export function videoId(url: string) {
  try { const parsed = new URL(url); return parsed.pathname === '/watch' ? parsed.searchParams.get('v') ?? '' : parsed.pathname.match(/^\/embed\/([\w-]+)/)?.[1] ?? ''; } catch { return ''; }
}
export function captionUrl(value: string, id: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname) || url.pathname !== '/api/timedtext' || url.searchParams.get('v') !== id || url.username || url.password) return null;
    // Respect the user's chosen source track; never label auto-translated text as its original.
    if (url.searchParams.has('tlang')) return null;
    return url;
  } catch { return null; }
}

