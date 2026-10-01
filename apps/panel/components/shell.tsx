'use client';

import {BarChartOutlined, DashboardOutlined, LogoutOutlined, SearchOutlined, TeamOutlined, UnorderedListOutlined} from '@ant-design/icons';
import {Button, Layout, Menu} from 'antd';
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

export function Brand({size = 'normal'}: {size?: 'normal' | 'large'}) {
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
      <div className="kb-logo" style={size === 'large' ? {width: 44, height: 44, fontSize: 17, borderRadius: 12} : undefined}>
        EB
      </div>
      <div style={{lineHeight: 1.2}}>
        <div style={{fontWeight: 650, fontSize: size === 'large' ? 18 : 15, color: '#e2e8f0'}}>Efsane Başkan</div>
        <div className="kb-stat-label" style={{fontSize: 10}}>Knowledge Engine</div>
      </div>
    </div>
  );
}

export function Shell({children}: {children: ReactNode}) {
  const path = usePathname();
  const selected = items.find(i => i.key !== '/' && path.startsWith(i.key))?.key ?? '/';
  return (
    <Layout style={{minHeight: '100vh'}}>
      <Layout.Sider className="kb-sider" breakpoint="lg" collapsedWidth={0} width={232}>
        <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
          <div style={{padding: '22px 20px 18px'}}>
            <Brand />
          </div>
          <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={items} style={{padding: '0 8px', flex: 1}} />
          <form action={logout} style={{padding: 16}}>
            <Button htmlType="submit" icon={<LogoutOutlined />} block type="text" style={{color: 'rgba(226,232,240,0.6)'}}>
              Çıkış
            </Button>
          </form>
        </div>
      </Layout.Sider>
      <Layout.Content style={{padding: '28px 32px'}}>
        <div style={{maxWidth: 1440, margin: '0 auto'}}>{children}</div>
      </Layout.Content>
    </Layout>
  );
}
