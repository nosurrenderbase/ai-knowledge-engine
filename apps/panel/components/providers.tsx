'use client';

import {App, ConfigProvider, theme} from 'antd';
import trTR from 'antd/locale/tr_TR';
import type {ReactNode} from 'react';

export function Providers({children}: {children: ReactNode}) {
  return (
    <ConfigProvider
      locale={trTR}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#8b5cf6',
          colorInfo: '#22d3ee',
          colorSuccess: '#34d399',
          colorWarning: '#fbbf24',
          colorError: '#f87171',
          colorLink: '#67e8f9',
          colorBgBase: '#070b14',
          colorBgContainer: '#0d1322',
          colorBgElevated: '#111a2e',
          colorBorder: '#1f2a40',
          colorBorderSecondary: '#182134',
          borderRadius: 12,
          fontFamily: 'var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Layout: {siderBg: 'transparent', bodyBg: 'transparent', triggerBg: '#0d1322'},
          Menu: {darkItemBg: 'transparent', darkItemSelectedBg: 'transparent', darkItemColor: 'rgba(226,232,240,0.7)', itemBorderRadius: 10},
          Table: {headerBg: 'transparent', rowHoverBg: 'rgba(139,92,246,0.06)'},
          Button: {primaryShadow: '0 0 18px rgba(139,92,246,0.35)'},
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
