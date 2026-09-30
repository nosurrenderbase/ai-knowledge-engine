'use client';

import type {SearchHit} from '@ai-knowledge-engine/search';
import {App, Button, Card, Checkbox, Drawer, Form, Input, InputNumber, List, Space, Tag, Typography} from 'antd';
import {useState, useTransition} from 'react';
import {readDoc, runSearch} from './actions';

export function SearchConsole() {
  const {message} = App.useApp();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{hits: SearchHit[]; ms: number} | null>(null);
  const [doc, setDoc] = useState<{path: string; text: string} | null>(null);

  const onSearch = (v: {query: string; module?: string; kind?: string; includeRemoved?: boolean; limit?: number}) =>
    start(async () => {
      const res = await runSearch(v);
      if (!res.ok) return void message.error(res.error);
      setResult(res);
    });

  const open = (path: string) =>
    start(async () => {
      const text = await readDoc(path);
      if (text === null) return void message.error('Doküman bulunamadı');
      setDoc({path, text});
    });

  return (
    <Space direction="vertical" style={{width: '100%'}} size="large">
      <Card>
        <Form layout="inline" onFinish={onSearch} initialValues={{limit: 10}}>
          <Form.Item name="query" rules={[{required: true, message: 'Soru yaz'}]} style={{flex: 1, minWidth: 300}}>
            <Input placeholder="ör. davet edene ne kadar para veriyoruz" allowClear />
          </Form.Item>
          <Form.Item name="module">
            <Input placeholder="modül (ör. pvp-match)" style={{width: 170}} allowClear />
          </Form.Item>
          <Form.Item name="kind">
            <Input placeholder="tür (flow, module…)" style={{width: 150}} allowClear />
          </Form.Item>
          <Form.Item name="limit">
            <InputNumber min={1} max={20} style={{width: 70}} />
          </Form.Item>
          <Form.Item name="includeRemoved" valuePropName="checked">
            <Checkbox>kaldırılanlar da</Checkbox>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={pending}>
            Ara
          </Button>
        </Form>
      </Card>

      {result && (
        <Card title={`${result.hits.length} sonuç, ${result.ms} ms`}>
          <List
            dataSource={result.hits}
            renderItem={(h, i) => (
              <List.Item style={{cursor: 'pointer'}} onClick={() => open(h.path)}>
                <List.Item.Meta
                  title={
                    <Space wrap>
                      <span>
                        {i + 1}. {h.title}
                      </span>
                      <Typography.Text code>{h.path}</Typography.Text>
                      {h.section && <Typography.Text type="secondary">› {h.section}</Typography.Text>}
                      {h.status && <Tag color={h.status === 'kaldırıldı' ? 'red' : 'blue'}>{h.status}</Tag>}
                      <Tag>skor {h.score}</Tag>
                    </Space>
                  }
                  description={h.text.replace(/\s+/g, ' ').slice(0, 350)}
                />
              </List.Item>
            )}
          />
        </Card>
      )}

      <Drawer title={doc?.path} open={Boolean(doc)} onClose={() => setDoc(null)} size="large">
        <pre style={{whiteSpace: 'pre-wrap', fontSize: 13, margin: 0}}>{doc?.text}</pre>
      </Drawer>
    </Space>
  );
}
