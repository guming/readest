import React, { useEffect, useRef, useState } from 'react';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { TextSelection } from '@/utils/sel';
import { md5Fingerprint } from '@/utils/md5';
import { BookNote } from '@/types/book';
import useShortcuts from '@/hooks/useShortcuts';
import TextEditor, { TextEditorRef } from '@/components/TextEditor';
import TextButton from '@/components/TextButton';

interface NoteEditorProps {
  onSave: (selection: TextSelection, note: string, autoSave?: boolean) => void;
  onEdit: (annotation: BookNote, autoSave?: boolean) => void;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ onSave, onEdit }) => {
  const _ = useTranslation();
  const {
    notebookNewAnnotation,
    notebookEditAnnotation,
    setNotebookNewAnnotation,
    setNotebookEditAnnotation,
    saveNotebookAnnotationDraft,
    getNotebookAnnotationDraft,
  } = useNotebookStore();

  const editorRef = useRef<TextEditorRef>(null);
  const isDirtyRef = useRef(false);
  const [note, setNote] = useState('');
  const [autoSaved, setAutoSaved] = useState(false);
  const separatorWidth = useResponsiveSize(3);

  useEffect(() => {
    if (notebookEditAnnotation) {
      const noteText = notebookEditAnnotation.note;
      setNote(noteText);
      editorRef.current?.setValue(noteText);
      editorRef.current?.focus();
    } else if (notebookNewAnnotation) {
      const noteText = getAnnotationText();
      if (noteText) {
        const draftNote = getNotebookAnnotationDraft(md5Fingerprint(noteText)) || '';
        setNote(draftNote);
        editorRef.current?.setValue(draftNote);
        editorRef.current?.focus();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookNewAnnotation, notebookEditAnnotation]);

  const getAnnotationText = () => {
    return notebookEditAnnotation?.text || notebookNewAnnotation?.text || '';
  };

  const handleNoteChange = (value: string) => {
    isDirtyRef.current = true;
    setAutoSaved(false);
    setNote(value);
  };

  const handleBlur = () => {
    const currentValue = editorRef.current?.getValue();
    if (currentValue) {
      const noteText = getAnnotationText();
      if (noteText) {
        saveNotebookAnnotationDraft(md5Fingerprint(noteText), currentValue);
      }
    }
  };

  const handleSaveNote = (autoSave = false) => {
    const currentValue = editorRef.current?.getValue();
    if (currentValue) {
      if (notebookNewAnnotation) {
        onSave(notebookNewAnnotation, currentValue, autoSave);
      } else if (notebookEditAnnotation) {
        notebookEditAnnotation.note = currentValue;
        onEdit(notebookEditAnnotation, autoSave);
      }
      isDirtyRef.current = false;
      setAutoSaved(autoSave);
    }
  };

  // Drafts survive a panel close immediately; the debounced save also creates
  // or updates the synced annotation/card in the book config while typing.
  useEffect(() => {
    if (!note.trim() || !isDirtyRef.current) return;
    const timeout = window.setTimeout(() => handleSaveNote(true), 800);
    return () => window.clearTimeout(timeout);
  }, [note, notebookNewAnnotation, notebookEditAnnotation]);

  const handleEscape = () => {
    if (notebookNewAnnotation) {
      // Clearing the selection ends the creation flow; Notebook reacts to that
      // and tears down the empty placeholder highlight it created (#4791).
      setNotebookNewAnnotation(null);
    }
    if (notebookEditAnnotation) {
      setNotebookEditAnnotation(null);
    }
  };

  useShortcuts({
    onSaveNote: () => {
      const currentValue = editorRef.current?.getValue();
      if (currentValue) {
        handleSaveNote();
      }
    },
    onEscape: handleEscape,
  });

  const canSave = Boolean(note.trim());

  return (
    <div className='content booknote-item note-editor-container bg-base-100 mt-2 rounded-md p-2'>
      <div className='flex w-full'>
        <TextEditor
          ref={editorRef}
          value={note}
          onChange={handleNoteChange}
          onBlur={handleBlur}
          onSave={handleSaveNote}
          onEscape={handleEscape}
          placeholder={_('Add your notes here...')}
          spellCheck={false}
        />
      </div>

      <div className='flex items-center pt-2'>
        <div
          className='me-2 mt-0.5 min-h-full self-stretch rounded-xl bg-gray-300'
          style={{
            minWidth: `${separatorWidth}px`,
          }}
        ></div>
        <div className='content font-size-sm line-clamp-3'>
          <span className='content font-size-xs text-gray-500'>{getAnnotationText()}</span>
        </div>
      </div>

      <div className='flex justify-end space-x-3 p-2' dir='ltr'>
        <span className='font-size-xs text-gray-500 self-center' aria-live='polite'>
          {autoSaved ? _('Saved') : ''}
        </span>
        <TextButton onClick={handleEscape}>{_('Cancel')}</TextButton>
        <TextButton onClick={handleSaveNote} disabled={!canSave}>
          {_('Save')}
        </TextButton>
      </div>
    </div>
  );
};

export default NoteEditor;
