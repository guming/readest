import { describe, expect, it } from 'vitest';
import { isSubscriptionBook } from '@/app/library/utils/libraryUtils';
import type { Book } from '@/types/book';

describe('subscription shelf classification', () => {
  it('includes feeds and imported websites but not ordinary books', () => {
    const book = (url?: string) => ({ url }) as Book;
    expect(isSubscriptionBook(book('feed://example'))).toBe(true);
    expect(isSubscriptionBook(book('site://example'))).toBe(true);
    expect(isSubscriptionBook(book('https://example.com/book.epub'))).toBe(false);
    expect(isSubscriptionBook(book())).toBe(false);
  });
});
