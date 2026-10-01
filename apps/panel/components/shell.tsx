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
  const large = size === 'large';
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
      <div className="kb-logo" style={large ? {width: 42, height: 42, fontSize: 15, borderRadius: 13} : undefined}>
        EB
      </div>
      <div style={{lineHeight: 1.25}}>
        <div style={{fontWeight: 600, fontSize: large ? 18 : 15, letterSpacing: '-0.01em'}}>Efsane Başkan</div>
        <div className="kb-stat-label" style={{fontSize: 12}}>Knowledge Engine</div>
      </div>
    </div>
  );
}

export function Shell({children}: {children: ReactNode}) {
  const path = usePathname();
  const selected = items.find(i => i.key !== '/' && path.startsWith(i.key))?.key ?? '/';
  return (
    <Layout style={{minHeight: '100vh'}}>
      <Layout.Sider className="kb-sider" breakpoint="lg" collapsedWidth={0} width={244}>
        <div className="kb-glass kb-sider-panel">
          <div style={{padding: '20px 18px 16px'}}>
            <Brand />
          </div>
          <Menu mode="inline" selectedKeys={[selected]} items={items} style={{padding: '0 10px', flex: 1}} />
          <form action={logout} style={{padding: 14}}>
            <Button htmlType="submit" icon={<LogoutOutlined />} block type="text" style={{color: '#6e6e73'}}>
              Çıkış
            </Button>
          </form>
        </div>
      </Layout.Sider>
      <Layout.Content style={{padding: '28px 32px'}}>
        {/* key: the rise animation replays on every page change */}
        <div key={path} className="kb-page" style={{maxWidth: 1440, margin: '0 auto'}}>
          {children}
        </div>
      </Layout.Content>
    </Layout>
  );
}
