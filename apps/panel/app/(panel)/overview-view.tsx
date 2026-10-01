'use client';

import {CheckCircleFilled, ExclamationCircleFilled, LoadingOutlined} from '@ant-design/icons';
import type {DailyTotal, Overview} from '@ai-knowledge-engine/accounts';
import {Card, Col, Row, Tooltip, Typography} from 'antd';
import {AreaChart} from '@/components/area-chart';
import {ago, fullDate} from '@/components/time';
import {StatTile} from '@/components/ui';
import {AREA_REPOS, ENGINE_REPO} from '@/lib/areas';
import type {ServiceVersion, Versions} from '@/lib/versions';

const COLORS = {ok: '#30d158', warn: '#ff9f0a', bad: '#ff453a', idle: '#8e8e93'};
type Level = keyof typeof COLORS;

const Sha = ({repo, sha}: {repo: string; sha: string | null}) =>
  sha ? (
    <Typography.Link href={`https://github.com/${repo}/commit/${sha}`} target="_blank" className="kb-mono" style={{fontSize: 12}}>
      {sha.slice(0, 7)}
    </Typography.Link>
  ) : (
    <span className="kb-meta">—</span>
  );

function serviceLevel(s: ServiceVersion): {level: Level; text: string} {
  if (s.note || !s.sha) return {level: 'bad', text: s.note ?? 'sürüm bilinmiyor'};
  if (s.expected && s.sha !== s.expected) return {level: 'warn', text: `${s.expected.slice(0, 7)} bekleniyor`};
  return {level: 'ok', text: s.since ? `${ago(s.since)} başladı` : 'çalışıyor'};
}

function StatusHero({v}: {v: Versions}) {
  const services = v.services.map(s => ({...s, ...serviceLevel(s)}));
  const bad = services.filter(s => s.level === 'bad');
  const warn = services.filter(s => s.level === 'warn');
  let level: Level = 'ok';
  let headline = 'Her şey güncel';
  if (bad.length) [level, headline] = ['bad', `${bad.map(s => s.name).join(', ')} yanıt vermiyor`];
  else if (v.pendingWorker) [level, headline] = ['warn', 'İşçi, süren iş bitince yeni sürüme geçecek'];
  else if (warn.length) [level, headline] = ['warn', `${warn.length} servis eski sürümde`];
  else if (v.failedSha) [level, headline] = ['warn', 'Son commit canlıya alınamadı'];

  const Icon = level === 'ok' ? CheckCircleFilled : ExclamationCircleFilled;
  return (
    <Card styles={{body: {padding: 28}}}>
      <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 28, justifyContent: 'space-between'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 18, minWidth: 320}}>
          <Icon style={{fontSize: 40, color: COLORS[level]}} />
          <div>
            <div style={{fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em'}}>{headline}</div>
            <div className="kb-meta" style={{fontSize: 13, marginTop: 4}}>
              Canlı sürüm <Sha repo={ENGINE_REPO} sha={v.live.sha} />
              {v.live.at && (
                <Tooltip title={fullDate(v.live.at)}>
                  <span> · {ago(v.live.at)} deploy edildi</span>
                </Tooltip>
              )}
              {v.failedSha && (
                <>
                  {' '}
                  · canlıya alınamayan <Sha repo={ENGINE_REPO} sha={v.failedSha} />
                </>
              )}
            </div>
          </div>
        </div>
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 10}}>
          {services.map(s => (
            <div key={s.name} className="kb-pill">
              <span className="kb-status-dot" style={{background: COLORS[s.level]}} />
              <div style={{lineHeight: 1.3}}>
                <div style={{fontWeight: 600, fontSize: 13}}>
                  {s.name} <Sha repo={ENGINE_REPO} sha={s.sha} />
                </div>
                <div className="kb-meta">{s.text}</div>
              </div>
            </div>
          ))}
          <div className="kb-pill">
            {v.busy ? <LoadingOutlined style={{color: '#0a84ff'}} /> : <span className="kb-status-dot" style={{background: COLORS.idle}} />}
            <div style={{lineHeight: 1.3}}>
              <div style={{fontWeight: 600, fontSize: 13}}>Senkron</div>
              <div className="kb-meta">{v.busy ? `${v.busy.area} işleniyor · ${ago(v.busy.since)}` : 'boşta'}</div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function KnowledgeCard({v, indexes}: {v: Versions; indexes: Record<string, string>[]}) {
  return (
    <Card title="Bilgi tabanı" style={{height: '100%'}}>
      {v.areas.map(a => {
        const meta = indexes.find(m => m.area === a.area) ?? {};
        return (
          <div key={a.area} className="kb-row">
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{fontWeight: 600}}>{a.area}</div>
              <div className="kb-meta" style={{marginTop: 2}}>
                kod <Sha repo={AREA_REPOS[a.area as keyof typeof AREA_REPOS] ?? a.repo} sha={a.sourceCommit} />
                {meta.chunks ? ` · ${Number(meta.chunks).toLocaleString('tr-TR')} parça` : ''}
              </div>
            </div>
            <Tooltip title={meta.updated_at ? `İndeks: ${fullDate(meta.updated_at)}` : 'henüz indekslenmedi'}>
              <span className="kb-meta">{meta.updated_at ? ago(meta.updated_at) : '—'}</span>
            </Tooltip>
          </div>
        );
      })}
    </Card>
  );
}

export function OverviewView({o, days, indexes, versions}: {o: Overview; days: DailyTotal[]; indexes: Record<string, string>[]; versions: Versions}) {
  const n = (x: number) => x.toLocaleString('tr-TR');
  const tiles: {label: string; value: string; sub: string}[] = [
    {label: 'Bugün', value: n(o.callsToday), sub: 'çağrı'},
    {label: 'Son 7 gün', value: n(o.calls7d), sub: `çağrı · 30 günde ${n(o.calls30d)}`},
    {label: 'Aktif kişi', value: `${o.activeUsers7d}/${o.users}`, sub: 'son 7 günde kullanan'},
    {label: 'Sonuçsuz arama', value: n(o.emptySearches7d), sub: o.emptySearches7d ? 'son 7 gün · Sorular sayfasında' : 'son 7 gün'},
  ];
  return (
    <Row gutter={[18, 18]}>
      <Col xs={24}>
        <StatusHero v={versions} />
      </Col>
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
      <Col xs={24} xl={16}>
        <Card title="Kullanım" extra={<span className="kb-meta">son 30 gün</span>} style={{height: '100%'}}>
          <AreaChart points={days.map(d => ({label: d.day, value: d.calls, errors: d.errors}))} height={200} />
          <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 10}}>
            <span className="kb-meta kb-mono">{days[0]?.day}</span>
            <span className="kb-meta kb-mono">{days.at(-1)?.day}</span>
          </div>
        </Card>
      </Col>
      <Col xs={24} xl={8}>
        <KnowledgeCard v={versions} indexes={indexes} />
      </Col>
    </Row>
  );
}
