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
                className="kb-bar"
                style={{
                  height: `${(d.calls / max) * 100}%`,
                  minHeight: d.calls ? 3 : 0,
                  background: d.errors ? '#ff9f0a' : '#0a84ff',
                  opacity: d.errors ? 1 : 0.85,
                  borderRadius: 6,
                }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', borderTop: '0.5px solid rgba(15,23,42,0.08)', paddingTop: 8}}>
        <Typography.Text type="secondary" className="kb-mono" style={{fontSize: 12}}>{days[0]?.day}</Typography.Text>
        <Typography.Text type="secondary" className="kb-mono" style={{fontSize: 12}}>{days.at(-1)?.day}</Typography.Text>
      </div>
    </div>
  );
}
