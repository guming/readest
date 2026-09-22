'use client';

import React from 'react';
import { PiArrowLeft, PiCopy, PiTrash } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import type { BookLearningGuide } from '@/services/notebook-assistant/types';
import { learningGuideToMarkdown } from '@/services/notebook-assistant/learningGuideStorage';
import { writeTextToClipboard } from '@/utils/clipboard';

interface Props {
  guide: BookLearningGuide;
  stale?: boolean;
  onBack?: () => void;
  onContinue?: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}

const LearningGuideView: React.FC<Props> = ({
  guide,
  stale,
  onBack,
  onContinue,
  onRegenerate,
  onDelete,
}) => {
  const _ = useTranslation();
  const sourceLabel = guide.provenance.sourceKinds
    .map(
      (kind) =>
        ({
          metadata: _('Book information'),
          toc: _('Table of contents'),
          preface: _('Preface'),
          chapter: _('Opening chapter'),
        })[kind],
    )
    .join(' · ');

  return (
    <article className='text-base-content mx-auto w-full max-w-2xl px-1 pb-6'>
      <header className='mb-5'>
        {onBack && (
          <button type='button' className='btn btn-ghost btn-sm mb-2' onClick={onBack}>
            <PiArrowLeft aria-hidden='true' /> {_('Back')}
          </button>
        )}
        <div className='flex flex-wrap items-center gap-2'>
          <h2 className='text-lg font-semibold tracking-tight'>{_('Learn This Book')}</h2>
          <span className='badge badge-ghost text-xs'>
            {guide.status === 'preliminary' ? _('Preliminary guide') : _('Grounded in the book')}
          </span>
        </div>
        <p className='text-base-content/65 mt-1 text-sm leading-relaxed'>
          {_('Based on')}: {sourceLabel}
        </p>
      </header>

      {stale && (
        <div className='eink-bordered bg-base-200/40 mb-5 rounded-lg p-3 text-sm'>
          {_('More book content is available. Regenerate to improve this guide.')}
        </div>
      )}

      <section className='mb-6'>
        <h3 className='mb-2 text-base font-semibold'>{_('Start with this goal')}</h3>
        <p className='text-base leading-7'>{guide.learningGoal}</p>
      </section>

      <section className='border-base-300 mb-6 border-y py-4'>
        <h3 className='mb-3 text-base font-semibold'>{_('Understanding path')}</h3>
        <ol className='flex flex-wrap items-center gap-2' aria-label={_('Understanding path')}>
          {guide.understandingPath.map((item, index) => (
            <React.Fragment key={`${item.id}-${index}`}>
              <li className='bg-base-200 eink-bordered rounded-lg px-3 py-2 text-sm'>
                {item.label}
              </li>
              {index < guide.understandingPath.length - 1 && <span aria-hidden='true'>→</span>}
            </React.Fragment>
          ))}
        </ol>
      </section>

      <section className='mb-6'>
        <h3 className='mb-3 text-base font-semibold'>{_('What to pay attention to')}</h3>
        <ol className='space-y-4'>
          {guide.attentionPoints.map((item, index) => (
            <li key={`${item.id}-${index}`} className='grid grid-cols-[1.5rem_1fr] gap-2'>
              <span className='text-base-content/50 font-semibold'>{index + 1}.</span>
              <div>
                <h4 className='font-semibold'>{item.title}</h4>
                <p className='text-base-content/80 mt-1 text-sm leading-6'>{item.explanation}</p>
                {item.checkQuestion && (
                  <p className='text-base-content/65 mt-1 text-sm'>{item.checkQuestion}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {!!guide.prerequisites?.length && (
        <section className='mb-6'>
          <h3 className='mb-3 text-base font-semibold'>{_('Useful prerequisites')}</h3>
          <ul className='space-y-2'>
            {guide.prerequisites.map((item, index) => (
              <li key={`${item.concept}-${index}`} className='text-sm leading-6'>
                <strong>{item.concept}</strong>: {item.whyNeeded}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!guide.evidenceAndCaveats?.length && (
        <section className='mb-6'>
          <h3 className='mb-3 text-base font-semibold'>{_('Evidence and caveats')}</h3>
          <ul className='list-disc space-y-2 ps-5 text-sm leading-6'>
            {guide.evidenceAndCaveats.map((item, index) => (
              <li key={`${item.claim}-${item.caveat}-${index}`}>
                <strong>{item.claim}</strong>: {item.caveat}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className='mb-6'>
        <h3 className='mb-3 text-base font-semibold'>{_('Check your understanding')}</h3>
        <ul className='space-y-2'>
          {guide.masteryQuestions.map((question, index) => (
            <li key={`${question}-${index}`} className='flex gap-2 text-sm leading-6'>
              <span aria-hidden='true'>□</span>
              <span>{question}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className='flex flex-wrap items-center justify-end gap-2'>
        <button
          type='button'
          className='btn btn-ghost btn-sm'
          onClick={() => void writeTextToClipboard(learningGuideToMarkdown(guide))}
        >
          <PiCopy aria-hidden='true' /> {_('Copy Markdown')}
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-sm text-error'
          onClick={() => {
            if (window.confirm(_('Delete this learning guide?'))) onDelete();
          }}
        >
          <PiTrash aria-hidden='true' /> {_('Delete')}
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-sm'
          onClick={() => {
            if (window.confirm(_('Replace the current learning guide?'))) onRegenerate();
          }}
        >
          {guide.status === 'preliminary' && stale
            ? _('Update with Book Content')
            : _('Regenerate')}
        </button>
        {onContinue && (
          <button type='button' className='btn btn-primary btn-sm' onClick={onContinue}>
            {_('Continue Reading')}
          </button>
        )}
      </div>
    </article>
  );
};

export default LearningGuideView;
