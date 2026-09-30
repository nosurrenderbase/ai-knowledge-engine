'use client';

import {BarChartOutlined, DashboardOutlined, LogoutOutlined, SearchOutlined, TeamOutlined, UnorderedListOutlined} from '@ant-design/icons';
import {Button, Layout, Menu, Typography} from 'antd';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import type {ReactNode} from 'react';
import {logout} from '@/app/login/actions';

const items = [
  {key: '/', icon: <DashboardOutlined />, label: <Link href="/">Genel bakış</Link>},
  {key: '/users', icon: <TeamOutlined />, label: <Link href="/users">Kullanıcılar</Link>},
  {key: '/usage', icon: <BarChartOutlined />, label: <Link href="/usage">Kullanım</Link>},
  {key: '/queries', icon: <UnorderedListOutlined />, label: <Link href="/queries">Sorular</Link>},
  {key: '/search', icon: <SearchOutlined />, label: <Link href="/search">Arama denemesi</Link>},
];

export function Shell({children}: {children: ReactNode}) {
  const path = usePathname();
  const selected = items.find(i => i.key !== '/' && path.startsWith(i.key))?.key ?? '/';
  return (
    <Layout style={{minHeight: '100vh'}}>
      <Layout.Sider breakpoint="lg" collapsedWidth={0} theme="light" width={220}>
        <div style={{padding: '16px 20px'}}>
          <Typography.Text strong>Efsane Başkan KB</Typography.Text>
        </div>
        <Menu mode="inline" selectedKeys={[selected]} items={items} />
        <form action={logout} style={{padding: 16}}>
          <Button htmlType="submit" icon={<LogoutOutlined />} block>
            Çıkış
          </Button>
        </form>
      </Layout.Sider>
      <Layout.Content style={{padding: 24}}>{children}</Layout.Content>
    </Layout>
  );
}
