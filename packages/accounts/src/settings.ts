import type {Db} from './db.ts';

export type ChangeKind = 'set' | 'unset' | 'restart';
export type ChangeStatus = 'pending' | 'applied' | 'failed';

export interface SettingsChange {
  id: number;
  createdAt: Date;
  requestedBy: string;
  kind: ChangeKind;
  key: string | null;
  target: string | null;
  /** Only for pending rows; erased when the change is applied or fails. */
  sealedValue: string | null;
  valueHint: string | null;
  status: ChangeStatus;
  appliedAt: Date | null;
  error: string | null;
}

const toChange = (r: Record<string, unknown>): SettingsChange => ({
  id: Number(r.id),
  createdAt: r.created_at as Date,
  requestedBy: r.requested_by as string,
  kind: r.kind as ChangeKind,
  key: (r.key as string) ?? null,
  target: (r.target as string) ?? null,
  sealedValue: (r.sealed_value as string) ?? null,
  valueHint: (r.value_hint as string) ?? null,
  status: r.status as ChangeStatus,
  appliedAt: (r.applied_at as Date) ?? null,
  error: (r.error as string) ?? null,
});

export async function requestChange(
  db: Db,
  c: {requestedBy: string; kind: ChangeKind; key?: string; target?: string; sealedValue?: string; valueHint?: string},
): Promise<number> {
  const {rows} = await db.query(
    'insert into settings_changes (requested_by, kind, key, target, sealed_value, value_hint) values ($1, $2, $3, $4, $5, $6) returning id',
    [c.requestedBy, c.kind, c.key ?? null, c.target ?? null, c.sealedValue ?? null, c.valueHint ?? null],
  );
  return Number(rows[0].id);
}

/** Pending changes in request order (the deploy agent applies them one by one). */
export async function pendingChanges(db: Db): Promise<SettingsChange[]> {
  const {rows} = await db.query(`select * from settings_changes where status = 'pending' order by id`);
  return rows.map(toChange);
}

/** Marks a change done; the sealed value is erased either way. */
export async function finishChange(db: Db, id: number, error: string | null): Promise<void> {
  await db.query(`update settings_changes set status = $2, applied_at = now(), error = $3, sealed_value = null where id = $1`, [id, error ? 'failed' : 'applied', error]);
}

/** Recent changes for the panel (never the sealed value). */
export async function recentChanges(db: Db, limit = 30): Promise<SettingsChange[]> {
  const {rows} = await db.query('select * from settings_changes order by id desc limit $1', [limit]);
  return rows.map(r => ({...toChange(r), sealedValue: null}));
}
