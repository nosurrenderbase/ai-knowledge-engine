'use client';

import type {DailyTotal, Overview} from '@ai-knowledge-engine/accounts';
import {Card, Col, Descriptions, Row, Statistic, Table, Tag, Typography} from 'antd';
import {ENGINE_REPO} from '@/lib/areas';
import type {Versions} from '@/lib/versions';
import {DailyBars} from '@/components/daily-bars';

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'}) : '-');

const commit = (repo: string, sha: string | null) =>
  sha ? (
    <Typography.Link href={`https://github.com/${repo}/commit/${sha}`} target="_blank" code>
      {sha.slice(0, 8)}
    </Typography.Link>
  ) : (
    <Typography.Text type="secondary">bilinmiyor</Typography.Text>
  );

function VersionsCard({v}: {v: Versions}) {
  const live = v.live.sha;
  const rows = v.services.map(s => {
    let status = <Tag>bilinmiyor</Tag>;
    if (s.note) status = <Tag color="red">{s.note}</Tag>;
    else if (s.sha && live) status = s.sha === live ? <Tag color="green">güncel</Tag> : <Tag color="orange">canlı commit'ten farklı</Tag>;
    else if (s.sha) status = <Tag color="green">çalışıyor</Tag>;
    return {...s, status};
  });
  return (
    <Card title="Sürümler">
      <Descriptions
        column={{xs: 1, md: 3}}
        size="small"
        items={[
          {key: 'live', label: 'Canlı commit (deploy)', children: commit(ENGINE_REPO, live)},
          {key: 'at', label: 'Deploy zamanı', children: fmt(v.live.at ?? undefined)},
          {key: 'prev', label: 'Önceki', children: commit(ENGINE_REPO, v.live.previous)},
          ...(v.failedSha ? [{key: 'f', label: 'Deploy edilemeyen', children: <>{commit(ENGINE_REPO, v.failedSha)} <Tag color="red">test ya da sağlık kontrolü</Tag></>}] : []),
          {
            key: 'busy',
            label: 'İşçi şu an',
            children: v.busy ? <Tag color="processing">{`${v.busy.area} ${v.busy.head.slice(0, 8)} işleniyor (${fmt(v.busy.since)}'den beri)`}</Tag> : <Tag>boşta</Tag>,
          },
          ...(v.pendingWorker ? [{key: 'p', label: 'Bekleyen', children: <Tag color="orange">işçi, süren iş bitince yeni sürümle başlayacak</Tag>}] : []),
        ]}
      />
      <Table
        style={{marginTop: 12}}
        size="small"
        pagination={false}
        rowKey="name"
        dataSource={rows}
        columns={[
          {title: 'Servis', dataIndex: 'name'},
          {title: 'Çalışan commit', dataIndex: 'sha', render: (sha: string | null) => commit(ENGINE_REPO, sha)},
          {title: 'Başlama', dataIndex: 'since', render: (s?: string | null) => fmt(s ?? undefined)},
          {title: 'Durum', dataIndex: 'status'},
        ]}
      />
      <Table
        style={{marginTop: 12}}
        size="small"
        pagination={false}
        rowKey="area"
        dataSource={v.areas}
        columns={[
          {title: 'Bilgi tabanı alanı', dataIndex: 'area'},
          {title: 'İşlenen son kod commit', dataIndex: 'sourceCommit', render: (sha: string | null, r) => commit(r.repo, sha)},
          {title: 'Kod reposu', dataIndex: 'repo'},
        ]}
      />
    </Card>
  );
}

export function OverviewView({o, days, indexes, versions}: {o: Overview; days: DailyTotal[]; indexes: Record<string, string>[]; versions: Versions}) {
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
      <Col xs={24}>
        <VersionsCard v={versions} />
      </Col>
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
        <Card title="Arama indeksleri">
          {indexes.map(meta => (
            <Descriptions
              key={meta.area}
              title={meta.area}
              column={1}
              size="small"
              style={{marginBottom: 12}}
              items={[
                {key: 'c', label: 'Bilgi tabanı commit', children: meta.commit?.slice(0, 8) ?? 'henüz yok'},
                {key: 'p', label: 'Parça', children: meta.chunks ?? '-'},
                {key: 'u', label: 'Güncellendi', children: fmt(meta.updated_at)},
              ]}
            />
          ))}
        </Card>
      </Col>
    </Row>
  );
}
