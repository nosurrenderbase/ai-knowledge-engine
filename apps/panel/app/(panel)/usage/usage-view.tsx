'use client';

import type {DailyTotal} from '@ai-knowledge-engine/accounts';
import {Card, Space, Table} from 'antd';
import {DailyBars} from '@/components/daily-bars';

export const TOOLS = ['search', 'read_doc', 'grep', 'list_docs'];

export interface UsageRow {
  key: number;
  name: string;
  total: number;
  errors: number;
  tools: Record<string, number>;
}

export function UsageView({days, daily, rows}: {days: number; daily: DailyTotal[]; rows: UsageRow[]}) {
  return (
    <Space direction="vertical" size="large" style={{width: '100%'}}>
      <Card title={`Günlük çağrı (son ${days} gün)`}>
        <DailyBars days={daily} />
      </Card>
      <Card title="Kişi ve araç bazında">
        <Table<UsageRow>
          dataSource={rows}
          pagination={false}
          columns={[
            {title: 'Kullanıcı', dataIndex: 'name'},
            ...TOOLS.map(t => ({title: t, key: t, render: (_: unknown, r: UsageRow) => r.tools[t] ?? 0})),
            {title: 'Toplam', dataIndex: 'total'},
            {title: 'Hata', dataIndex: 'errors'},
          ]}
        />
      </Card>
    </Space>
  );
}
