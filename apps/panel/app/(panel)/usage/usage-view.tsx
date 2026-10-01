'use client';

import type {DailyTotal} from '@ai-knowledge-engine/accounts';
import {Card, Col, Empty, Row, Tooltip} from 'antd';
import {AreaChart} from '@/components/area-chart';
import {StatTile} from '@/components/ui';

export interface UsageRow {
  key: number;
  name: string;
  total: number;
  errors: number;
  tools: Record<string, number>;
}

/** Calm, distinguishable tool colours (Apple system palette). */
const PALETTE = ['#0a84ff', '#5e5ce6', '#30d158', '#ff9f0a', '#64d2ff', '#bf5af2', '#ff375f', '#ffd60a', '#ac8e68', '#8e8e93'];
const AVATAR = ['#0a84ff', '#5e5ce6', '#30d158', '#ff9f0a', '#bf5af2', '#ff375f', '#64d2ff'];

export function UsageView({days, daily, rows}: {days: number; daily: DailyTotal[]; rows: UsageRow[]}) {
  const n = (x: number) => x.toLocaleString('tr-TR');
  const toolTotals = new Map<string, number>();
  for (const r of rows) for (const [t, c] of Object.entries(r.tools)) toolTotals.set(t, (toolTotals.get(t) ?? 0) + c);
  const tools = [...toolTotals.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const color = (t: string) => PALETTE[tools.indexOf(t) % PALETTE.length];
  const total = rows.reduce((s, r) => s + r.total, 0);
  const errors = rows.reduce((s, r) => s + r.errors, 0);
  const top = tools[0];

  const tiles = [
    {label: 'Toplam çağrı', value: n(total), sub: `son ${days} gün`},
    {label: 'Kullanan kişi', value: n(rows.length), sub: `son ${days} gün`},
    {label: 'Hata oranı', value: total ? `%${((errors / total) * 100).toLocaleString('tr-TR', {maximumFractionDigits: 1})}` : '—', sub: `${n(errors)} hatalı çağrı`},
    {label: 'En çok kullanılan', value: top ?? '—', sub: top ? `${n(toolTotals.get(top)!)} çağrı` : ''},
  ];

  return (
    <Row gutter={[18, 18]}>
      {tiles.map(t => (
        <Col key={t.label} xs={12} lg={6}>
          <Card>
            <StatTile label={t.label} value={t.value} />
            <div className="kb-meta" style={{marginTop: 4}}>
              {t.sub}
            </div>
          </Card>
        </Col>
      ))}
      <Col xs={24}>
        <Card title="Günlük çağrı" extra={<span className="kb-meta">son {days} gün</span>}>
          <AreaChart points={daily.map(d => ({label: d.day, value: d.calls, errors: d.errors}))} height={200} />
          <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 10}}>
            <span className="kb-meta kb-mono">{daily[0]?.day}</span>
            <span className="kb-meta kb-mono">{daily.at(-1)?.day}</span>
          </div>
        </Card>
      </Col>
      <Col xs={24}>
        <Card
          title="Kişiler"
          extra={
            <div style={{display: 'flex', flexWrap: 'wrap', gap: 12}}>
              {tools.map(t => (
                <span key={t} className="kb-meta" style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
                  <span className="kb-status-dot" style={{background: color(t)}} />
                  {t}
                </span>
              ))}
            </div>
          }
        >
          {rows.length === 0 && <Empty description="Bu aralıkta kullanım yok" />}
          {rows.map((r, i) => (
            <div key={r.key} className="kb-row">
              <div className="kb-avatar" style={{background: AVATAR[i % AVATAR.length]}}>
                {r.name
                  .split(/\s+/)
                  .map(w => w[0])
                  .slice(0, 2)
                  .join('')
                  .toLocaleUpperCase('tr')}
              </div>
              <div style={{width: 200, minWidth: 0}}>
                <div style={{fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{r.name}</div>
                <div className="kb-meta">
                  {n(r.total)} çağrı{r.errors ? ` · ${n(r.errors)} hata` : ''}
                </div>
              </div>
              <div style={{flex: 1}}>
                <div className="kb-seg" style={{width: `${Math.max(4, (r.total / Math.max(1, rows[0].total)) * 100)}%`}}>
                  {tools
                    .filter(t => r.tools[t])
                    .map((t, j) => (
                      <Tooltip key={t} title={`${t}: ${n(r.tools[t])}`}>
                        <span style={{width: `${(r.tools[t] / r.total) * 100}%`, background: color(t), animationDelay: `${0.05 * i + 0.03 * j}s`}} />
                      </Tooltip>
                    ))}
                </div>
              </div>
            </div>
          ))}
        </Card>
      </Col>
    </Row>
  );
}
