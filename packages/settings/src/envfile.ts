/**
 * Reads and edits KEY=value files the way the shell sources them, keeping
 * comments, order and every untouched line exactly as they were.
 */

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1);
  return v.replace(/\s+#.*$/, '');
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(LINE);
    if (m) out[m[1]] = unquote(m[2]);
  }
  return out;
}

/** Quotes for zsh/sh `source`: single quotes unless the value is a plain word. */
export function quoteValue(value: string): string {
  if (/^[\w@%+=:,./-]*$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Sets (or with null removes) a key. An existing line is replaced in place;
 * a commented-out "# KEY=" line is reused; otherwise the key is appended.
 */
export function setEnvValue(text: string, key: string, value: string | null): string {
  const lines = text.split('\n');
  const idx = lines.findIndex(l => l.match(LINE)?.[1] === key);
  if (value === null) {
    if (idx >= 0) lines.splice(idx, 1);
    return lines.join('\n');
  }
  const line = `${key}=${quoteValue(value)}`;
  if (idx >= 0) {
    lines[idx] = line;
    return lines.join('\n');
  }
  const commented = lines.findIndex(l => new RegExp(`^\\s*#\\s*${key}=`).test(l));
  if (commented >= 0) {
    lines[commented] = line;
    return lines.join('\n');
  }
  const body = text.endsWith('\n') || text === '' ? text : `${text}\n`;
  return `${body}${line}\n`;
}
