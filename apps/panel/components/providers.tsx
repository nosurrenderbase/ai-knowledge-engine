'use client';

import {App, ConfigProvider} from 'antd';
import trTR from 'antd/locale/tr_TR';
import type {ReactNode} from 'react';

export function Providers({children}: {children: ReactNode}) {
  return (
    <ConfigProvider locale={trTR}>
      <App>{children}</App>
    </ConfigProvider>
  );
}
