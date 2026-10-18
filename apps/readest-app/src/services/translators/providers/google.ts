import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { normalizeToShortLang } from '@/utils/lang';
import { TranslationProvider } from '../types';

// Share the queue across popup and full-page translations.
let requestQueue: Promise<unknown> = Promise.resolve();
let rateLimitedUntil = 0;
const rateLimitError = () =>
  new Error(
    _('Google Translate is rate limited (429). Please try again later or choose another provider.'),
  );
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const fetchTranslation = (url: string): Promise<unknown> => {
  const request = requestQueue.then(async () => {
    // Check when dequeued so already pending lines also respect the cooldown.
    if (Date.now() < rateLimitedUntil) throw rateLimitError();
    const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch.bind(window);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(url);
        if (response.ok) return await response.json();
        if (response.status !== 429) {
          throw new Error(`Translation failed with status ${response.status}`);
        }
        const retryAfter = response.headers.get('Retry-After');
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : retryAfter
            ? Date.parse(retryAfter) - Date.now()
            : 1000 * 2 ** attempt;
        // Do not retry earlier than requested or hold the reader indefinitely.
        if (attempt === 2 || delay > 30000) {
          rateLimitedUntil = Date.now() + Math.max(30000, Number.isFinite(delay) ? delay : 0);
          break;
        }
        await wait(Number.isFinite(delay) ? Math.max(0, delay) : 1000 * 2 ** attempt);
      }
      throw rateLimitError();
    } finally {
      await wait(250);
    }
  });
  requestQueue = request.catch(() => {});
  return request;
};

export const googleProvider: TranslationProvider = {
  name: 'google',
  label: _('Google Translate'),
  // Verified against the live endpoint with the exact request built below:
  // inline tags come back on the semantically matching words even when the
  // sentence reorders, including nested tags, class and href attributes, and
  // non-Latin targets. Note this needs no extra parameter — adding
  // `format=html` makes the endpoint strip the tags instead of keeping them.
  preservesMarkup: true,
  translate: async (text: string[], sourceLang: string, targetLang: string): Promise<string[]> => {
    if (!text.length) return [];

    const results: string[] = [];

    const translationPromises = text.map(async (line, index) => {
      if (!line?.trim().length) {
        results[index] = line;
        return;
      }

      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.searchParams.append('client', 'gtx');
      url.searchParams.append('dt', 't');
      url.searchParams.append('sl', normalizeToShortLang(sourceLang).toLowerCase() || 'auto');
      url.searchParams.append('tl', normalizeToShortLang(targetLang).toLowerCase());
      url.searchParams.append('q', line);

      const data = await fetchTranslation(url.toString());
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
