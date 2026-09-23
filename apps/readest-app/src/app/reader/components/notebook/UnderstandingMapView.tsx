'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  toMermaidFlowchart,
  type UnderstandingMap,
} from '@/services/notebook-assistant/understandingMap';
import { useReaderStore } from '@/store/readerStore';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';

export default function UnderstandingMapView({
  map,
  bookKey,
}: {
  map: UnderstandingMap;
  bookKey: string;
}) {
  const _ = useTranslation();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState('');
  const [selectedId, setSelectedId] = useState(map.nodes[0]?.id);
  const { getView } = useReaderStore();
  const diagram = toMermaidFlowchart(map, {
    supports: _('supports'),
    challenges: _('challenges'),
    limits: _('limits'),
    precedes: _('precedes'),
    explains: _('explains'),
  });
  const selected = map.nodes.find((node) => node.id === selectedId);

  useEffect(() => {
    let active = true;
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
        try {
          const rendered = await mermaid.render(`understandingmap${id}`, diagram);
          if (active) setSvg(rendered.svg);
        } catch {
          if (active) setSvg('');
        }
      })
      .catch(() => {
        if (active) setSvg('');
      });
    return () => {
      active = false;
    };
  }, [diagram, id]);

  const navigate = (cfi?: string) => {
    if (!cfi) return;
    eventDispatcher.dispatch('navigate', { bookKey, cfi });
    getView(bookKey)?.goTo(cfi);
  };

  return (
    <div className='space-y-2 text-sm'>
      <p className='font-medium'>{map.question}</p>
      {svg && (
        <div
          className='bg-base-100 eink-bordered overflow-x-auto rounded-md border border-base-300 p-2 [&_svg]:min-w-[320px] [&_svg]:max-w-full'
          role='img'
          aria-label={_('Understanding Map')}
          onClick={(event) => {
            const target = event.target as Element;
            const node = target.closest('g.node');
            const match = node?.id.match(/flowchart-n(\d+)-/);
            if (match) setSelectedId(map.nodes[Number(match[1])]?.id);
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      <div className='flex flex-wrap gap-1'>
        {map.nodes.map((node) => (
          <button
            key={node.id}
            type='button'
            className={`btn btn-xs ${selectedId === node.id ? 'btn-primary' : 'btn-ghost eink-bordered'}`}
            onClick={() => setSelectedId(node.id)}
          >
            {node.label}
          </button>
        ))}
      </div>
      {selected && (
        <div className='bg-base-100 eink-bordered rounded-md border border-base-300 p-2'>
          <p>{selected.explanation}</p>
          <button
            type='button'
            className='mt-1 text-left text-xs text-base-content/70 underline disabled:no-underline'
            disabled={!selected.sourceCfi}
            onClick={() => navigate(selected.sourceCfi)}
          >
            “{selected.evidenceQuote}” {selected.sourceCfi ? `· ${_('View in book')}` : ''}
          </button>
        </div>
      )}
      <button
        type='button'
        className='btn btn-ghost btn-xs'
        onClick={() => void writeTextToClipboard(diagram)}
      >
        {_('Copy Mermaid')}
      </button>
    </div>
  );
}
