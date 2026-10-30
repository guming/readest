export const SITE_SCHEME = 'site://';
export const isSiteBookUrl = (url: string): boolean => url.startsWith(SITE_SCHEME);
export const buildSiteBookUrl = (url: string): string => SITE_SCHEME + encodeURIComponent(url);
export const parseSiteBookUrl = (url: string): string =>
  decodeURIComponent(url.slice(SITE_SCHEME.length));
