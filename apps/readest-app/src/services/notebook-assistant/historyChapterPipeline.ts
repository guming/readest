import type { OneQuestionSourceBlock } from './types';
import type { HistoryChapterGuide } from './historyChapterGuide';
import { parseHistoryChapterGuide } from './historyChapterGuide';

export type HistoryProgress = {
  stage: 'reading' | 'synthesizing' | 'complete';
  completed: number;
  total: number;
};

export function groupHistoryPassages(blocks: OneQuestionSourceBlock[], maxGroupChars = 6_000) {
  const groups: OneQuestionSourceBlock[][] = [];
  let current: OneQuestionSourceBlock[] = [];
  let chars = 0;
  for (const block of blocks) {
    if (current.length && chars + block.text.length > maxGroupChars) {
      groups.push(current);
      current = [];
      chars = 0;
    }
    current.push(block);
    chars += block.text.length;
  }
  if (current.length) groups.push(current);
  return groups;
}

export async function runHistoryChapterPipeline(
  blocks: OneQuestionSourceBlock[],
  deps: {
    analyze: (group: OneQuestionSourceBlock[]) => Promise<HistoryChapterGuide>;
    synthesize: (notes: HistoryChapterGuide[]) => Promise<HistoryChapterGuide>;
    onProgress?: (progress: HistoryProgress) => void;
    maxGroupChars?: number;
    signal?: AbortSignal;
    cacheKey?: string;
  },
): Promise<HistoryChapterGuide> {
  const groups = groupHistoryPassages(blocks, deps.maxGroupChars ?? 3_000);
  if (!groups.length) throw new Error('No linkable chapter text.');
  const notes: HistoryChapterGuide[] = [];
  const cache = readCache(deps.cacheKey, groups.length) ?? new Array<CachedNote>(groups.length);
  for (const [index, group] of groups.entries()) {
    if (deps.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    deps.onProgress?.({ stage: 'reading', completed: index, total: groups.length });
    try {
      const cached = cache[index];
      const cachedNote =
        cached && cached.startId === group[0]?.id && cached.endId === group.at(-1)?.id
          ? validateCachedNote(cached.note, group)
          : null;
      const note = cachedNote ?? (await deps.analyze(group));
      notes.push(note);
      cache[index] = { startId: group[0]?.id ?? '', endId: group.at(-1)?.id ?? '', note };
      writeCache(deps.cacheKey, cache);
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') throw cause;
      throw new Error(
        `Could not analyze part ${index + 1} of ${groups.length}: ${(cause as Error).message}`,
      );
    }
    deps.onProgress?.({ stage: 'reading', completed: index + 1, total: groups.length });
  }
  if (deps.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  let level = notes;
  while (level.length > 5) {
    const batches: HistoryChapterGuide[][] = [];
    for (let index = 0; index < level.length; index += 5)
      batches.push(level.slice(index, index + 5));
    const next: HistoryChapterGuide[] = [];
    for (const [index, batch] of batches.entries()) {
      if (deps.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      deps.onProgress?.({ stage: 'synthesizing', completed: index, total: batches.length });
      try {
        next.push(await deps.synthesize(batch));
      } catch (cause) {
        if ((cause as Error).name === 'AbortError') throw cause;
        throw new Error(`Could not combine chapter findings: ${(cause as Error).message}`);
      }
    }
    level = next;
  }
  deps.onProgress?.({ stage: 'synthesizing', completed: 0, total: 1 });
  let result: HistoryChapterGuide;
  try {
    result = await deps.synthesize(level);
  } catch (cause) {
    if ((cause as Error).name === 'AbortError') throw cause;
    throw new Error(`Could not combine chapter findings: ${(cause as Error).message}`);
  }
  deps.onProgress?.({ stage: 'complete', completed: 1, total: 1 });
  return result;
}

type CachedNote = { startId: string; endId: string; note: HistoryChapterGuide };

function readCache(cacheKey: string | undefined, expectedGroups: number): CachedNote[] | null {
  const storage = getLocalStorage();
  if (!cacheKey || !storage) return null;
  try {
    const value = JSON.parse(storage.getItem(cacheKey) ?? 'null') as unknown;
    return Array.isArray(value) && value.length === expectedGroups ? (value as CachedNote[]) : null;
  } catch {
    return null;
  }
}

function writeCache(cacheKey: string | undefined, notes: CachedNote[]) {
  const storage = getLocalStorage();
  if (!cacheKey || !storage) return;
  try {
    storage.setItem(cacheKey, JSON.stringify(notes));
  } catch {
    // A full or unavailable local store only disables retry reuse.
  }
}

function validateCachedNote(note: HistoryChapterGuide, group: OneQuestionSourceBlock[]) {
  try {
    return parseHistoryChapterGuide(JSON.stringify(note), group);
  } catch {
    return null;
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
