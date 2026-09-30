'use client';

import type {DailyTotal, Overview} from '@ai-knowledge-engine/accounts';
import {Card, Col, Descriptions, Row, Statistic} from 'antd';
import {DailyBars} from '@/components/daily-bars';

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'}) : '-');

export function OverviewView({o, days, meta}: {o: Overview; days: DailyTotal[]; meta: Record<string, string>}) {
  const stats: [string, number][] = [
    ['Etkin kullanıcı', o.users],
    ['Son 7 günde kullanan', o.activeUsers7d],
    ['Bugün çağrı', o.callsToday],
    ['7 günde çağrı', o.calls7d],
    ['30 günde çağrı', o.calls30d],
    ['7 günde sonuçsuz arama', o.emptySearches7d],
  ];
  return (
    <Row gutter={[16, 16]}>
      {stats.map(([title, value]) => (
        <Col key={title} xs={12} md={8} xl={4}>
          <Card>
            <Statistic title={title} value={value} />
          </Card>
        </Col>
      ))}
      <Col xs={24} xl={16}>
        <Card title="Son 30 gün, günlük çağrı">
          <DailyBars days={days} />
        </Card>
      </Col>
      <Col xs={24} xl={8}>
        <Card title="Arama indeksi">
          <Descriptions
            column={1}
            size="small"
            items={[
              {key: 'c', label: 'Bilgi tabanı commit', children: meta.commit?.slice(0, 8) ?? '-'},
              {key: 'p', label: 'Parça', children: meta.chunks ?? '-'},
              {key: 'm', label: 'Model', children: meta.model ?? '-'},
              {key: 'u', label: 'Güncellendi', children: fmt(meta.updated_at)},
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}
