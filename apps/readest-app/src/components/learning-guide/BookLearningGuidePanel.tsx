'use client';

import React, { useEffect, useState } from 'react';
import { PiBookOpenText, PiQuestion, PiSpinner } from 'react-icons/pi';
import type { Book } from '@/types/book';
import type { BookDoc, BookMetadata } from '@/libs/document';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookLearningGuide } from '@/hooks/useBookLearningGuide';
import NotebookAssistantPanel from '@/components/settings/NotebookAssistantPanel';
import { eventDispatcher } from '@/utils/event';
import LearningGuideDialog from './LearningGuideDialog';
import { recordLearningGuideEvent } from '@/services/notebook-assistant/learningGuideEvents';
import { TooltipIconButton } from '@/components/assistant/TooltipIconButton';

interface Props {
  bookKey: string;
  book?: Book | null;
  metadata?: BookMetadata | null;
  bookDoc?: BookDoc | null;
  compact?: boolean;
}

const stageLabels = {
  collecting_sources: 'Reading the available book information',
  building_framework: 'Building the learning framework',
  validating_result: 'Checking the learning guide',
};

const BookLearningGuidePanel: React.FC<Props> = ({
  bookKey,
  book,
  metadata,
  bookDoc,
  compact = false,
}) => {
  const _ = useTranslation();
  const [showGuide, setShowGuide] = useState(false);
  const learning = useBookLearningGuide({ bookKey, book, metadata, bookDoc });
  const { state } = learning;

  useEffect(() => {
    if (showGuide) {
      recordLearningGuideEvent('learning_guide_opened', bookKey.split('-')[0]);
    }
  }, [bookKey, showGuide]);

  return (
    <>
      <section
        className={compact ? '' : 'eink-bordered border-base-200 bg-base-100 rounded-lg border p-4'}
      >
        <div className='mb-2 flex items-center gap-2'>
          <PiBookOpenText className='shrink-0' aria-hidden='true' />
          <h2 className='text-base font-semibold'>{_('Learning Guide')}</h2>
          <TooltipIconButton
            type='button'
            side='bottom'
            className='eink-bordered text-base-content/65 ms-0.5 rounded-full'
            tooltip={_(
              'Uses the book information and available text to create a learning goal, an understanding path, key points to watch, and questions for checking your understanding. It is not a book summary.',
            )}
            aria-label={_('What is a Learning Guide?')}
          >
            <PiQuestion aria-hidden='true' />
          </TooltipIconButton>
        </div>
        <p className='text-base-content/70 mb-3 text-sm leading-relaxed'>
          {_(
            'Before reading, understand what this book is trying to solve and what to pay attention to.',
          )}
        </p>

        {state.type === 'needs_ai_setup' && <NotebookAssistantPanel compact />}
        {state.type === 'unsupported_fiction' && (
          <div className='bg-base-200/40 eink-bordered rounded-lg p-3 text-sm'>
            <p className='font-semibold'>
              {_('Learning guides currently support nonfiction books only')}
            </p>
            <p className='text-base-content/70 mt-1'>
              {_(
                'This book was identified as fiction or literature, so no knowledge framework will be generated.',
              )}
            </p>
          </div>
        )}
        {state.type === 'classification_uncertain' && (
          <div className='space-y-3'>
            <p className='text-sm'>
              {_('We could not confirm whether this is a nonfiction book.')}
            </p>
            <div className='flex flex-wrap justify-end gap-2'>
              <button type='button' className='btn btn-ghost btn-sm' onClick={learning.refresh}>
                {_('Not now')}
              </button>
              <button
                type='button'
                className='btn btn-primary btn-sm'
                onClick={() => void learning.confirmKnowledgeOnly()}
              >
                {_('Analyze knowledge only')}
              </button>
            </div>
          </div>
        )}
        {state.type === 'classifying' && (
          <p className='flex items-center gap-2 text-sm' aria-live='polite'>
            <PiSpinner className='animate-spin' aria-hidden='true' /> {_('Checking the book type')}
          </p>
        )}
        {state.type === 'generating' && (
          <div aria-live='polite'>
            <p className='flex items-center gap-2 text-sm'>
              <PiSpinner className='animate-spin' aria-hidden='true' />
              {_(stageLabels[state.stage])}
            </p>
            <div className='mt-3 flex justify-end'>
              <button type='button' className='btn btn-ghost btn-sm' onClick={learning.cancel}>
                {_('Cancel')}
              </button>
            </div>
          </div>
        )}
        {state.type === 'error' && (
          <div className='space-y-2'>
            <p className='text-error text-sm'>{state.message}</p>
            {state.previousGuide && (
              <button
                type='button'
                className='btn btn-ghost btn-sm'
                onClick={() => setShowGuide(true)}
              >
                {_('View previous guide')}
              </button>
            )}
          </div>
        )}
        {state.type === 'ready' && (
          <div className='space-y-3'>
            {state.stale && (
              <p className='text-base-content/65 text-sm'>
                {_('More book content is available. Regenerate to improve this guide.')}
              </p>
            )}
            <div className='flex justify-end'>
              <button
                type='button'
                className='btn btn-primary btn-sm min-h-10'
                onClick={() => setShowGuide(true)}
              >
                {_('View Learning Guide')}
              </button>
            </div>
          </div>
        )}
        {state.type === 'idle' && (
          <div className='flex justify-end'>
            <button
              type='button'
              className='btn btn-primary btn-sm min-h-10'
              onClick={() => void learning.generate()}
            >
              {_('Generate Learning Guide')}
            </button>
          </div>
        )}
      </section>
      {showGuide && learning.guide && (
        <LearningGuideDialog
          guide={learning.guide}
          stale={state.type === 'ready' ? state.stale : false}
          isOpen={showGuide}
          onClose={() => setShowGuide(false)}
          onContinue={
            compact
              ? undefined
              : () => {
                  recordLearningGuideEvent(
                    'learning_guide_continue_reading',
                    bookKey.split('-')[0],
                  );
                  eventDispatcher.dispatch('open-book-in-reader', {
                    bookHash: bookKey.split('-')[0],
                  });
                }
          }
          onRegenerate={() => void learning.regenerate()}
          onDelete={() => {
            void learning.deleteGuide();
            setShowGuide(false);
          }}
        />
      )}
    </>
  );
};

export default BookLearningGuidePanel;
