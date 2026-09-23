import clsx from 'clsx';
import React from 'react';
import { PiNotePencil } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
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
  const { appService } = useEnv();
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
      className={clsx(
        'bottom-tab border-base-300/50 bg-base-200/20 flex min-h-[62px] w-full border-t',
        appService?.hasRoundedWindow && 'rounded-window-bottom-right',
      )}
      dir='ltr'
      role='tablist'
      aria-label={_('Notebook')}
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          type='button'
          className={clsx(
            'm-1.5 flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-2 py-1 transition-colors duration-200 active:scale-95',
            (activeTab === tab || (tab === 'ai' && activeTab === 'review')) && 'bg-base-300/85',
          )}
          onClick={() => onTabChange(tab)}
          title={getTabLabel(tab)}
          aria-label={getTabLabel(tab)}
          role='tab'
          aria-selected={activeTab === tab || (tab === 'ai' && activeTab === 'review')}
        >
          <span className='flex h-6 items-center'>{getTabIcon(tab)}</span>
          <span className='text-[10px] leading-none'>{getTabLabel(tab)}</span>
        </button>
      ))}
    </div>
  );
};

export default NotebookTabNavigation;
