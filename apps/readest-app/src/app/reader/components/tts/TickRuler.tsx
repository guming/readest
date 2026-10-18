type TickRulerProps = {
  min: number;
  max: number;
  step: number;
  marks: number[];
  value: number;
  ariaLabel: string;
  formatValue: (value: number) => string;
  formatMark: (value: number) => string;
  onSelect: (value: number) => void;
};

const TickRuler = ({
  min,
  max,
  step,
  marks,
  value,
  ariaLabel,
  formatValue,
  formatMark,
  onSelect,
}: TickRulerProps) => {
  const select = (next: number) => {
    const rounded = Math.min(max, Math.max(min, Math.round(next / step) * step));
    onSelect(Number(rounded.toFixed(4)));
  };

  return (
    <div className='w-full px-4 py-3'>
      <div className='mb-3 text-center text-lg font-medium tabular-nums'>{formatValue(value)}</div>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => select(Number(event.currentTarget.value))}
        className='range range-primary h-8 w-full cursor-pointer'
      />
      <div className='flex justify-between px-1 text-xs text-base-content/60'>
        {marks.map((mark) => (
          <button
            key={mark}
            type='button'
            onClick={() => select(mark)}
            className='min-w-8 py-1 text-center hover:text-base-content'
            aria-label={formatValue(mark)}
          >
            {formatMark(mark)}
          </button>
        ))}
      </div>
    </div>
  );
};

export default TickRuler;
