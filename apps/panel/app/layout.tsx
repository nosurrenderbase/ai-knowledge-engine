import {AntdRegistry} from '@ant-design/nextjs-registry';
import type {Metadata, Viewport} from 'next';
import type {ReactNode} from 'react';
import {BackdropPulse} from '@/components/live';
import {Providers} from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {title: 'Efsane Başkan · Knowledge Engine'};
export const viewport: Viewport = {width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#eef0f4'};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="tr">
      <body>
        <div className="kb-backdrop" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </div>
        <BackdropPulse />
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
