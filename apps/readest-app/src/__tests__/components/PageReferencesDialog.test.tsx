import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PageReferencesDialog from '@/app/reader/components/PageReferencesDialog';
import type { PageReference } from '@/app/reader/utils/pageReferences';
import type { BookNote } from '@/types/book';

const mocks = vi.hoisted(() => ({
  goTo: vi.fn(),
  resolveNavigation: vi.fn(() => ({ index: 1 })),
  copy: vi.fn(async () => true),
  dispatch: vi.fn(async () => undefined),
  open: vi.fn(),
  config: { booknotes: [] as BookNote[] },
  saveConfig: vi.fn(async () => undefined),
  importBook: vi.fn(async () => ({ hash: 'paper-hash', title: 'Attention Is All You Need' })),
  saveLibraryBooks: vi.fn(async () => undefined),
  setLibrary: vi.fn(),
  downloadFile: vi.fn(async () => undefined),
  deleteFile: vi.fn(async () => undefined),
}));

vi.mock('@/components/Dialog', () => ({
  default: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role='dialog' aria-label={title}>
        {children}
      </div>
    ) : null,
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, number | string>) =>
    Object.entries(options ?? {}).reduce(
      (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
      key,
    ),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ goTo: mocks.goTo, resolveNavigation: mocks.resolveNavigation }),
  }),
}));
vi.mock('@/utils/clipboard', () => ({ writeTextToClipboard: mocks.copy }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: mocks.dispatch } }));
vi.mock('@/utils/open', () => ({ openExternalUrl: mocks.open }));
vi.mock('@/libs/storage', () => ({ downloadFile: mocks.downloadFile }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: {
      importBook: mocks.importBook,
      saveLibraryBooks: mocks.saveLibraryBooks,
      createDir: vi.fn(async () => undefined),
      resolveFilePath: vi.fn(async (path: string) => `/cache/${path}`),
      deleteFile: mocks.deleteFile,
    },
  }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ library: [], setLibrary: mocks.setLibrary }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: { highlightStyle: 'highlight', highlightStyles: { highlight: 'yellow' } },
    },
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => mocks.config,
    updateBooknotes: (_bookKey: string, notes: BookNote[]) => {
      mocks.config.booknotes = notes;
      return mocks.config;
    },
    saveConfig: mocks.saveConfig,
  }),
}));

const references: PageReference[] = [
  {
    id: 'external:paper',
    kind: 'external',
    title: 'Paper',
    href: 'https://example.com/paper',
    absoluteUrl: 'https://example.com/paper',
    sourceCfi: 'epubcfi(/6/2/2)',
    sectionIndex: 1,
    occurrences: 2,
  },
  {
    id: 'footnote:#note',
    kind: 'footnote',
    title: '1',
    href: '#note',
    sourceCfi: 'epubcfi(/6/2)',
    targetCfi: 'epubcfi(/6/4)',
    description: 'Readable footnote text',
    sectionIndex: 1,
    occurrences: 1,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.config.booknotes = [];
});

describe('PageReferencesDialog', () => {
  it('renders grouped references and handles open, copy, copy-all, and in-book navigation', async () => {
    const onClose = vi.fn();
    render(
      <PageReferencesDialog
        bookKey='book-1'
        isOpen={true}
        references={references}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('heading', { name: /External references/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Footnotes/ })).toBeTruthy();
    expect(screen.getByText('Footnote 1')).toBeTruthy();
    expect(screen.getByText('Readable footnote text')).toBeTruthy();
    expect(screen.queryByText('#note')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(mocks.open).toHaveBeenCalledWith('https://example.com/paper');

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('https://example.com/paper'));

    fireEvent.click(screen.getByRole('button', { name: 'Copy all as Markdown' }));
    await waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith('- [Paper](https://example.com/paper)'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go to' }));
    expect(mocks.resolveNavigation).toHaveBeenCalledWith('epubcfi(/6/4)');
    expect(mocks.goTo).toHaveBeenCalledWith('epubcfi(/6/4)');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders an empty state and no copy-all action when no links are visible', () => {
    render(
      <PageReferencesDialog bookKey='book-1' isOpen={true} references={[]} onClose={vi.fn()} />,
    );

    expect(screen.getByText('No reference links found on this page')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy all as Markdown' })).toBeNull();
  });

  it('does not call goTo when Foliate cannot resolve an internal link', async () => {
    mocks.resolveNavigation.mockReturnValueOnce(undefined as unknown as { index: number });
    render(
      <PageReferencesDialog
        bookKey='book-1'
        isOpen={true}
        references={[references[1]!]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go to' }));

    expect(mocks.goTo).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith('toast', {
        type: 'error',
        message: 'Could not open link',
      }),
    );
  });

  it('opens the save form and saves an external item as a reference by default', async () => {
    render(
      <PageReferencesDialog
        bookKey='book-1'
        isOpen={true}
        references={references}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Save to Notebook' })[0]!);
    expect(
      (screen.getByRole('radio', { name: 'Reference link' }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Add a note...'), {
      target: { value: 'Read later' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Notebook' }));

    await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalled());
    expect(mocks.config.booknotes[0]).toMatchObject({ type: 'reference', note: 'Read later' });
  });

  it('imports an arXiv abstract as its PDF into the library', async () => {
    const arxivReference: PageReference = {
      ...references[0]!,
      id: 'external:arxiv',
      href: 'https://arxiv.org/abs/1706.03762',
      absoluteUrl: 'https://arxiv.org/abs/1706.03762',
    };
    render(
      <PageReferencesDialog
        bookKey='book-1'
        isOpen={true}
        references={[arxivReference]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import paper to library' }));

    await waitFor(() =>
      expect(mocks.importBook).toHaveBeenCalledWith(
        expect.stringMatching(/^\/cache\/arxiv-imports\/1706\.03762-\d+\.pdf$/),
        [],
      ),
    );
    expect(mocks.downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://arxiv.org/pdf/1706.03762.pdf',
        singleThreaded: true,
      }),
    );
    expect(mocks.saveLibraryBooks).toHaveBeenCalledWith([]);
    expect(mocks.setLibrary).toHaveBeenCalledWith([]);
    expect(mocks.deleteFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/cache\/arxiv-imports\/1706\.03762-\d+\.pdf$/),
      'None',
    );
  });
});
