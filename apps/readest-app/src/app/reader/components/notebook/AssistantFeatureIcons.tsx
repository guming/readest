import type { IconType } from 'react-icons';

export const LearningGuideIcon: IconType = ({ size = '1em', color = 'currentColor', ...props }) => (
  <svg
    {...props}
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke={color}
    strokeWidth='1.7'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M5 18.5V7.8l4-2.3 6 3 4-2.3v10.7l-4 2.3-6-3z' />
    <path d='M9 5.5v10.7M15 8.5v10.7' />
    <path d='m10.8 11.9 1.2 1.2 2.3-2.5' />
  </svg>
);

export const NotebookAssistantIcon: IconType = ({
  size = '1em',
  color = 'currentColor',
  ...props
}) => (
  <svg
    {...props}
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke={color}
    strokeWidth='1.7'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M6 4.5h9.5A2.5 2.5 0 0 1 18 7v12.5H8.5A2.5 2.5 0 0 1 6 17z' />
    <path d='M6 17a2.5 2.5 0 0 1 2.5-2.5H18M9 8h3.5' />
    <path d='m16.8 3 .45 1.25L18.5 4.7l-1.25.45-.45 1.25-.45-1.25-1.25-.45 1.25-.45z' />
  </svg>
);

export const AskMeOneIcon: IconType = ({ size = '1em', color = 'currentColor', ...props }) => (
  <svg
    {...props}
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke={color}
    strokeWidth='1.7'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M4 5.5h16v11H9l-5 3z' />
    <path d='M9.5 9a2.6 2.6 0 0 1 5 1c0 1.8-2.5 1.8-2.5 3.2' />
    <path d='M12 14.8h.01' />
  </svg>
);
