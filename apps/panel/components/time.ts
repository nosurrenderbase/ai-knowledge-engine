const rtf = new Intl.RelativeTimeFormat('tr', {numeric: 'auto'});
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "12 dakika önce", "dün", "şimdi". */
export function ago(iso?: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - now;
  for (const [unit, ms] of UNITS) if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  return 'şimdi';
}

export const fullDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'}) : '—');
