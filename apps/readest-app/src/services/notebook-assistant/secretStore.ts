import { clearSecureItem, getSecureItem, setSecureItem } from '@/utils/bridge';
import { isTauriAppPlatform } from '@/services/environment';

const SECURE_KEY = 'notebook-assistant-api-key';
const WEB_KEY = 'readest-notebook-assistant-api-key';

export const isAssistantKeySecure = (): boolean => isTauriAppPlatform();

export async function getAssistantApiKey(): Promise<string> {
  if (!isTauriAppPlatform()) {
    return typeof localStorage === 'undefined' ? '' : localStorage.getItem(WEB_KEY) || '';
  }
  try {
    return (await getSecureItem({ key: SECURE_KEY })).value || '';
  } catch {
    return '';
  }
}

export async function setAssistantApiKey(value: string): Promise<void> {
  if (!isTauriAppPlatform()) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(WEB_KEY, value);
    return;
  }
  const result = await setSecureItem({ key: SECURE_KEY, value });
  if (!result.success) throw new Error('Secure storage rejected the API key');
}

export async function clearAssistantApiKey(): Promise<void> {
  if (!isTauriAppPlatform()) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(WEB_KEY);
    return;
  }
  await clearSecureItem({ key: SECURE_KEY });
}
