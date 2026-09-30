export type Level = 'info' | 'warn' | 'error';

export interface Logger {
  (level: Level, msg: string, fields?: Record<string, unknown>): void;
}

/** One JSON object per line on stderr; easy to ship to any log store. */
export const jsonLogger: Logger = (level, msg, fields) => {
  process.stderr.write(JSON.stringify({time: new Date().toISOString(), level, msg, ...fields}) + '\n');
};

export interface Alerter {
  (message: string, fields?: Record<string, unknown>): Promise<void>;
}

/**
 * Logs the alert and, when a webhook URL is configured, posts `{text}` to it
 * (Slack incoming webhooks accept this shape). Delivery failures are logged, never thrown.
 */
export function makeAlerter(log: Logger, webhookUrl: string | undefined): Alerter {
  return async (message, fields) => {
    log('error', `ALARM: ${message}`, fields);
    if (!webhookUrl) return;
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({text: `kbsync: ${message}`}),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) log('warn', 'alarm gönderilemedi', {status: res.status});
    } catch (e) {
      log('warn', 'alarm gönderilemedi', {error: (e as Error).message});
    }
  };
}
