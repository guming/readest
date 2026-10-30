import { useTranslation } from '@/hooks/useTranslation';

interface LibraryViewTabsProps {
  active: 'books' | 'highlights';
  onBooks?: () => void;
  onHighlights?: () => void;
}

export default function LibraryViewTabs({ active, onBooks, onHighlights }: LibraryViewTabsProps) {
  const _ = useTranslation();
  return (
    <nav
      aria-label={_('Library')}
      className='bg-base-200 flex shrink-0 gap-6 border-b border-base-300 px-4 sm:px-6'
    >
      <button
        type='button'
        onClick={onBooks}
        disabled={active === 'books'}
        aria-current={active === 'books' ? 'page' : undefined}
        className={`border-b-2 px-1 py-3 text-sm font-medium ${active === 'books' ? 'border-primary text-base-content' : 'text-base-content/60 border-transparent hover:text-base-content'}`}
      >
        {_('Books')}
      </button>
      <button
        type='button'
        onClick={onHighlights}
        disabled={active === 'highlights'}
        aria-current={active === 'highlights' ? 'page' : undefined}
        className={`border-b-2 px-1 py-3 text-sm font-medium ${active === 'highlights' ? 'border-primary text-base-content' : 'text-base-content/60 border-transparent hover:text-base-content'}`}
      >
        {_('Highlights')}
      </button>
    </nav>
  );
}
