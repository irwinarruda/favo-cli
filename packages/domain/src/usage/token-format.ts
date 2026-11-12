const Units = [
  { size: 1e12, suffix: 'T' },
  { size: 1e9, suffix: 'B' },
  { size: 1e6, suffix: 'M' },
  { size: 1e3, suffix: 'K' },
];
const WholeFrom = 100;

export function formatTokens(value: number) {
  const rounded = Math.round(value);
  for (const [index, { size, suffix }] of Units.entries()) {
    if (rounded < size) continue;
    const text = threeDigits(rounded / size);
    const larger = Units[index - 1];
    return text === '1000' && larger ? `1${larger.suffix}` : `${text}${suffix}`;
  }
  return String(rounded);
}

export function formatDollars(value: number) {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(value: number | undefined) {
  return value === undefined ? '' : `${Math.round(value)}%`;
}

function threeDigits(value: number) {
  if (value >= WholeFrom) return String(Math.round(value));
  const text = value.toFixed(1);
  if (text === '100.0') return '100';
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}
