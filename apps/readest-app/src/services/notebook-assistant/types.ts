export type NotebookAssistantProvider = 'openai' | 'deepseek' | 'qwen' | 'openrouter' | 'custom';
export type NotebookAssistantSummaryStyle = 'structured' | 'brief' | 'detailed';
export type NotebookAssistantCostMode = 'conservative' | 'balanced' | 'full_context';

export interface NotebookAssistantSettings {
  provider: NotebookAssistantProvider;
  baseUrl: string;
  model: string;
  targetLanguage: string;
  warnAboveTokens: number;
  defaultQuizQuestionCount: number;
  defaultSummaryStyle: NotebookAssistantSummaryStyle;
  costMode: NotebookAssistantCostMode;
  dailyTokenLimit: number;
  usageTrackingEnabled: boolean;
}

export type SelectedTextAction = 'translation' | 'explanation';
export type NotebookAssistantContextType = 'selection' | 'page' | 'chapter';
export type NotebookAssistantCardAction = 'summary' | 'insight' | 'takeaway';
export type AssistantUsageAction =
  | SelectedTextAction
  | NotebookAssistantCardAction
  | 'quiz'
  | 'one_question';
export type QuizQuestionType = 'multiple_choice' | 'true_false' | 'short_answer';

export type OneQuestionType = 'multiple_choice' | 'open';

export interface OneQuestionChoice {
  id: string;
  text: string;
}

export interface OneQuestionSourceBlock {
  id: string;
  text: string;
  cfi: string;
  endCfi: string;
}

export interface OneQuestionSourceAnchor {
  blockId: string;
  cfi: string;
  endCfi: string;
}

export interface OneQuestion {
  id: string;
  type: OneQuestionType;
  question: string;
  choices?: OneQuestionChoice[];
  correctChoiceId?: string;
  referenceAnswer: string;
  evidenceQuote: string;
  sourceAnchor?: OneQuestionSourceAnchor;
}

export type OneQuestionResult =
  | { question: OneQuestion }
  | { question: null; reason: 'insufficient_content' };

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  question: string;
  choices?: string[];
  answer: string;
  explanation: string;
  userAnswer?: string;
  isCorrect?: boolean;
}

export interface QuizCardContent {
  questions: QuizQuestion[];
  score?: number;
}

export interface SelectedTextRequest {
  action: SelectedTextAction;
  sourceText: string;
  sourceLanguage?: string;
  targetLanguage: string;
  provider: string;
  model: string;
}

export interface NotebookContextRequest {
  action: NotebookAssistantCardAction;
  contextType: Exclude<NotebookAssistantContextType, 'selection'>;
  sourceText: string;
  title?: string;
  targetLanguage: string;
  provider: string;
  model: string;
  summaryStyle?: NotebookAssistantSummaryStyle;
}

export interface ChapterQuizRequest {
  sourceText: string;
  title?: string;
  targetLanguage: string;
  provider: string;
  model: string;
  questionCount?: number;
}

export interface OneQuestionRequest {
  sourceText: string;
  sourceBlocks?: OneQuestionSourceBlock[];
  title?: string;
  targetLanguage: string;
  provider: string;
  model: string;
}

export const NOTEBOOK_ASSISTANT_TEMPLATES: Record<
  NotebookAssistantProvider,
  Pick<NotebookAssistantSettings, 'baseUrl' | 'model'>
> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  custom: { baseUrl: '', model: '' },
};

export const DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS: NotebookAssistantSettings = {
  provider: 'openai',
  ...NOTEBOOK_ASSISTANT_TEMPLATES.openai,
  targetLanguage: '',
  warnAboveTokens: 10_000,
  defaultQuizQuestionCount: 5,
  defaultSummaryStyle: 'structured',
  costMode: 'conservative',
  dailyTokenLimit: 0,
  usageTrackingEnabled: true,
};

export const resolveNotebookAssistantSettings = (
  settings?: Partial<NotebookAssistantSettings> | null,
): NotebookAssistantSettings => {
  const resolved = {
    ...DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
    ...(settings ?? {}),
  };
  // Migrate the former default so existing installations also become unlimited.
  if (resolved.dailyTokenLimit === 100_000) resolved.dailyTokenLimit = 0;
  return resolved;
};
