import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { downloadFile } from '@/libs/storage';

const ARXIV_HOSTS = new Set(['arxiv.org', 'www.arxiv.org', 'export.arxiv.org']);
const MODERN_ID = /^\d{4}\.\d{4,5}(?:v\d+)?$/i;
const LEGACY_ID = /^[a-z][a-z0-9.-]*\/[0-9]{7}(?:v\d+)?$/i;

export const getArxivPdfUrl = (value?: string): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!ARXIV_HOSTS.has(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/i);
    if (!match) return null;
    const id = decodeURIComponent(match[1] ?? '');
    if (!MODERN_ID.test(id) && !LEGACY_ID.test(id)) return null;
    return `https://arxiv.org/pdf/${id}.pdf`;
  } catch {
    return null;
  }
};

export const importArxivPaper = async (
  appService: AppService,
  library: Book[],
  value: string,
): Promise<Book> => {
  const pdfUrl = getArxivPdfUrl(value);
  if (!pdfUrl) throw new Error('Not an arXiv paper URL');
  const id = pdfUrl.slice(pdfUrl.lastIndexOf('/') + 1).replace(/\.pdf$/i, '');
  const tempDir = 'arxiv-imports';
  await appService.createDir(tempDir, 'Cache', true);
  const relativePath = `${tempDir}/${id}-${Date.now()}.pdf`;
  const tempPath = await appService.resolveFilePath(relativePath, 'Cache');
  try {
    await downloadFile({
      appService,
      dst: tempPath,
      cfp: tempPath,
      url: pdfUrl,
      singleThreaded: true,
    });
    const book = await appService.importBook(tempPath, library);
    if (!book) throw new Error('Could not import the arXiv PDF');
    await appService.saveLibraryBooks(library);
    return book;
  } finally {
    try {
      await appService.deleteFile(tempPath, 'None');
    } catch {
      // Best-effort cleanup; the imported book has already been copied to Books.
    }
  }
};
