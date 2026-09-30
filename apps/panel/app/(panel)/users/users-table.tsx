'use client';

import {PlusOutlined} from '@ant-design/icons';
import {App, Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography} from 'antd';
import {useRouter} from 'next/navigation';
import {useState, useTransition} from 'react';
import {createToken, createUser, revoke, setDisabled, type Result} from './actions';

export interface TokenView {
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface UserView {
  id: number;
  name: string;
  email: string | null;
  note: string | null;
  disabled: boolean;
  activeTokens: number;
  lastUsedAt: string | null;
  calls30d: number;
  tokens: TokenView[];
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'}) : '-');

export function UsersTable({users}: {users: UserView[]}) {
  const {message} = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<{name: string; token: string} | null>(null);
  const [form] = Form.useForm();

  const act = (fn: () => Promise<Result>, ok: string, name?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void message.error(res.error);
      if (res.token && name) setShown({name, token: res.token});
      else message.success(ok);
      router.refresh();
    });

  return (
    <>
      <Space style={{marginBottom: 16}}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          Yeni kullanıcı
        </Button>
      </Space>
      <Table<UserView>
        rowKey="id"
        dataSource={users}
        pagination={false}
        loading={pending}
        expandable={{
          expandedRowRender: u => (
            <Table<TokenView>
              rowKey="prefix"
              size="small"
              pagination={false}
              dataSource={u.tokens}
              columns={[
                {title: 'Token öneki', dataIndex: 'prefix', render: p => <Typography.Text code>kb_{p}_…</Typography.Text>},
                {title: 'Etiket', dataIndex: 'label', render: l => l ?? '-'},
                {title: 'Oluşturma', dataIndex: 'createdAt', render: fmt},
                {title: 'Son kullanım', dataIndex: 'lastUsedAt', render: fmt},
                {
                  title: 'Durum',
                  render: (_, t) =>
                    t.revokedAt ? (
                      <Tag>iptal {fmt(t.revokedAt)}</Tag>
                    ) : (
                      <Popconfirm title="Bu token iptal edilsin mi?" onConfirm={() => act(() => revoke(t.prefix), 'Token iptal edildi')}>
                        <Button size="small" danger>
                          İptal et
                        </Button>
                      </Popconfirm>
                    ),
                },
              ]}
            />
          ),
        }}
        columns={[
          {title: 'Ad', dataIndex: 'name', render: (n, u) => (u.note ? `${n} (${u.note})` : n)},
          {title: 'E-posta', dataIndex: 'email', render: e => e ?? '-'},
          {title: 'Aktif token', dataIndex: 'activeTokens'},
          {title: 'Son kullanım', dataIndex: 'lastUsedAt', render: fmt},
          {title: '30 günde çağrı', dataIndex: 'calls30d'},
          {title: 'Durum', dataIndex: 'disabled', render: d => (d ? <Tag color="red">devre dışı</Tag> : <Tag color="green">etkin</Tag>)},
          {
            title: '',
            render: (_, u) => (
              <Space>
                <Button size="small" onClick={() => act(() => createToken(u.id), 'Token üretildi', u.name)}>
                  Yeni token
                </Button>
                <Popconfirm
                  title={u.disabled ? 'Erişim açılsın mı?' : 'Tüm erişimi kapatılsın mı?'}
                  onConfirm={() => act(() => setDisabled(u.id, !u.disabled), u.disabled ? 'Etkinleştirildi' : 'Devre dışı bırakıldı')}
                >
                  <Button size="small" danger={!u.disabled}>
                    {u.disabled ? 'Etkinleştir' : 'Devre dışı bırak'}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="Yeni kullanıcı"
        open={adding}
        okText="Ekle ve token üret"
        confirmLoading={pending}
        onCancel={() => setAdding(false)}
        onOk={() =>
          form.validateFields().then(v =>
            act(async () => {
              const res = await createUser(v);
              if (res.ok) {
                setAdding(false);
                form.resetFields();
              }
              return res;
            }, 'Eklendi', v.name),
          )
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Ad soyad" rules={[{required: true, message: 'Ad gerekli'}]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="E-posta" rules={[{type: 'email', message: 'Geçerli bir e-posta yaz'}]}>
            <Input />
          </Form.Item>
          <Form.Item name="note" label="Not (ör. PM, patron)">
            <Input />
          </Form.Item>
          <Form.Item name="label" label="Token etiketi (ör. laptop)">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`${shown?.name ?? ''} için token`} open={Boolean(shown)} onOk={() => setShown(null)} onCancel={() => setShown(null)} cancelButtonProps={{style: {display: 'none'}}}>
        <Typography.Paragraph>Token yalnız şimdi gösteriliyor; saklanmıyor. Kopyalayıp kişiye güvenli bir kanaldan ilet.</Typography.Paragraph>
        <Typography.Paragraph code copyable style={{wordBreak: 'break-all'}}>
          {shown?.token}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          Claude Code: <Typography.Text code copyable>{`claude mcp add --scope user --transport http efsane-baskan-mcp https://mcp.efsanebaskan.com/mcp --header "Authorization: Bearer ${shown?.token ?? ''}"`}</Typography.Text>
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
