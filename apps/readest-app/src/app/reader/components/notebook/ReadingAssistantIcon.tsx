import type { IconType } from 'react-icons';

/** A reading path through an open book, used for the Reading Assistant surface. */
const ReadingAssistantIcon: IconType = ({ size = '1em', color = 'currentColor', ...props }) => (
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
    <path d='M3.5 5.5c2.6-.8 5.6-.2 8.5 1.6v12.2c-2.9-1.8-5.9-2.4-8.5-1.6z' />
    <path d='M20.5 5.5c-2.6-.8-5.6-.2-8.5 1.6v12.2c2.9-1.8 5.9-2.4 8.5-1.6z' />
    <path d='M6.5 9.2h4.1a2.8 2.8 0 0 1 2.8 2.8v1.5' />
    <path d='m11.7 11.8 1.7 1.7 1.7-1.7' />
    <circle cx='6.5' cy='9.2' r='1' fill='currentColor' stroke='none' />
  </svg>
);

export default ReadingAssistantIcon;
