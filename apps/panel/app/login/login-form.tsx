'use client';

import {Alert, Button, Card, Input, Space, Typography} from 'antd';
import {useActionState} from 'react';
import {Brand} from '@/components/shell';
import {login} from './actions';

export function LoginForm({next}: {next: string}) {
  const [error, action, pending] = useActionState(login, null);
  return (
    <Card className="kb-page" style={{width: 380}} styles={{body: {padding: 32}}}>
      <form action={action}>
        <Space direction="vertical" style={{width: '100%'}} size="large">
          <div>
            <Brand size="large" />
            <Typography.Paragraph type="secondary" style={{margin: '16px 0 0'}}>
              Bilgi tabanı, MCP ve oyun verisi yönetim paneli
            </Typography.Paragraph>
          </div>
          <input type="hidden" name="next" value={next} />
          <Input.Password name="password" placeholder="Panel parolası" autoFocus size="large" />
          {error && <Alert type="error" message={error} showIcon />}
          <Button type="primary" htmlType="submit" loading={pending} block size="large" style={{fontWeight: 600}}>
            Giriş
          </Button>
        </Space>
      </form>
    </Card>
  );
}
