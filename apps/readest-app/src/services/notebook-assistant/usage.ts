import type {
  AssistantUsageAction,
  NotebookAssistantContextType,
  NotebookAssistantCostMode,
  NotebookAssistantSettings,
} from './types';

const USAGE_KEY = 'readest-notebook-assistant-usage-v1';
const MAX_USAGE_ENTRIES = 200;

export interface AssistantTokenEstimate {
  input: number;
  output: number;
}

export interface NotebookAssistantUsageEntry {
  id: string;
  at: number;
  day: string;
  action: AssistantUsageAction;
  contextType: NotebookAssistantContextType | 'book';
  provider: string;
  model: string;
  tokenEstimate: AssistantTokenEstimate;
  success: boolean;
  errorCode?: string;
  bookId?: string;
}

export interface UsageLimitDecision {
  allowed: boolean;
  needsConfirmation: boolean;
  usedToday: number;
  projectedTotal: number;
  limit: number;
}

const safeLocalStorage = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export const dayKey = (time = Date.now()): string => new Date(time).toISOString().slice(0, 10);

export const getNotebookAssistantUsage = (): NotebookAssistantUsageEntry[] => {
  const storage = safeLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(USAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NotebookAssistantUsageEntry[]) : [];
  } catch {
    return [];
  }
};

const saveNotebookAssistantUsage = (entries: NotebookAssistantUsageEntry[]): void => {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(USAGE_KEY, JSON.stringify(entries.slice(-MAX_USAGE_ENTRIES)));
  } catch {
    // Private mode / quota errors should not block reading.
  }
};

export const clearNotebookAssistantUsage = (): void => {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(USAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
};

export const estimateTotalTokens = (estimate: AssistantTokenEstimate): number =>
  Math.max(0, Math.round(estimate.input)) + Math.max(0, Math.round(estimate.output));

export const getTodayNotebookAssistantTokens = (time = Date.now()): number => {
  const today = dayKey(time);
  return getNotebookAssistantUsage()
    .filter((entry) => entry.day === today)
    .reduce((sum, entry) => sum + estimateTotalTokens(entry.tokenEstimate), 0);
};

export const recordNotebookAssistantUsage = (
  entry: Omit<NotebookAssistantUsageEntry, 'id' | 'at' | 'day'>,
  time = Date.now(),
): void => {
  const next: NotebookAssistantUsageEntry = {
    id: `${time}-${Math.random().toString(36).slice(2, 10)}`,
    at: time,
    day: dayKey(time),
    ...entry,
    tokenEstimate: {
      input: Math.max(0, Math.round(entry.tokenEstimate.input)),
      output: Math.max(0, Math.round(entry.tokenEstimate.output)),
    },
  };
  saveNotebookAssistantUsage([...getNotebookAssistantUsage(), next]);
};

export const evaluateUsageLimit = (
  settings: NotebookAssistantSettings,
  estimate: AssistantTokenEstimate,
  time = Date.now(),
): UsageLimitDecision => {
  const limit = Math.max(0, Math.round(settings.dailyTokenLimit || 0));
  const usedToday = settings.usageTrackingEnabled ? getTodayNotebookAssistantTokens(time) : 0;
  const projectedTotal = usedToday + estimateTotalTokens(estimate);
  if (!limit || projectedTotal <= limit) {
    return { allowed: true, needsConfirmation: false, usedToday, projectedTotal, limit };
  }
  const mode: NotebookAssistantCostMode = settings.costMode;
  return {
    allowed: mode !== 'conservative',
    needsConfirmation: mode !== 'conservative',
    usedToday,
    projectedTotal,
    limit,
  };
};

export interface NotebookAssistantDiagnosticsInput {
  settings: NotebookAssistantSettings;
  apiKeyConfigured: boolean;
  secureKeyStorage: boolean;
  platform: string;
  lastError?: string;
}

const safeBaseUrl = (baseUrl: string): string => {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
};

export const buildNotebookAssistantDiagnostics = ({
  settings,
  apiKeyConfigured,
  secureKeyStorage,
  platform,
  lastError,
}: NotebookAssistantDiagnosticsInput): Record<string, unknown> => {
  const usage = getNotebookAssistantUsage();
  const recent = usage.slice(-10).map((entry) => ({
    at: entry.at,
    action: entry.action,
    contextType: entry.contextType,
    provider: entry.provider,
    model: entry.model,
    tokenEstimate: entry.tokenEstimate,
    success: entry.success,
    errorCode: entry.errorCode,
  }));
  return {
    provider: settings.provider,
    model: settings.model,
    baseUrlOrigin: safeBaseUrl(settings.baseUrl),
    targetLanguageConfigured: !!settings.targetLanguage,
    warnAboveTokens: settings.warnAboveTokens,
    dailyTokenLimit: settings.dailyTokenLimit,
    costMode: settings.costMode,
    usageTrackingEnabled: settings.usageTrackingEnabled,
    apiKeyConfigured,
    secureKeyStorage,
    platform,
    todayEstimatedTokens: getTodayNotebookAssistantTokens(),
    recent,
    lastError,
  };
};
