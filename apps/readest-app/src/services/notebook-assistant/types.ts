import { OPENAI_COMPATIBLE_TEMPLATES } from '@/services/ai/constants';
import type { OpenAICompatibleTemplate } from '@/services/ai/types';

export type NotebookAssistantProvider = OpenAICompatibleTemplate;
export type NotebookAssistantConnectionSource = 'legacy' | 'global';
export type NotebookAssistantSummaryStyle = 'structured' | 'brief' | 'detailed';
export type NotebookAssistantCostMode = 'conservative' | 'balanced' | 'full_context';

export interface NotebookAssistantSettings {
  /**
   * Existing installations remain on `legacy` until the user explicitly
   * chooses the global AI provider. This prevents a local configuration from
   * silently switching to a cloud endpoint (or vice versa).
   */
  connectionSource: NotebookAssistantConnectionSource;
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

export interface BookExpertProfile {
  schemaVersion: 1;
  revision: number;
  primaryDomain: string;
  relatedDomains: string[];
  expertRole: string;
  teachingPrinciples: string[];
  domainRules: string[];
  confidence: number;
  initializedFrom: string[];
  updatedAt: string;
}

export interface ExplanationFollowUp {
  id: string;
  label: string;
}

export interface ExpertExplanationResult {
  domain: string;
  subdomain: string;
  contentType: string;
  label: string;
  explanation: string;
  followUps: ExplanationFollowUp[];
  expertProfile?: BookExpertProfile;
}
export type NotebookAssistantContextType = 'selection' | 'page' | 'chapter';
export type NotebookAssistantCardAction = 'summary' | 'insight' | 'takeaway';
export type AssistantUsageAction =
  | 'understanding_map'
  | SelectedTextAction
  | NotebookAssistantCardAction
  | 'quiz'
  | 'one_question'
  | 'learning_guide';

export type NonFictionCategory =
  | 'social_science'
  | 'business'
  | 'history'
  | 'philosophy'
  | 'science'
  | 'technology'
  | 'textbook'
  | 'biography'
  | 'essay'
  | 'other_nonfiction';

export type LearningGuideSourceKind = 'metadata' | 'toc' | 'preface' | 'chapter';

export type BookLearningEligibility =
  | {
      status: 'supported';
      category: NonFictionCategory;
      confidence: number;
      evidence: string[];
    }
  | {
      status: 'unsupported_fiction';
      confidence: number;
      evidence: string[];
    }
  | {
      status: 'uncertain';
      confidence: number;
      evidence: string[];
    };

export interface BookLearningGuide {
  schemaVersion: 1;
  bookKey: string;
  status: 'preliminary' | 'grounded';
  category: NonFictionCategory;
  learningGoal: string;
  understandingPath: Array<{ id: string; label: string }>;
  attentionPoints: Array<{
    id: string;
    title: string;
    explanation: string;
    checkQuestion?: string;
  }>;
  prerequisites?: Array<{ concept: string; whyNeeded: string }>;
  evidenceAndCaveats?: Array<{ claim: string; caveat: string }>;
  masteryQuestions: string[];
  provenance: {
    sourceKinds: LearningGuideSourceKind[];
    sourceFingerprint: string;
    provider: string;
    model: string;
    promptVersion: number;
    generatedAt: number;
  };
}

export interface BookLearningGuideRequest {
  bookKey: string;
  title: string;
  author?: string;
  category: NonFictionCategory;
  sourceText: string;
  targetLanguage: string;
  knowledgeOnly?: boolean;
}

export type BookLearningGuideResult =
  | { guide: BookLearningGuide }
  | { guide: null; reason: 'insufficient_content' };

export type LearningGuideErrorCode =
  | 'not_configured'
  | 'unauthorized'
  | 'rate_limited'
  | 'network'
  | 'timeout'
  | 'invalid_response'
  | 'unsupported_fiction'
  | 'insufficient_content'
  | 'invalid_guide';
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
  bookTitle?: string;
  bookAuthor?: string;
  chapterId?: string;
  chapterTitle?: string;
  surroundingContext?: {
    before: string[];
    selectedBlock: string;
    after: string[];
  };
  expertProfile?: BookExpertProfile;
  rebuildExpertProfile?: boolean;
  followUp?: ExplanationFollowUp;
  previousExplanation?: string;
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
> = OPENAI_COMPATIBLE_TEMPLATES;

export const DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS: NotebookAssistantSettings = {
  connectionSource: 'legacy',
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
  // Notebook Assistant now always follows the active global AI provider.
  // Keep legacy connection fields in storage for backwards-compatible
  // deserialization, but never select that connection at runtime.
  resolved.connectionSource = 'global';
  return resolved;
};
