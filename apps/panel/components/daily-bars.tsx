'use client';

import {Tooltip, Typography} from 'antd';
import type {DailyTotal} from '@ai-knowledge-engine/accounts';

/** Calls per day as plain bars; enough for a handful of users. */
export function DailyBars({days}: {days: DailyTotal[]}) {
  const max = Math.max(1, ...days.map(d => d.calls));
  return (
    <div>
      <div style={{display: 'flex', alignItems: 'flex-end', gap: 4, height: 160, padding: '8px 0'}}>
        {days.map(d => (
          <Tooltip key={d.day} title={`${d.day}: ${d.calls} çağrı${d.errors ? `, ${d.errors} hata` : ''}`}>
            <div style={{flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%'}}>
              <div
                style={{
                  height: `${(d.calls / max) * 100}%`,
                  minHeight: d.calls ? 3 : 0,
                  background: d.errors ? 'linear-gradient(180deg, #fbbf24, rgba(251,191,36,0.35))' : 'linear-gradient(180deg, #22d3ee, rgba(139,92,246,0.55))',
                  borderRadius: 4,
                  boxShadow: d.calls ? '0 0 12px rgba(139,92,246,0.25)' : undefined,
                }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 8}}>
        <Typography.Text type="secondary" className="kb-mono" style={{fontSize: 12}}>{days[0]?.day}</Typography.Text>
        <Typography.Text type="secondary" className="kb-mono" style={{fontSize: 12}}>{days.at(-1)?.day}</Typography.Text>
      </div>
    </div>
  );
}
