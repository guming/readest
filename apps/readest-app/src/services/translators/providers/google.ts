import { stubTranslation as _ } from '@/utils/misc';
import { normalizeToShortLang } from '@/utils/lang';
import { TranslationProvider } from '../types';

<<<<<<< HEAD
/**
 * The unofficial endpoint behind the Google Translate widget. It needs no key,
 * but Google decides per caller whether the traffic looks automated and answers
 * HTTP 429 with "your computer or network may be sending automated queries"
 * when it does. Two things keep us on the right side of that:
 *
 * - the request goes out through the webview's own network stack, never the
 *   Tauri HTTP plugin. Google refuses the Rust client: measured on an Android
 *   device, `window.fetch` answered 200 five times in a row while `tauriFetch`
 *   answered 429 for the same URL in the same run, and the block on the Rust
 *   client outlasted a restart. The endpoint sends permissive CORS headers so
 *   the response is readable cross-origin, and `translate.googleapis.com` is
 *   already in the app's `connect-src` CSP, so this works on every platform;
 * - the fan-out is capped. Google translates one text per request, so a page of
 *   paragraphs used to go out all at once, which is what earns the 429 in the
 *   first place.
 */
const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
// Deliberately conservative: the endpoint is unofficial, its threshold is
// undocumented, and being flagged costs minutes rather than one failed request.
const MAX_CONCURRENT_REQUESTS = 4;

let activeRequests = 0;
const requestQueue: Array<() => void> = [];

/**
 * Caps outbound requests across every concurrent `translate()` call — the
 * counter is module-level because Google judges the caller, not the call.
 */
async function withRequestLimit<T>(task: () => Promise<T>): Promise<T> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
  } else {
    await new Promise<void>((resolve) => requestQueue.push(resolve));
  }
  try {
    return await task();
  } finally {
    const next = requestQueue.shift();
    // Hand the occupied slot straight over; leaving activeRequests untouched
    // makes the transfer atomic with respect to fresh callers.
    if (next) next();
    else activeRequests--;
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchTranslation(url: string): Promise<unknown> {
  return withRequestLimit(async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        // Use the WebView network stack: Google returns 429 to the Tauri HTTP
        // client for this endpoint, even when the same device's WebView gets 200.
        const response = await window.fetch(url);
        if (response.ok) return await response.json();
        if (response.status !== 429) {
          throw new Error(`Translation failed with status ${response.status}`);
        }
        if (attempt === 2) break;
        const retryAfter = response.headers.get('Retry-After');
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : retryAfter
            ? Date.parse(retryAfter) - Date.now()
            : 1000 * 2 ** attempt;
        // Do not retry earlier than requested or hold the reader indefinitely.
        if (delay > 30000) break;
        await wait(Number.isFinite(delay) ? Math.max(0, delay) : 1000 * 2 ** attempt);
      }
      throw new Error(
        _('Google Translate is rate limited (429). Please try again later or choose another provider.'),
      );
    } finally {
      await wait(250);
    }
  });
}

const buildUrl = (line: string, sourceLang: string, targetLang: string) => {
  const url = new URL(TRANSLATE_URL);
  url.searchParams.append('client', 'gtx');
  // No `format=html` — adding it makes the endpoint strip inline tags instead
  // of keeping them on the semantically matching words.
  url.searchParams.append('dt', 't');
  url.searchParams.append('sl', normalizeToShortLang(sourceLang).toLowerCase() || 'auto');
  url.searchParams.append('tl', normalizeToShortLang(targetLang).toLowerCase());
  url.searchParams.append('q', line);
  return url.toString();
=======
// Share the queue across popup and full-page translations.
let requestQueue: Promise<unknown> = Promise.resolve();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const fetchTranslation = (url: string): Promise<unknown> => {
  const request = requestQueue.then(async () => {
    const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch.bind(window);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(url);
        if (response.ok) return await response.json();
        if (response.status !== 429) {
          throw new Error(`Translation failed with status ${response.status}`);
        }
        if (attempt === 2) break;
        const retryAfter = response.headers.get('Retry-After');
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : retryAfter
            ? Date.parse(retryAfter) - Date.now()
            : 1000 * 2 ** attempt;
        // Do not retry earlier than requested or hold the reader indefinitely.
        if (delay > 30000) break;
        await wait(Number.isFinite(delay) ? Math.max(0, delay) : 1000 * 2 ** attempt);
      }
      throw new Error(
        _(
          'Google Translate is rate limited (429). Please try again later or choose another provider.',
        ),
      );
    } finally {
      await wait(250);
    }
  });
  requestQueue = request.catch(() => {});
  return request;
>>>>>>> 47e21c0b2 (fix: handle Google translation rate limits and improve selection popup)
};

export const googleProvider: TranslationProvider = {
  name: 'google',
  label: _('Google Translate'),
  // Verified against the live endpoint with the exact request built above:
  // inline tags come back on the semantically matching words even when the
  // sentence reorders, including nested tags, class and href attributes, and
  // non-Latin targets.
  preservesMarkup: true,
  translate: async (text: string[], sourceLang: string, targetLang: string): Promise<string[]> => {
    if (!text.length) return [];

    const results: string[] = [];

    const translationPromises = text.map(async (line, index) => {
      if (!line?.trim().length) {
        results[index] = line;
        return;
      }

      const data = await fetchTranslation(buildUrl(line, sourceLang, targetLang));
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translatedText = data[0]
          .filter((segment) => Array.isArray(segment) && segment[0])
          .map((segment) => segment[0])
          .join('');

        results[index] = translatedText || line;
      } else {
        results[index] = line;
      }
    });

    await Promise.all(translationPromises);

    return results;
  },
};
