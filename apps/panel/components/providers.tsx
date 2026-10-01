'use client';

import {App, ConfigProvider} from 'antd';
import trTR from 'antd/locale/tr_TR';
import type {ReactNode} from 'react';

const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", "Inter", "Segoe UI", sans-serif';

export function Providers({children}: {children: ReactNode}) {
  return (
    <ConfigProvider
      locale={trTR}
      theme={{
        token: {
          colorPrimary: '#0a84ff',
          colorInfo: '#0a84ff',
          colorSuccess: '#30d158',
          colorWarning: '#ff9f0a',
          colorError: '#ff453a',
          colorText: '#1d1d1f',
          colorTextSecondary: '#6e6e73',
          colorBgLayout: 'transparent',
          colorBorder: 'rgba(15,23,42,0.12)',
          colorBorderSecondary: 'rgba(15,23,42,0.07)',
          borderRadius: 12,
          controlHeight: 36,
          fontFamily: SYSTEM_FONT,
          fontSize: 14,
        },
        components: {
          Layout: {siderBg: 'transparent', bodyBg: 'transparent'},
          Menu: {itemBg: 'transparent', itemSelectedBg: 'transparent', itemHeight: 40, itemMarginInline: 0},
          Card: {headerBg: 'transparent'},
          Button: {primaryShadow: '0 6px 16px -6px rgba(10,132,255,0.55)', defaultShadow: 'none'},
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
