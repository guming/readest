'use client';

import React from 'react';
import Dialog from '@/components/Dialog';
import ModalPortal from '@/components/ModalPortal';
import { useTranslation } from '@/hooks/useTranslation';
import type { BookLearningGuide } from '@/services/notebook-assistant/types';
import LearningGuideView from './LearningGuideView';

interface Props {
  guide: BookLearningGuide;
  isOpen: boolean;
  stale?: boolean;
  onClose: () => void;
  onContinue?: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}

const LearningGuideDialog: React.FC<Props> = ({
  guide,
  isOpen,
  stale,
  onClose,
  onContinue,
  onRegenerate,
  onDelete,
}) => {
  const _ = useTranslation();

  return (
    <ModalPortal showOverlay={false}>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title={_('Learning Guide')}
        useOverlayScroll
        boxClassName='sm:!h-[92%] sm:!w-[min(760px,calc(100%-2rem))] sm:!max-w-[760px]'
        contentClassName='!px-4 sm:!px-8'
      >
        <LearningGuideView
          guide={guide}
          stale={stale}
          onBack={onClose}
          onContinue={onContinue}
          onRegenerate={onRegenerate}
          onDelete={onDelete}
        />
      </Dialog>
    </ModalPortal>
  );
};

export default LearningGuideDialog;
