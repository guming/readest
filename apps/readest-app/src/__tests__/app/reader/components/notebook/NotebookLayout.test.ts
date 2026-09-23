import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const readSource = (file: string) =>
  readFileSync(resolve(process.cwd(), 'src/app/reader/components/notebook', file), 'utf8');

describe('notebook navigation layout', () => {
  test('keeps the notebook and reading assistant tabs at the bottom of the panel', () => {
    const source = readSource('Notebook.tsx');
    const tabsIndex = source.indexOf('<NotebookTabNavigation');
    const contentIndex = source.indexOf('{isReadingAssistantTab ? (');

    expect(contentIndex).toBeGreaterThan(-1);
    expect(tabsIndex).toBeGreaterThan(contentIndex);
    expect(source.match(/<NotebookTabNavigation/g)).toHaveLength(1);
  });

  test('uses distinct icons for each reading assistant feature', () => {
    expect(readSource('AssistantFeatureIcons.tsx')).toContain('LearningGuideIcon');
    expect(readSource('AssistantFeatureIcons.tsx')).toContain('NotebookAssistantIcon');
    expect(readSource('AssistantFeatureIcons.tsx')).toContain('AskMeOneIcon');
    expect(readSource('NotebookAssistantActions.tsx')).toContain('<NotebookAssistantIcon');
    expect(readSource('NotebookReview.tsx')).toContain('<AskMeOneIcon');
  });
});
