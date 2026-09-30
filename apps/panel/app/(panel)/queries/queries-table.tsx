'use client';

import {Table, Tag, Typography} from 'antd';

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

export function QueriesTable({rows}: {rows: QueryView[]}) {
  return (
    <Table<QueryView>
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
