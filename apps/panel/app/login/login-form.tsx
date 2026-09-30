'use client';

import {Alert, Button, Card, Input, Space, Typography} from 'antd';
import {useActionState} from 'react';
import {login} from './actions';

export function LoginForm({next}: {next: string}) {
  const [error, action, pending] = useActionState(login, null);
  return (
    <Card style={{width: 360}}>
      <form action={action}>
        <Space direction="vertical" style={{width: '100%'}} size="middle">
          <Typography.Title level={4} style={{margin: 0}}>
            Efsane Başkan KB Paneli
          </Typography.Title>
          <input type="hidden" name="next" value={next} />
          <Input.Password name="password" placeholder="Panel parolası" autoFocus />
          {error && <Alert type="error" message={error} showIcon />}
          <Button type="primary" htmlType="submit" loading={pending} block>
            Giriş
          </Button>
        </Space>
      </form>
    </Card>
  );
}
