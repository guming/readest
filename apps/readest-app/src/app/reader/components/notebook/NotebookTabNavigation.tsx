import clsx from 'clsx';
import React from 'react';
import { PiNotePencil } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { NotebookTab } from '@/store/notebookStore';
import ReadingAssistantIcon from './ReadingAssistantIcon';

interface NotebookTabNavigationProps {
  activeTab: NotebookTab;
  onTabChange: (tab: NotebookTab) => void;
}

const NotebookTabNavigation: React.FC<NotebookTabNavigationProps> = ({
  activeTab,
  onTabChange,
}) => {
  const _ = useTranslation();
  const tabs: NotebookTab[] = ['notes', 'ai'];

  const getTabLabel = (tab: NotebookTab) => {
    switch (tab) {
      case 'notes':
        return _('Notebook');
      case 'ai':
        return _('Reading Assistant');
      default:
        return '';
    }
  };

  const getTabIcon = (tab: NotebookTab) => {
    switch (tab) {
      case 'notes':
        return <PiNotePencil className='mx-auto' size={20} />;
      case 'ai':
        return <ReadingAssistantIcon className='mx-auto' size={22} />;
      default:
        return null;
    }
  };

  return (
    <div
      className={clsx('border-base-300/60 flex h-11 w-full gap-1 border-b px-3 pb-2')}
      dir='ltr'
      role='tablist'
      aria-label={_('Notebook')}
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          type='button'
          className={clsx(
            'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors duration-150 active:scale-[0.98]',
            activeTab === tab || (tab === 'ai' && activeTab === 'review')
              ? 'bg-base-300 text-base-content'
              : 'text-base-content/60 hover:bg-base-300/45 hover:text-base-content',
          )}
          onClick={() => onTabChange(tab)}
          title={getTabLabel(tab)}
          aria-label={getTabLabel(tab)}
          role='tab'
          aria-selected={activeTab === tab || (tab === 'ai' && activeTab === 'review')}
        >
          {getTabIcon(tab)}
          <span>{getTabLabel(tab)}</span>
        </button>
      ))}
    </div>
  );
};

export default NotebookTabNavigation;
