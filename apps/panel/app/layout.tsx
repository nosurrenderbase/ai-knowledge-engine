import {AntdRegistry} from '@ant-design/nextjs-registry';
import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {Providers} from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {title: 'Efsane Başkan · Knowledge Engine'};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="tr">
      <body>
        <div className="kb-backdrop" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
