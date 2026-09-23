import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RiQuillPenLine } from 'react-icons/ri';
import { PiCaretDown, PiCaretRight, PiCopy, PiLightbulb, PiTextAa, PiTrash } from 'react-icons/pi';

import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { NotebookTab, useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { useEnv } from '@/context/EnvContext';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';
import { usePanelResize } from '@/hooks/usePanelResize';
import { TextSelection } from '@/utils/sel';
import { BookNote, NotebookCard } from '@/types/book';
import type { QuizCardContent } from '@/services/notebook-assistant/types';
import { writeTextToClipboard } from '@/utils/clipboard';
import { uniqueId } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { getBookDirFromLanguage } from '@/utils/book';
import { getPanelTopInset } from '@/utils/insets';
import { Overlay } from '@/components/Overlay';
import { saveSysSettings } from '@/helpers/settings';
import { NOTE_PREFIX } from '@/types/view';
import useShortcuts from '@/hooks/useShortcuts';
import {
  findAnnotationAtCfi,
  removeBookNoteOverlays,
  removeEmptyAnnotationPlaceholder,
} from '../../utils/annotatorUtil';
import BooknoteItem from '../sidebar/BooknoteItem';
import NotebookAssistantActions from './NotebookAssistantActions';
import UnderstandingMapActions from './UnderstandingMapActions';
import UnderstandingMapView from './UnderstandingMapView';
import NotebookReview from './NotebookReview';
import NotebookHeader from './Header';
import NoteEditor from './NoteEditor';
import SearchBar from './SearchBar';
import NotebookTabNavigation from './NotebookTabNavigation';
import EmptyState from '../EmptyState';
import BookLearningGuidePanel from '@/components/learning-guide/BookLearningGuidePanel';
import { AskMeOneIcon, LearningGuideIcon, NotebookAssistantIcon } from './AssistantFeatureIcons';

const MIN_NOTEBOOK_WIDTH = 0.15;
const MAX_NOTEBOOK_WIDTH = 0.45;
type ReadingAssistantSection = 'guide' | 'assistant' | 'question';

const Notebook: React.FC = ({}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateAppTheme, safeAreaInsets, systemUIVisible, statusBarHeight } = useThemeStore();
  const { sideBarBookKey } = useSidebarStore();
  const { notebookWidth, isNotebookVisible, isNotebookPinned, notebookActiveTab } =
    useNotebookStore();
  const { notebookNewAnnotation, notebookEditAnnotation, setNotebookPin } = useNotebookStore();
  const { getBookData, getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getView, getViewsById, getProgress, getViewSettings } = useReaderStore();
  const { getNotebookWidth, setNotebookWidth, setNotebookVisible, toggleNotebookPin } =
    useNotebookStore();
  const { setNotebookNewAnnotation, setNotebookNewHighlightId } = useNotebookStore();
  const { setNotebookEditAnnotation, setNotebookActiveTab } = useNotebookStore();

  const [isSearchBarVisible, setIsSearchBarVisible] = useState(false);
  const [searchResults, setSearchResults] = useState<BookNote[] | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(() => new Set());
  const [readingAssistantSection, setReadingAssistantSection] =
    useState<ReadingAssistantSection>('guide');
  const isMobile = window.innerWidth < 640;
  const [isFullHeightInMobile, setIsFullHeightInMobile] = useState(isMobile);

  const {
    panelRef: notebookRef,
    overlayRef,
    panelHeight: notebookHeight,
    handleVerticalDragStart,
  } = useSwipeToDismiss(
    () => {
      setNotebookVisible(false);
      setIsFullHeightInMobile(isMobile);
    },
    (data) => setIsFullHeightInMobile(data.clientY < 44),
  );

  const onNavigateEvent = async () => {
    const { isNotebookPinned } = useNotebookStore.getState();
    if (!isNotebookPinned) {
      setNotebookVisible(false);
    }
  };

  const handleHideNotebook = useCallback(() => {
    if (!isNotebookPinned) {
      setNotebookVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNotebookPinned]);

  useShortcuts({ onEscape: handleHideNotebook }, [handleHideNotebook]);

  useEffect(() => {
    if (isNotebookVisible) {
      updateAppTheme('base-200');
      overlayRef.current = document.querySelector('.overlay') as HTMLDivElement | null;
    } else {
      updateAppTheme('base-100');
      overlayRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNotebookVisible]);

  useEffect(() => {
    setNotebookWidth(settings.globalReadSettings.notebookWidth);
    setNotebookPin(settings.globalReadSettings.isNotebookPinned);
    setNotebookVisible(settings.globalReadSettings.isNotebookPinned);
    if (settings.globalReadSettings.notebookActiveTab) {
      setNotebookActiveTab(settings.globalReadSettings.notebookActiveTab);
    }

    eventDispatcher.on('navigate', onNavigateEvent);
    return () => {
      eventDispatcher.off('navigate', onNavigateEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isNotebookVisible || notebookNewAnnotation || notebookEditAnnotation) {
      setIsSearchBarVisible(false);
      setSearchResults(null);
      setSearchTerm('');
    }
  }, [isNotebookVisible, notebookNewAnnotation, notebookEditAnnotation]);

  const handleNotebookResize = (newWidth: string) => {
    setNotebookWidth(newWidth);
    settings.globalReadSettings.notebookWidth = newWidth;
  };

  const handleTogglePin = () => {
    toggleNotebookPin();
    const globalReadSettings = settings.globalReadSettings;
    const newGlobalReadSettings = { ...globalReadSettings, isNotebookPinned: !isNotebookPinned };
    saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
  };

  const handleTabChange = (tab: NotebookTab) => {
    setNotebookActiveTab(tab);
    const globalReadSettings = settings.globalReadSettings;
    const newGlobalReadSettings = { ...globalReadSettings, notebookActiveTab: tab };
    saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
  };

  // Abandon a note-creation flow: tear down the empty highlight the "Annotate"
  // action eagerly created as the note anchor so it doesn't leak into the
  // booknotes list (#4791). A saved note carries text, so it survives the guard
  // in removeEmptyAnnotationPlaceholder; a restyled pre-existing highlight has no
  // tracked id and is left alone. `bookKey` is passed explicitly so the unmount/
  // book-switch cleanup targets the book the placeholder belongs to.
  const handleCancelNewAnnotation = useCallback(
    (bookKey: string | null) => {
      const { notebookNewHighlightId } = useNotebookStore.getState();
      if (bookKey && notebookNewHighlightId) {
        const config = getConfig(bookKey);
        const { booknotes: annotations = [] } = config || {};
        const placeholder = removeEmptyAnnotationPlaceholder(
          annotations,
          notebookNewHighlightId,
          Date.now(),
        );
        if (placeholder) {
          const views = getViewsById(bookKey.split('-')[0]!);
          views.forEach((view) => removeBookNoteOverlays(view, placeholder));
          const updatedConfig = updateBooknotes(bookKey, annotations);
          if (updatedConfig) {
            // Read settings fresh: this callback has stable identity (empty deps)
            // so a captured `settings` would go stale across saves.
            saveConfig(envConfig, bookKey, updatedConfig, useSettingsStore.getState().settings);
          }
        }
      }
      setNotebookNewHighlightId(null);
      setNotebookNewAnnotation(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The "Annotate" action keeps a placeholder highlight alive only while its
  // editor is on screen. The moment that creation flow stops being presented —
  // Cancel/Escape (selection cleared), the notebook closing, swipe-dismiss, or a
  // navigate — clean the placeholder up (#4791). Save clears the tracked id (and
  // the placeholder gains note text), so this no-ops for saved annotations.
  useEffect(() => {
    if (!(isNotebookVisible && notebookNewAnnotation)) {
      handleCancelNewAnnotation(sideBarBookKey);
    }
  }, [isNotebookVisible, notebookNewAnnotation, sideBarBookKey, handleCancelNewAnnotation]);

  // Switching books (notebook pinned, so it stays presented) or closing the
  // reader leaves the placeholder behind; clean it up against the book we are
  // leaving on the way out (#4791).
  useEffect(() => {
    return () => handleCancelNewAnnotation(sideBarBookKey);
  }, [sideBarBookKey, handleCancelNewAnnotation]);

  const handleClickOverlay = () => {
    setNotebookVisible(false);
    setNotebookNewAnnotation(null);
    setNotebookEditAnnotation(null);
  };

  const handleSaveNote = (selection: TextSelection, note: string) => {
    if (!sideBarBookKey) return;
    const view = getView(sideBarBookKey);
    const config = getConfig(sideBarBookKey)!;

    const cfi = view?.getCFI(selection.index, selection.range);
    if (!cfi) return;

    const { booknotes: annotations = [] } = config;
    const existingIndex = findAnnotationAtCfi(annotations, cfi);
    if (existingIndex !== -1) {
      // Attach the note to the existing highlight at this CFI instead of
      // creating a second record. The highlight overlay (value = cfi) already
      // exists; add the note bubble overlay (value = NOTE_PREFIX+cfi).
      const existing = annotations[existingIndex]!;
      const updated: BookNote = {
        ...existing,
        note,
        text: selection.text || existing.text,
        updatedAt: Date.now(),
      };
      annotations[existingIndex] = updated;
      view?.addAnnotation({ ...updated, value: `${NOTE_PREFIX}${updated.cfi}` });
    } else {
      // No highlight at this CFI yet (e.g. a note added without first
      // highlighting): create one unified record with the current global style
      // so the note still shows an underlying highlight, and draw both overlays.
      const style = settings.globalReadSettings.highlightStyle;
      const color = settings.globalReadSettings.highlightStyles[style];
      const annotation: BookNote = {
        id: uniqueId(),
        type: 'annotation',
        cfi,
        style,
        color,
        note,
        page: selection.page,
        text: selection.text,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      view?.addAnnotation(annotation);
      view?.addAnnotation({ ...annotation, value: `${NOTE_PREFIX}${annotation.cfi}` });
      annotations.push(annotation);
    }
    const updatedConfig = updateBooknotes(sideBarBookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, sideBarBookKey, updatedConfig, settings);
    }
    setNotebookNewAnnotation(null);
    // The placeholder now carries a note (or a fresh unified record was created),
    // so it's a real annotation — drop the cancel-cleanup handle (#4791).
    setNotebookNewHighlightId(null);
  };

  const handleEditNote = (note: BookNote, isDelete: boolean) => {
    if (!sideBarBookKey) return;
    const view = getView(sideBarBookKey);
    const config = getConfig(sideBarBookKey)!;
    const progress = getProgress(sideBarBookKey)!;
    const { booknotes: annotations = [] } = config;
    const existingIndex = annotations.findIndex((item) => item.id === note.id);
    if (existingIndex === -1) return;
    if (isDelete) {
      note.deletedAt = Date.now();
    } else {
      note.updatedAt = Date.now();
    }
    note.page = progress.page;
    annotations[existingIndex] = note;
    view?.addAnnotation({ ...note, value: `${NOTE_PREFIX}${note.cfi}` }, true);
    const updatedConfig = updateBooknotes(sideBarBookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, sideBarBookKey, updatedConfig, settings);
    }
    setNotebookEditAnnotation(null);
  };

  const { handleResizeStart: handleDragStart, handleResizeKeyDown: handleDragKeyDown } =
    usePanelResize({
      side: 'end',
      minWidth: MIN_NOTEBOOK_WIDTH,
      maxWidth: MAX_NOTEBOOK_WIDTH,
      getWidth: getNotebookWidth,
      onResize: handleNotebookResize,
    });

  const config = getConfig(sideBarBookKey);
  const { booknotes: allNotes = [] } = config || {};
  const notebookCards = (config?.notebookCards ?? [])
    .filter((card) => !card.deletedAt)
    .sort((a, b) => b.createdAt - a.createdAt);
  const readingAssistantCards = notebookCards.filter(
    (card) => !['learning_guide', 'quiz', 'mistake'].includes(card.type),
  );
  const quizCards = notebookCards.filter((card) => ['quiz', 'mistake'].includes(card.type));
  const annotationNotes = allNotes
    .filter((note) => note.type === 'annotation' && note.note && !note.deletedAt)
    .sort((a, b) => b.createdAt - a.createdAt);
  const excerptNotes = allNotes
    .filter((note) => note.type === 'excerpt' && note.text && !note.deletedAt)
    .sort((a, b) => a.createdAt - b.createdAt);
  const referenceNotes = allNotes
    .filter((note) => note.type === 'reference' && note.text && !note.deletedAt)
    .sort((a, b) => b.createdAt - a.createdAt);

  const handleToggleSearchBar = () => {
    setIsSearchBarVisible((prev) => !prev);
    if (isSearchBarVisible) {
      setSearchResults(null);
      setSearchTerm('');
    }
  };

  const filteredAnnotationNotes = useMemo(
    () =>
      isSearchBarVisible && searchResults
        ? searchResults.filter((note) => note.type === 'annotation' && note.note && !note.deletedAt)
        : annotationNotes,
    [annotationNotes, searchResults, isSearchBarVisible],
  );

  const filteredExcerptNotes = useMemo(
    () =>
      isSearchBarVisible && searchResults
        ? searchResults.filter((note) => note.type === 'excerpt' && note.text && !note.deletedAt)
        : excerptNotes,
    [excerptNotes, searchResults, isSearchBarVisible],
  );

  const filteredReferenceNotes = useMemo(
    () =>
      isSearchBarVisible && searchResults
        ? searchResults.filter((note) => note.type === 'reference' && !note.deletedAt)
        : referenceNotes,
    [referenceNotes, searchResults, isSearchBarVisible],
  );

  const handleNavigateCard = (card: NotebookCard) => {
    const cfi = card.selectionCfi || card.pageCfi;
    if (!cfi || !sideBarBookKey) return;
    eventDispatcher.dispatch('navigate', { bookKey: sideBarBookKey, cfi });
    getView(sideBarBookKey)?.goTo(cfi);
  };

  const handleDeleteCard = async (card: NotebookCard) => {
    if (!sideBarBookKey) return;
    const latest = getConfig(sideBarBookKey);
    if (!latest) return;
    const now = Date.now();
    const cards = (latest.notebookCards ?? []).map((item) =>
      item.id === card.id ? { ...item, updatedAt: now, deletedAt: now } : item,
    );
    const next = { ...latest, notebookCards: cards, updatedAt: now };
    useBookDataStore.getState().setConfig(sideBarBookKey, next);
    await saveConfig(envConfig, sideBarBookKey, next, settings);
  };

  const toggleCardExpanded = (cardId: string) => {
    setExpandedCardIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };

  const renderNotebookCard = (card: NotebookCard) => {
    const isExpanded = expandedCardIds.has(card.id);
    const Icon =
      card.type === 'summary'
        ? NotebookAssistantIcon
        : card.type === 'translation'
          ? PiTextAa
          : PiLightbulb;
    const sourceText = card.sourceText || card.contextType;
    const contentText =
      typeof card.content === 'string'
        ? card.content
        : 'schemaVersion' in card.content && 'nodes' in card.content
          ? card.content.nodes.map((node) => node.label).join('\n')
          : 'questions' in card.content
            ? card.content.questions
                .map((question, index) => `${index + 1}. ${question.question}`)
                .join('\n')
            : card.content.learningGoal;
    return (
      <li key={card.id} className='my-2'>
        <article className='border-base-300 bg-base-100 rounded-md border p-3 text-sm'>
          <div className={clsx('flex items-center justify-between gap-2', isExpanded && 'mb-2')}>
            <button
              type='button'
              className='flex min-w-0 items-center gap-2 font-medium disabled:cursor-default'
              disabled={!card.selectionCfi && !card.pageCfi}
              onClick={() => handleNavigateCard(card)}
            >
              <Icon className='shrink-0' />
              <span className='truncate'>{card.title}</span>
            </button>
            <div className='flex shrink-0'>
              <button
                type='button'
                className='btn btn-ghost btn-xs btn-square'
                onClick={() => toggleCardExpanded(card.id)}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? _('Collapse') : _('Expand')}
                title={isExpanded ? _('Collapse') : _('Expand')}
              >
                {isExpanded ? <PiCaretDown /> : <PiCaretRight />}
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-xs btn-square'
                onClick={() => void writeTextToClipboard(contentText)}
                aria-label={_('Copy')}
                title={_('Copy')}
              >
                <PiCopy />
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-xs btn-square text-red-500'
                onClick={() => void handleDeleteCard(card)}
                aria-label={_('Delete')}
                title={_('Delete')}
              >
                <PiTrash />
              </button>
            </div>
          </div>
          {(card.pageNumber != null || card.chapterTitle) && (
            <p className={clsx('text-base-content/55 text-xs', isExpanded && 'mb-2')}>
              {card.pageNumber != null && _('Page {{number}}', { number: card.pageNumber })}
              {card.pageNumber != null && card.chapterTitle ? ' · ' : ''}
              {card.chapterTitle || ''}
            </p>
          )}
          {isExpanded && (
            <>
              {sourceText && (
                <p
                  className={clsx(
                    'text-base-content/60 mb-2 text-xs',
                    card.type === 'translation' ? 'whitespace-pre-wrap' : 'line-clamp-2',
                  )}
                >
                  {sourceText}
                </p>
              )}
              {typeof card.content === 'string' ? (
                <p className='whitespace-pre-wrap leading-relaxed'>{card.content}</p>
              ) : 'nodes' in card.content ? (
                <UnderstandingMapView map={card.content} bookKey={sideBarBookKey!} />
              ) : 'questions' in card.content ? (
                <div className='space-y-2'>
                  <p className='text-base-content/70 text-sm'>
                    {card.type === 'mistake' ? (
                      <>
                        {_('Missed Questions')}: {card.content.questions.length}
                      </>
                    ) : (
                      <>
                        {_('Score')}: {card.content.score ?? 0}/{card.content.questions.length}
                      </>
                    )}
                  </p>
                  <ol className='space-y-2'>
                    {(card.content as QuizCardContent).questions.map((question, index) => (
                      <li key={question.id} className='text-sm'>
                        <p className='font-medium'>
                          {index + 1}. {question.question}
                        </p>
                        <p className='text-base-content/70'>
                          {_('Answer')}: {question.answer}
                        </p>
                        <p className='text-base-content/60'>{question.explanation}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className='whitespace-pre-wrap leading-relaxed'>{card.content.learningGoal}</p>
              )}
              <p className='text-base-content/50 mt-2 text-xs'>
                {card.provider} · {card.model} · ~
                {card.tokenEstimate.input + card.tokenEstimate.output} tokens
              </p>
            </>
          )}
        </article>
      </li>
    );
  };

  if (!sideBarBookKey) return null;

  const bookData = getBookData(sideBarBookKey);
  const viewSettings = getViewSettings(sideBarBookKey);
  if (!bookData || !bookData.bookDoc) {
    return null;
  }
  const { bookDoc } = bookData;
  const languageDir = getBookDirFromLanguage(bookDoc.metadata.language);

  const hasSearchResults =
    filteredAnnotationNotes.length > 0 ||
    filteredExcerptNotes.length > 0 ||
    filteredReferenceNotes.length > 0;
  const hasAnyNotes =
    annotationNotes.length > 0 || excerptNotes.length > 0 || referenceNotes.length > 0;
  const isNotesTabEmpty =
    !notebookNewAnnotation && !notebookEditAnnotation && !isSearchBarVisible && !hasAnyNotes;
  const isReadingAssistantTab = notebookActiveTab === 'ai' || notebookActiveTab === 'review';

  return isNotebookVisible ? (
    <>
      {!isNotebookPinned && (
        <Overlay
          className={clsx('z-[45]', viewSettings?.isEink ? '' : 'bg-black/50 sm:bg-black/20')}
          onDismiss={handleClickOverlay}
        />
      )}
      <div
        ref={notebookRef}
        className={clsx(
          'notebook-container right-0 flex min-w-60 select-none flex-col',
          'full-height font-sans text-base font-normal transition-[padding-top] duration-300 sm:text-sm',
          viewSettings?.isEink ? 'bg-base-100' : 'bg-base-200',
          appService?.hasRoundedWindow && 'rounded-window-top-right rounded-window-bottom-right',
          isNotebookPinned ? 'z-20' : 'z-[45] shadow-2xl',
          !isNotebookPinned && viewSettings?.isEink && 'border-base-content border-s',
        )}
        role='group'
        aria-label={_('Notebook')}
        dir={viewSettings?.rtl && languageDir === 'rtl' ? 'rtl' : 'ltr'}
        style={{
          width: isMobile ? '100%' : `${notebookWidth}`,
          maxWidth: isMobile ? '100%' : `${MAX_NOTEBOOK_WIDTH * 100}%`,
          position: isMobile ? 'fixed' : isNotebookPinned ? 'relative' : 'absolute',
          paddingTop: `${getPanelTopInset({
            isMobile,
            isFullHeightInMobile,
            systemUIVisible,
            statusBarHeight,
            safeAreaInsets,
          })}px`,
        }}
      >
        <style jsx>{`
          @media (max-width: 640px) {
            .notebook-container {
              border-top-left-radius: 16px;
              border-top-right-radius: 16px;
            }
            .overlay {
              transition: opacity 0.3s ease-in-out;
            }
          }
        `}</style>
        <div
          className={clsx(
            'drag-bar absolute -left-2 top-0 h-full w-0.5 cursor-col-resize bg-transparent p-2',
            isMobile && 'hidden',
          )}
          role='slider'
          tabIndex={0}
          aria-label={_('Resize Notebook')}
          aria-orientation='horizontal'
          aria-valuenow={parseFloat(notebookWidth)}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
          onKeyDown={handleDragKeyDown}
        />
        <div className='flex-shrink-0'>
          {isMobile && (
            <div
              role='slider'
              tabIndex={0}
              aria-label={_('Resize Notebook')}
              aria-orientation='vertical'
              aria-valuenow={notebookHeight.current}
              className='drag-handle flex h-6 max-h-6 min-h-6 w-full cursor-row-resize items-center justify-center'
              onMouseDown={handleVerticalDragStart}
              onTouchStart={handleVerticalDragStart}
            >
              <div className='bg-base-content/50 h-1 w-10 rounded-full'></div>
            </div>
          )}
          <NotebookHeader
            isPinned={isNotebookPinned}
            isSearchBarVisible={isSearchBarVisible && notebookActiveTab === 'notes'}
            handleClose={() => setNotebookVisible(false)}
            handleTogglePin={handleTogglePin}
            handleToggleSearchBar={handleToggleSearchBar}
            showSearchButton={notebookActiveTab === 'notes'}
          />
          {notebookActiveTab === 'notes' && (
            <div
              className={clsx('search-bar', {
                'search-bar-visible': isSearchBarVisible,
              })}
            >
              <SearchBar
                isVisible={isSearchBarVisible}
                bookKey={sideBarBookKey}
                searchTerm={searchTerm}
                onSearchResultChange={setSearchResults}
              />
            </div>
          )}
        </div>
        {isReadingAssistantTab ? (
          <div className='flex min-h-0 flex-1 flex-col'>
            <div
              className='border-base-300/60 flex gap-1 overflow-x-auto border-b px-3 py-2'
              role='tablist'
              aria-label={_('Reading Assistant')}
            >
              {(
                [
                  { id: 'guide', label: _('Learning Guide'), Icon: LearningGuideIcon },
                  { id: 'assistant', label: _('Notebook Assistant'), Icon: NotebookAssistantIcon },
                  { id: 'question', label: _('Ask Me One'), Icon: AskMeOneIcon },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type='button'
                  role='tab'
                  aria-selected={readingAssistantSection === id}
                  onClick={() => setReadingAssistantSection(id)}
                  className={clsx(
                    'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium whitespace-nowrap transition-colors',
                    readingAssistantSection === id
                      ? 'bg-base-300 text-base-content'
                      : 'text-base-content/60 hover:bg-base-300/45 hover:text-base-content',
                  )}
                >
                  <Icon className='shrink-0' aria-hidden='true' />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className='min-h-0 flex-1 overflow-y-auto' role='tabpanel'>
              {readingAssistantSection === 'guide' && (
                <section className='p-3'>
                  <BookLearningGuidePanel
                    compact
                    bookKey={sideBarBookKey}
                    book={bookData.book}
                    bookDoc={bookData.bookDoc}
                  />
                </section>
              )}
              {readingAssistantSection === 'assistant' && (
                <>
                  <NotebookAssistantActions bookKey={sideBarBookKey} />
                  <UnderstandingMapActions bookKey={sideBarBookKey} />
                  {readingAssistantCards.length > 0 && (
                    <section className='px-3 py-2'>
                      <p className='content font-size-base'>{_('Assistant Cards')}</p>
                      <ul>{readingAssistantCards.map(renderNotebookCard)}</ul>
                    </section>
                  )}
                </>
              )}
              {readingAssistantSection === 'question' && (
                <>
                  <NotebookReview bookKey={sideBarBookKey} />
                  {quizCards.length > 0 && (
                    <section className='px-3 py-2'>
                      <p className='content font-size-base'>{_('Saved Quizzes')}</p>
                      <ul>{quizCards.map(renderNotebookCard)}</ul>
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        ) : isNotesTabEmpty ? (
          <div className='flex flex-grow items-center justify-center overflow-y-auto px-3'>
            <EmptyState
              Icon={RiQuillPenLine}
              label={_('No Notes')}
              hint={_('Capture an idea as you read')}
            />
          </div>
        ) : (
          <div className='flex-grow overflow-y-auto px-3'>
            {isSearchBarVisible && searchResults && !hasSearchResults && hasAnyNotes && (
              <div className='flex h-32 items-center justify-center text-gray-500'>
                <p className='font-size-sm text-center'>{_('No notes match your search')}</p>
              </div>
            )}
            <div dir='ltr'>
              {filteredExcerptNotes.length > 0 && (
                <p className='content font-size-base'>
                  {_('Excerpts')}
                  {isSearchBarVisible && searchResults && (
                    <span className='font-size-xs ml-2 text-gray-500'>
                      ({filteredExcerptNotes.length})
                    </span>
                  )}
                </p>
              )}
            </div>
            <ul className=''>
              {filteredExcerptNotes.map((item, index) => (
                <li key={`${index}-${item.id}`} className='my-2'>
                  <div
                    role='button'
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' || e.key === 'Delete') {
                        handleEditNote(item, true);
                      }
                    }}
                    className='booknote-item collapse-arrow border-base-300 bg-base-100 collapse border'
                  >
                    <div
                      className={clsx(
                        'collapse-title pe-8 text-sm font-medium',
                        'h-[2.5rem] min-h-[2.5rem] p-[0.6rem]',
                      )}
                      style={
                        {
                          '--top-override': '1.25rem',
                          '--end-override': '0.7rem',
                        } as React.CSSProperties
                      }
                    >
                      <p className='line-clamp-1'>{item.text || `Excerpt ${index + 1}`}</p>
                    </div>
                    <div className='collapse-content font-size-xs select-text px-3 pb-0'>
                      <p className='hyphens-auto text-justify'>{item.text}</p>
                      <div className='flex justify-end' dir='ltr'>
                        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions*/}
                        <div
                          className='font-size-xs cursor-pointer align-bottom text-red-500 hover:text-red-600'
                          onClick={handleEditNote.bind(null, item, true)}
                          aria-label={_('Delete')}
                        >
                          {_('Delete')}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div dir='ltr'>
              {filteredReferenceNotes.length > 0 && (
                <p className='content font-size-base'>
                  {_('Reference links')}
                  {isSearchBarVisible && searchResults && (
                    <span className='font-size-xs ml-2 text-gray-500'>
                      ({filteredReferenceNotes.length})
                    </span>
                  )}
                </p>
              )}
            </div>
            <ul>
              {filteredReferenceNotes.map((item, index) => (
                <BooknoteItem key={`${index}-${item.id}`} bookKey={sideBarBookKey} item={item} />
              ))}
            </ul>
            <div dir='ltr'>
              {(notebookNewAnnotation || filteredAnnotationNotes.length > 0) && (
                <p className='content font-size-base'>
                  {_('Notes')}
                  {isSearchBarVisible && searchResults && filteredAnnotationNotes.length > 0 && (
                    <span className='font-size-xs ml-2 text-gray-500'>
                      ({filteredAnnotationNotes.length})
                    </span>
                  )}
                </p>
              )}
            </div>
            {(notebookNewAnnotation || notebookEditAnnotation) && !isSearchBarVisible && (
              <NoteEditor onSave={handleSaveNote} onEdit={(item) => handleEditNote(item, false)} />
            )}
            <ul>
              {filteredAnnotationNotes.map((item, index) => (
                <BooknoteItem key={`${index}-${item.cfi}`} bookKey={sideBarBookKey} item={item} />
              ))}
            </ul>
          </div>
        )}
        <div
          className='flex-shrink-0'
          style={{ paddingBottom: `${(safeAreaInsets?.bottom || 0) / 2}px` }}
        >
          <NotebookTabNavigation activeTab={notebookActiveTab} onTabChange={handleTabChange} />
        </div>
      </div>
    </>
  ) : null;
};

export default Notebook;
