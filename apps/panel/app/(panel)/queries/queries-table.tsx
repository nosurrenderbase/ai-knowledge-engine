'use client';

import {Card, Empty, Grid, Pagination, Table, Tag, Typography} from 'antd';
import {useState} from 'react';
import {ago, fullDate} from '@/components/time';

export interface QueryView {
  key: number;
  at: string;
  name: string | null;
  tool: string;
  asked: string;
  filters: string;
  count: number | null;
  paths: string[];
  durationMs: number;
  error: string | null;
}

const PAGE = 30;

/** Phones: one calm row per call (who · tool · when, then what was asked and what came back). */
function QueriesList({rows}: {rows: QueryView[]}) {
  const [page, setPage] = useState(1);
  if (!rows.length) return <Empty description="Bu filtrelerle soru yok" />;
  return (
    <>
      {rows.slice((page - 1) * PAGE, page * PAGE).map(r => (
        <div key={r.key} className="kb-row" style={{alignItems: 'flex-start'}}>
          <span className="kb-status-dot" style={{marginTop: 7, background: r.error ? '#ff453a' : r.count === 0 ? '#ff9f0a' : '#0a84ff'}} />
          <div style={{flex: 1, minWidth: 0}}>
            <div style={{display: 'flex', justifyContent: 'space-between', gap: 8}}>
              <span style={{fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                {r.name ?? '?'} <span className="kb-meta">· {r.tool}</span>
              </span>
              <span className="kb-meta" style={{whiteSpace: 'nowrap'}} title={fullDate(r.at)}>
                {ago(r.at)}
              </span>
            </div>
            <div style={{marginTop: 4, wordBreak: 'break-word'}}>
              {r.asked || '—'}
              {r.filters && <span className="kb-meta"> {r.filters}</span>}
            </div>
            <div className="kb-meta" style={{marginTop: 4, wordBreak: 'break-all'}}>
              {r.error ? `hata: ${r.error}` : `${r.count ?? '-'} sonuç${r.paths.length ? ` · ${r.paths.slice(0, 2).join(', ')}${r.paths.length > 2 ? ` +${r.paths.length - 2}` : ''}` : ''}`} · {r.durationMs} ms
            </div>
          </div>
        </div>
      ))}
      {rows.length > PAGE && (
        <div style={{display: 'flex', justifyContent: 'center', marginTop: 16}}>
          <Pagination simple current={page} pageSize={PAGE} total={rows.length} onChange={setPage} />
        </div>
      )}
    </>
  );
}

export function QueriesTable({rows}: {rows: QueryView[]}) {
  const screens = Grid.useBreakpoint();
  return <Card>{screens.md === false ? <QueriesList rows={rows} /> : <QueriesGrid rows={rows} />}</Card>;
}

function QueriesGrid({rows}: {rows: QueryView[]}) {
  return (
    <Table<QueryView>
      scroll={{x: 'max-content'}}
      dataSource={rows}
      size="small"
      pagination={{pageSize: 50, showSizeChanger: false}}
      columns={[
        {title: 'Zaman', dataIndex: 'at', width: 170, render: (iso: string) => new Date(iso).toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'})},
        {title: 'Kullanıcı', dataIndex: 'name', width: 160, render: n => n ?? '?'},
        {title: 'Araç', dataIndex: 'tool', width: 100, render: t => <Tag>{t}</Tag>},
        {
          title: 'Soru / ifade',
          dataIndex: 'asked',
          render: (a: string, r) => (
            <>
              {a}
              {r.filters && <Typography.Text type="secondary"> {r.filters}</Typography.Text>}
            </>
          ),
        },
        {
          title: 'Sonuç',
          dataIndex: 'count',
          width: 90,
          render: (c: number | null, r) => (r.error ? <Tag color="orange">hata</Tag> : c === 0 ? <Tag color="red">0</Tag> : (c ?? '-')),
        },
        {
          title: 'Bulunan dokümanlar',
          dataIndex: 'paths',
          render: (p: string[], r) => (r.error ? <Typography.Text type="warning">{r.error}</Typography.Text> : p.map(x => <div key={x}>{x}</div>)),
        },
        {title: 'Süre', dataIndex: 'durationMs', width: 80, render: (ms: number) => `${ms} ms`},
      ]}
    />
  );
}
