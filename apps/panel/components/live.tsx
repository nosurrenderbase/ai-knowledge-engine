'use client';

import {Card, Empty, Tooltip} from 'antd';
import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import type {LiveEvent, LiveState} from '@/lib/live';
import {ago, fullDate} from './time';

const LiveContext = createContext<LiveState>({callsToday: 0, events: []});
export const useLive = () => useContext(LiveContext);

/** Event name the backdrop listens to: "something just happened". */
export const PULSE_EVENT = 'kb:pulse';

/**
 * Polls /api/live every few seconds while the tab is visible. When a call
 * arrives the feed slides it in, the counters update and the backdrop breathes once.
 */
export function LiveProvider({initial, children, everyMs = 4000}: {initial: LiveState; children: ReactNode; everyMs?: number}) {
  const [state, setState] = useState(initial);
  const latest = useRef(initial.events[0]?.id);
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/live', {cache: 'no-store'});
        if (!res.ok || stopped) return;
        const next = (await res.json()) as LiveState;
        if (next.events[0]?.id !== latest.current) {
          latest.current = next.events[0]?.id;
          window.dispatchEvent(new Event(PULSE_EVENT));
        }
        setState(next);
      } catch {
        // offline for a moment: try again on the next tick
      }
    };
    const timer = setInterval(tick, everyMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [everyMs]);
  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

/** A number that rises in again whenever it changes. */
export function LiveNumber({value}: {value: number}) {
  return (
    <span key={value} className="kb-tick">
      {value.toLocaleString('tr-TR')}
    </span>
  );
}

const TOOL_LABEL: Record<string, string> = {
  search: 'arama',
  read_doc: 'doküman',
  grep: 'metin arama',
  list_docs: 'liste',
  find_team: 'takım bul',
  team_overview: 'takım',
  match_detail: 'maç',
  league_table: 'lig tablosu',
  db_find: 'veritabanı',
  db_count: 'veritabanı',
  db_aggregate: 'veritabanı',
  db_fields: 'veritabanı',
  db_collections: 'veritabanı',
};

function Row({e, fresh}: {e: LiveEvent; fresh: boolean}) {
  return (
    <div className={`kb-row kb-live-row${fresh ? ' kb-enter' : ''}`}>
      <span className="kb-status-dot" style={{background: e.error ? '#ff453a' : e.tool.startsWith('db_') || TOOL_LABEL[e.tool] === 'takım' ? '#5e5ce6' : '#0a84ff'}} />
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
          <span style={{fontWeight: 600}}>{e.name}</span>
          <span className="kb-meta"> · {TOOL_LABEL[e.tool] ?? e.tool}</span>
        </div>
        <div className="kb-meta" style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2}}>
          {e.text || '—'}
          {e.count !== null && ` · ${e.count} sonuç`}
          {e.error && ' · hata'}
        </div>
      </div>
      <Tooltip title={`${fullDate(e.at)} · ${e.ms} ms`}>
        <span className="kb-meta" style={{whiteSpace: 'nowrap'}}>
          {ago(e.at)}
        </span>
      </Tooltip>
    </div>
  );
}

export function LiveFeed() {
  const {events} = useLive();
  const seen = useRef<Set<string> | null>(null);
  const [, setNow] = useState(0);
  // Relative times stay fresh even when nothing new arrives.
  useEffect(() => {
    const t = setInterval(() => setNow(n => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  const first = seen.current === null;
  const fresh = new Set(first ? [] : events.filter(e => !seen.current!.has(e.id)).map(e => e.id));
  useEffect(() => {
    seen.current = new Set(events.map(e => e.id));
  }, [events]);
  return (
    <Card
      title={
        <span style={{display: 'inline-flex', alignItems: 'center'}}>
          <span className="kb-dot" />
          Canlı
        </span>
      }
      extra={<span className="kb-meta">MCP çağrıları</span>}
      style={{height: '100%'}}
    >
      {events.length === 0 ? <Empty description="Henüz çağrı yok" /> : events.map(e => <Row key={e.id} e={e} fresh={fresh.has(e.id)} />)}
    </Card>
  );
}

/** Lets the backdrop breathe once per pulse (mounted once, in the root layout). */
export function BackdropPulse() {
  useEffect(() => {
    const el = document.querySelector('.kb-backdrop');
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const pulse = () => {
      el.classList.remove('kb-breath');
      void (el as HTMLElement).offsetWidth;
      el.classList.add('kb-breath');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('kb-breath'), 1800);
    };
    window.addEventListener(PULSE_EVENT, pulse);
    return () => window.removeEventListener(PULSE_EVENT, pulse);
  }, []);
  return null;
}
