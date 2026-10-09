/**
 * Things that must never reach the knowledge base (UPDATE-PROMPT.md, "YASAKLAR").
 * Runs on added lines only; any hit stops the job without retry.
 */

const PATTERNS: [string, RegExp][] = [
  ['bağlantı adresi', /\b(mongodb(\+srv)?|redis|rediss|postgres(ql)?|mysql|amqp):\/\/[^\s`'"]+/i],
  ['özel anahtar', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS erişim anahtarı', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/],
  ['Anthropic anahtarı', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['parola ataması', /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
  ['e-posta', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
];

const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;

/** Turkish national ID: 11 digits, first non-zero, two check digits. */
export function isTcKimlik(digits: string): boolean {
  if (!/^[1-9]\d{10}$/.test(digits)) return false;
  const d = [...digits].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  if ((((odd * 7 - even) % 10) + 10) % 10 !== d[9]) return false;
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}

function hasIp(line: string): boolean {
  for (const m of line.matchAll(IPV4)) {
    const octets = m.slice(1, 5).map(Number);
    if (octets.some(o => o > 255)) continue;
    // Turkish thousands ("8.000.000.000 bayt", "1.050.000"): a zero-padded group never appears in a written IP.
    if (m.slice(1, 5).some(g => g.length > 1 && g.startsWith('0'))) continue;
    // Version numbers ("v1.2.3.4", "8.10.1.0") are not addresses; loopback/unspecified are harmless.
    const before = line.slice(Math.max(0, m.index - 1), m.index);
    if (/[vV]/.test(before)) continue;
    if (m[0] === '0.0.0.0' || m[0].startsWith('127.')) continue;
    return true;
  }
  return false;
}

export function findSecrets(line: string): string[] {
  const hits = PATTERNS.filter(([, re]) => re.test(line)).map(([name]) => name);
  if (hasIp(line)) hits.push('IP adresi');
  for (const m of line.matchAll(/(?<!\d)\d{11}(?!\d)/g)) {
    if (isTcKimlik(m[0])) {
      hits.push('TC kimlik numarası');
      break;
    }
  }
  return hits;
}
