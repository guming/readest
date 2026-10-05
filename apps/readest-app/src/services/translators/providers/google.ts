import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { normalizeToShortLang } from '@/utils/lang';
import { TranslationProvider } from '../types';

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
};

export const googleProvider: TranslationProvider = {
  name: 'google',
  label: _('Google Translate'),
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
