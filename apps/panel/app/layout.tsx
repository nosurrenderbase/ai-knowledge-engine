import {AntdRegistry} from '@ant-design/nextjs-registry';
import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {Providers} from '@/components/providers';

export const metadata: Metadata = {title: 'Efsane Başkan KB Paneli'};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="tr">
      <body style={{margin: 0}}>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
