'use client';

import {Tooltip, Typography} from 'antd';
import type {DailyTotal} from '@ai-knowledge-engine/accounts';

/** Calls per day as plain bars; enough for a handful of users. */
export function DailyBars({days}: {days: DailyTotal[]}) {
  const max = Math.max(1, ...days.map(d => d.calls));
  return (
    <div>
      <div style={{display: 'flex', alignItems: 'flex-end', gap: 3, height: 140}}>
        {days.map(d => (
          <Tooltip key={d.day} title={`${d.day}: ${d.calls} çağrı${d.errors ? `, ${d.errors} hata` : ''}`}>
            <div style={{flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%'}}>
              <div style={{height: `${(d.calls / max) * 100}%`, minHeight: d.calls ? 2 : 0, background: d.errors ? '#faad14' : '#1677ff', borderRadius: 2}} />
            </div>
          </Tooltip>
        ))}
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between'}}>
        <Typography.Text type="secondary">{days[0]?.day}</Typography.Text>
        <Typography.Text type="secondary">{days.at(-1)?.day}</Typography.Text>
      </div>
    </div>
  );
}
