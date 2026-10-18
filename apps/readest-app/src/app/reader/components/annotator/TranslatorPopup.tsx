import { useSettingsStore } from '@/store/settingsStore';
import { getAIConnections } from '@/services/ai/connections';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import React, { useEffect, useState } from 'react';
import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useTranslator } from '@/hooks/useTranslator';
import { TRANSLATOR_LANGS } from '@/services/constants';
import {
  UseTranslatorOptions,
  getTranslatorDisplayLabel,
  getTranslators,
  isTranslatorAvailable,
} from '@/services/translators';
import Select from '@/components/Select';

const notSupportedLangs = [''];

const generateTranslatorLangs = () => {
  return Object.fromEntries(
    Object.entries(TRANSLATOR_LANGS).filter(([code]) => !notSupportedLangs.includes(code)),
  );
};

const translatorLangs = generateTranslatorLangs();

interface TranslatorPopupProps {
  text: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  currentProvider: string;
  currentTargetLang: string;
  onDismiss?: () => void;
  onSelectCustomAI?: (connectionId?: string) => void;
  onProviderChange?: (provider: string) => void;
  onTargetLangChange?: (targetLang: string) => void;
}

interface TranslatorType {
  name: string;
  label: string;
  disabled: boolean;
}

const resolveAvailableProvider = (requestedProvider: string, hasToken: boolean): string => {
  const availableTranslators = getTranslators().filter((t) => isTranslatorAvailable(t, hasToken));
  return (
    availableTranslators.find((t) => t.name === requestedProvider)?.name ||
    availableTranslators[0]?.name ||
    'google'
  );
};

const TranslatorPopup: React.FC<TranslatorPopupProps> = ({
  text,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  currentProvider,
  currentTargetLang,
  onDismiss,
  onSelectCustomAI,
  onProviderChange,
  onTargetLangChange,
}) => {
  const _ = useTranslation();
  const { token } = useAuth();
  const { settings } = useSettingsStore();
  const aiConnections = getAIConnections(settings.aiSettings || DEFAULT_AI_SETTINGS);
  const [providers, setProviders] = useState<TranslatorType[]>([]);
  const [sourceLang, setSourceLang] = useState('AUTO');
  const [targetLang, setTargetLang] = useState(currentTargetLang);
  const [provider, setProvider] = useState(() =>
    resolveAvailableProvider(currentProvider, !!token),
  );
  const [translation, setTranslation] = useState<string | null>(null);
  const [detectedSourceLang, setDetectedSourceLang] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { translate, translators } = useTranslator({
    provider,
    sourceLang,
    targetLang,
  } as UseTranslatorOptions);

  const handleSourceLangChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSourceLang(event.target.value);
  };

  const handleTargetLangChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextTargetLang = event.target.value;
    setTargetLang(nextTargetLang);
    onTargetLangChange?.(nextTargetLang);
  };

  const handleProviderChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const requestedProvider = event.target.value;
    if (requestedProvider === 'custom-ai' || requestedProvider.startsWith('ai:')) {
      onSelectCustomAI?.(
        requestedProvider === 'custom-ai' ? '__add__' : requestedProvider.slice(3),
      );
      return;
    }
    const availableTranslators = getTranslators().filter((t) => isTranslatorAvailable(t, !!token));
    const selectedTranslator =
      availableTranslators.find((t) => t.name === requestedProvider) || availableTranslators[0]!;
    if (selectedTranslator) {
      onProviderChange?.(selectedTranslator.name);
      setProvider(selectedTranslator.name);
    }
  };

  useEffect(() => {
    setProvider(resolveAvailableProvider(currentProvider, !!token));
  }, [currentProvider, token]);

  useEffect(() => {
    setTargetLang(currentTargetLang);
  }, [currentTargetLang]);

  useEffect(() => {
    const availableProviders = translators.map((t) => ({
      name: t.name,
      label: getTranslatorDisplayLabel(t, !!token, _),
      disabled: !!t.disabled,
    }));
    setProviders([
      ...availableProviders,
      ...aiConnections.map((connection) => ({
        name: `ai:${connection.id}`,
        label: `${connection.name} · ${connection.model}`,
        disabled: false,
      })),
      { name: 'custom-ai', label: _('Add AI Service…'), disabled: false },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translators, settings.aiSettings]);

  useEffect(() => {
    setLoading(true);
    const fetchTranslation = async () => {
      setError(null);
      setTranslation(null);

      try {
        const input = text.replaceAll('\n', '').trim();
        const result = await translate([input]);
        const translatedText = result[0];
        const detectedSource = null;

        if (!translatedText) {
          throw new Error('No translation found');
        }

        setTranslation(translatedText);
        if (sourceLang === 'AUTO' && detectedSource) {
          setDetectedSourceLang(detectedSource);
        }
      } catch (err) {
        console.error(err);
        if (!token) {
          setError(_('Unable to fetch the translation. Please log in first and try again.'));
        } else {
          setError(_('Unable to fetch the translation. Try again later.'));
        }
      } finally {
        setLoading(false);
      }
    };

    fetchTranslation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, token, sourceLang, targetLang, provider, translate]);

  return (
    <div>
      <Popup
        trianglePosition={trianglePosition}
        width={popupWidth}
        minHeight={popupHeight}
        maxHeight={720}
        position={position}
        className='grid h-full select-text grid-rows-[1fr,auto,1fr,auto]'
        onDismiss={onDismiss}
      >
        <div className='overflow-y-auto p-4 font-sans'>
          <div className='mb-2 flex items-center justify-between'>
            <h1 className='text-sm font-medium'>{_('Original Text')}</h1>
            <Select
              value={sourceLang}
              onChange={handleSourceLangChange}
              options={[
                { value: 'AUTO', label: _('Auto Detect') },
                ...Object.entries(translatorLangs)
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([code, name]) => {
                    const label =
                      detectedSourceLang && sourceLang === 'AUTO' && code === 'AUTO'
                        ? `${translatorLangs[detectedSourceLang] || detectedSourceLang} ` +
                          _('(detected)')
                        : name;
                    return { value: code, label };
                  }),
              ]}
            />
          </div>
          <p className='text-base'>{text}</p>
        </div>

        <div className='mx-4 flex-shrink-0 border-t border-base-content/20'></div>

        <div className='overflow-y-auto p-4 font-sans'>
          <div className='mb-2 flex items-center justify-between'>
            <h2 className='text-sm font-medium'>{_('Translated Text')}</h2>
            <Select
              value={targetLang}
              onChange={handleTargetLangChange}
              options={[
                { value: '', label: _('System Language') },
                ...Object.entries(translatorLangs)
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([code, name]) => ({ value: code, label: name })),
              ]}
            />
          </div>
          {loading ? (
            <p className='text-base-content/80 italic'>{_('Loading...')}</p>
          ) : (
            <div>
              {error ? (
                <p className='text-base text-red-600'>{error}</p>
              ) : (
                <p className='text-base'>{translation || _('No translation available.')}</p>
              )}
            </div>
          )}
        </div>
        <div className='border-base-content/20 bg-base-200/40 flex shrink-0 items-center justify-between gap-2 rounded-b-lg border-t px-4 py-2'>
          <div className='line-clamp-1 text-xs text-base-content/60'>
            {provider &&
              !loading &&
              !error &&
              _('Translated by {{provider}}.', {
                provider: providers.find((p) => p.name === provider)?.label,
              })}
          </div>
          <Select
            value={provider}
            onChange={handleProviderChange}
            options={providers.map(({ name: value, label, disabled }) => ({
              value,
              label,
              disabled,
            }))}
          />
        </div>
      </Popup>
    </div>
  );
};

export default TranslatorPopup;
