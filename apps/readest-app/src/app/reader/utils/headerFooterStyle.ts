import type { CSSProperties } from 'react';
import type { ViewSettings } from '@/types/book';

export const getHeaderFooterStyle = (
  viewSettings: ViewSettings,
  isEink: boolean,
  isFixedLayout: boolean,
): CSSProperties => {
  const background = viewSettings.headerFooterBackground ?? 'auto';
  const customColor = /^#[0-9a-f]{6}$/i.test(background);
  const style: CSSProperties = {
    fontSize: `${isEink ? Math.max(14, viewSettings.headerFooterFontSize ?? 12) : (viewSettings.headerFooterFontSize ?? 12)}px`,
  };
  if (isEink) return style;
  if (viewSettings.headerFooterTextColor) style.color = viewSettings.headerFooterTextColor;
  if (background === 'none') style.backgroundColor = 'transparent';
  else if (customColor) {
    const opacity = Math.max(0, Math.min(1, viewSettings.headerFooterBgOpacity ?? 0.8));
    const hex = background.slice(1);
    const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    style.backgroundColor = `rgba(${channels.join(', ')}, ${opacity})`;
  }
  if (isFixedLayout && (viewSettings.headerFooterTextColor || background !== 'auto')) {
    style.mixBlendMode = 'normal';
  }
  return style;
};
