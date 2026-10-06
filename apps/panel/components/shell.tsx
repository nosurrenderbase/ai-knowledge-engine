'use client';

import {BarChartOutlined, ClusterOutlined, DeploymentUnitOutlined, DashboardOutlined, LogoutOutlined, SearchOutlined, TeamOutlined, UnorderedListOutlined} from '@ant-design/icons';
import {Button, Layout, Menu} from 'antd';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import type {ReactNode} from 'react';
import {logout} from '@/app/login/actions';

const PAGES = [
  {key: '/', icon: <DashboardOutlined />, label: 'Genel bakış', short: 'Özet'},
  {key: '/users', icon: <TeamOutlined />, label: 'Kullanıcılar', short: 'Kişiler'},
  {key: '/usage', icon: <BarChartOutlined />, label: 'Kullanım', short: 'Kullanım'},
  {key: '/queries', icon: <UnorderedListOutlined />, label: 'Sorular', short: 'Sorular'},
  {key: '/search', icon: <SearchOutlined />, label: 'Arama denemesi', short: 'Arama'},
  {key: '/galaxy', icon: <DeploymentUnitOutlined />, label: 'Bilgi uzayı', short: 'Uzay'},
  {key: '/system', icon: <ClusterOutlined />, label: 'Sistem', short: 'Sistem'},
];

export function Brand({size = 'normal'}: {size?: 'normal' | 'large'}) {
  const large = size === 'large';
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: large ? 14 : 10}}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand.png" alt="Efsane Başkan" className="kb-brand" style={{height: large ? 64 : 40}} />
      <div style={{lineHeight: 1.25}}>
        <div style={{fontWeight: 600, fontSize: large ? 17 : 14, letterSpacing: '-0.01em'}}>Knowledge Engine</div>
        <div className="kb-stat-label" style={{fontSize: 12}}>yönetim paneli</div>
      </div>
    </div>
  );
}

function LogoutButton({label = true}: {label?: boolean}) {
  return (
    <form action={logout}>
      <Button htmlType="submit" icon={<LogoutOutlined />} block={label} type="text" style={{color: '#6e6e73'}} aria-label="Çıkış">
        {label ? 'Çıkış' : null}
      </Button>
    </form>
  );
}

/**
 * Desktop: a floating glass sidebar. Phones and tablets: a top bar with the
 * brand, and a glass tab bar at the bottom (like iOS), clear of the home indicator.
 */
export function Shell({children}: {children: ReactNode}) {
  const path = usePathname();
  const selected = PAGES.find(i => i.key !== '/' && path.startsWith(i.key))?.key ?? '/';
  return (
    <Layout style={{minHeight: '100vh'}}>
      <Layout.Sider className="kb-sider" width={244}>
        <div className="kb-glass kb-sider-panel">
          <div style={{padding: '20px 18px 16px'}}>
            <Brand />
          </div>
          <Menu
            mode="inline"
            selectedKeys={[selected]}
            items={PAGES.map(p => ({key: p.key, icon: p.icon, label: <Link href={p.key}>{p.label}</Link>}))}
            style={{padding: '0 10px', flex: 1}}
          />
          <div style={{padding: 14}}>
            <LogoutButton />
          </div>
        </div>
      </Layout.Sider>
      <Layout.Content className="kb-content">
        <header className="kb-topbar">
          <Brand />
          <LogoutButton label={false} />
        </header>
        {/* key: the rise animation replays on every page change */}
        <div key={path} className="kb-page" style={{maxWidth: 1320}}>
          {children}
        </div>
      </Layout.Content>
      <nav className="kb-tabbar kb-glass" aria-label="Sayfalar">
        {PAGES.map(p => (
          <Link key={p.key} href={p.key} className={`kb-tab${selected === p.key ? ' kb-tab-on' : ''}`}>
            <span className="kb-tab-icon">{p.icon}</span>
            <span>{p.short}</span>
          </Link>
        ))}
      </nav>
    </Layout>
  );
}
