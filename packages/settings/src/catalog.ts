/**
 * The settings the panel may show and change. Anything not listed here is
 * neither shown nor writable. Keys whose change could lock the panel out or
 * break stored data (Postgres password, tunnel token, Access config, Redis
 * password, repo paths) are listed read-only: they are changed on the server.
 */

/** What must be restarted for a change to take effect. */
export type Target = 'mcp' | 'panel' | 'worker' | 'cloudflared';

export type EnvFile = 'env' | 'kbsync';

export interface SettingDef {
  key: string;
  file: EnvFile;
  group: string;
  about: string;
  /** Never shown; only "set" and the last 4 characters. */
  secret: boolean;
  /** Shown but changed only on the server (by hand). */
  readOnly?: boolean;
  restart: Target[];
  /** Validation for a new value (empty clears the key unless required). */
  pattern?: RegExp;
  required?: boolean;
}

export const FILES: Record<EnvFile, string> = {env: '.env', kbsync: 'deploy/kbsync.env'};

const INT = /^\d{1,9}$/;
const HTTPS = /^https:\/\/\S+$/;

export const SETTINGS: SettingDef[] = [
  // Arama (Voyage)
  {key: 'VOYAGE_API_KEY', file: 'env', group: 'Arama', about: 'Voyage embedding API anahtarı (MongoDB Atlas)', secret: true, restart: ['mcp', 'panel', 'worker'], required: true},
  {key: 'VOYAGE_API_URL', file: 'env', group: 'Arama', about: 'Voyage uç noktası (ör. ai.mongodb.com)', secret: false, restart: ['mcp', 'panel', 'worker'], pattern: /^[\w.:/-]+$/},
  {key: 'VOYAGE_MODEL', file: 'env', group: 'Arama', about: 'Embedding modeli (varsayılan voyage-4-large); değişirse indeks yeniden kurulur', secret: false, restart: ['mcp', 'panel', 'worker'], pattern: /^[\w.-]+$/},

  // MCP
  {key: 'MCP_TOKEN', file: 'env', group: 'MCP', about: 'Eski ortak token; boşaltılırsa yalnız kişisel token\'lar çalışır', secret: true, restart: ['mcp']},
  {key: 'USAGE_RETENTION_DAYS', file: 'env', group: 'MCP', about: 'Ayrıntılı kullanım kayıtlarının saklanacağı gün (varsayılan 90)', secret: false, restart: ['mcp'], pattern: INT},
  {key: 'MONGO_RO_URI', file: 'env', group: 'Oyun veritabanı', about: 'Salt okunur MongoDB bağlantısı (db_* araçları)', secret: true, restart: ['mcp'], pattern: /^mongodb(\+srv)?:\/\/\S+$/},
  {key: 'MONGO_RO_DB', file: 'env', group: 'Oyun veritabanı', about: 'Veritabanı adı (URI\'de yoksa)', secret: false, restart: ['mcp'], pattern: /^[\w-]+$/},

  // Panel
  {key: 'PANEL_PASSWORD', file: 'env', group: 'Panel', about: 'Panel giriş parolası', secret: true, restart: ['panel'], required: true, pattern: /^.{10,}$/},
  {key: 'PANEL_SECRET', file: 'env', group: 'Panel', about: 'Oturum imza anahtarı; değişirse herkesin oturumu kapanır', secret: true, restart: ['panel'], required: true, pattern: /^.{32,}$/},

  // İşçi
  {key: 'CLAUDE_CODE_OAUTH_TOKEN', file: 'kbsync', group: 'İşçi', about: 'Botun Claude abonelik token\'ı (claude setup-token)', secret: true, restart: ['worker'], required: true},
  {key: 'ALERT_WEBHOOK_URL', file: 'kbsync', group: 'İşçi', about: 'Alarmların gideceği adres (Slack incoming webhook); işçi ve deploy', secret: true, restart: ['worker'], pattern: HTTPS},
  {key: 'CLAUDE_MODEL', file: 'kbsync', group: 'İşçi', about: 'Güncelleme işlerinde kullanılan model (varsayılan opus)', secret: false, restart: ['worker'], pattern: /^[\w.-]+$/},
  {key: 'POLL_INTERVAL_MS', file: 'kbsync', group: 'İşçi', about: 'Kod repolarını yoklama aralığı, ms (varsayılan 120000)', secret: false, restart: ['worker'], pattern: INT},
  {key: 'BATCH_THRESHOLD', file: 'kbsync', group: 'İşçi', about: 'Bundan fazla commit birikirse tek işte birleştir (varsayılan 3)', secret: false, restart: ['worker'], pattern: INT},
  {key: 'MAX_ATTEMPTS', file: 'kbsync', group: 'İşçi', about: 'Bir iş kaç kez başarısız olunca sıra dursun (varsayılan 3)', secret: false, restart: ['worker'], pattern: INT},
  {key: 'CLAUDE_MAX_TURNS', file: 'kbsync', group: 'İşçi', about: 'Tek Claude çağrısının en fazla tur sayısı (varsayılan 80)', secret: false, restart: ['worker'], pattern: INT},
  {key: 'CLAUDE_TIMEOUT_MS', file: 'kbsync', group: 'İşçi', about: 'Tek Claude çağrısının üst süresi, ms (varsayılan 3600000)', secret: false, restart: ['worker'], pattern: INT},
  {key: 'GROUP_MAX_DOCS', file: 'kbsync', group: 'İşçi', about: 'Etki listesi bundan büyükse çağrı gruplara bölünür (varsayılan 40)', secret: false, restart: ['worker'], pattern: INT},
  {key: 'GIT_AUTHOR_NAME', file: 'kbsync', group: 'İşçi', about: 'Bilgi tabanı commit\'lerinin yazarı', secret: false, restart: ['worker'], required: true},
  {key: 'GIT_AUTHOR_EMAIL', file: 'kbsync', group: 'İşçi', about: 'Bilgi tabanı commit\'lerinin e-postası', secret: false, restart: ['worker'], required: true, pattern: /^\S+@\S+$/},

  // Sunucuda değiştirilir (panelden yalnız görünür)
  {key: 'POSTGRES_PASSWORD', file: 'env', group: 'Sunucuda değiştirilir', about: 'Postgres parolası; veritabanı ilk kurulurken kullanılır, sonradan değiştirmek veritabanında da değiştirmeyi gerektirir', secret: true, readOnly: true, restart: []},
  {key: 'REDIS_PASSWORD', file: 'env', group: 'Sunucuda değiştirilir', about: 'Redis parolası; bütün servisler birlikte değişmeli', secret: true, readOnly: true, restart: []},
  {key: 'CF_TUNNEL_TOKEN', file: 'env', group: 'Sunucuda değiştirilir', about: 'Cloudflare Tunnel token\'ı; yanlış değer paneli de dışarıdan kapatır', secret: true, readOnly: true, restart: []},
  {key: 'CF_ACCESS_TEAM_DOMAIN', file: 'env', group: 'Sunucuda değiştirilir', about: 'Cloudflare Access takım alanı (ör. nosurrender.cloudflareaccess.com); ayar yazmayı açar', secret: false, readOnly: true, restart: []},
  {key: 'CF_ACCESS_AUD', file: 'env', group: 'Sunucuda değiştirilir', about: 'Cloudflare Access uygulamasının AUD etiketi', secret: false, readOnly: true, restart: []},
  {key: 'FRONTEND_REPO', file: 'kbsync', group: 'Sunucuda değiştirilir', about: 'Uygulama reposu klonu (frontend alanı)', secret: false, readOnly: true, restart: []},
  {key: 'ENGINE_REPO', file: 'kbsync', group: 'Sunucuda değiştirilir', about: 'Maç motoru klonu (mac-motoru alanı)', secret: false, readOnly: true, restart: []},
];

export const settingByKey = (key: string) => SETTINGS.find(s => s.key === key);

/** Checks a requested change; returns an error message or null. */
export function validateChange(key: string, value: string | null): string | null {
  const def = settingByKey(key);
  if (!def) return `${key} panelden değiştirilebilen bir ayar değil`;
  if (def.readOnly) return `${key} yalnız sunucuda değiştirilir`;
  if (value === null || value === '') return def.required ? `${key} boş bırakılamaz` : null;
  if (/[\r\n]/.test(value)) return 'değer tek satır olmalı';
  if (value.length > 4096) return 'değer çok uzun';
  if (def.pattern && !def.pattern.test(value)) return `${key} için geçersiz biçim`;
  return null;
}

/** What the panel may show of a value: secrets only as "…abcd". */
export function displayValue(def: SettingDef, value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  if (!def.secret) return value;
  return value.length > 8 ? `…${value.slice(-4)}` : '••••';
}
