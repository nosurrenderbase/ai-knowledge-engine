'use client';

import {Typography} from 'antd';
import type {ReactNode} from 'react';

// antd sub-components (Typography.Title, …) are not reachable from server
// components; pages use these client wrappers instead.
export const PageTitle = ({children}: {children: ReactNode}) => (
  <Typography.Title level={2} style={{margin: '4px 0 22px', fontWeight: 700, letterSpacing: '-0.025em', fontSize: 30}}>
    {children}
  </Typography.Title>
);
export const Hint = ({children}: {children: ReactNode}) => <Typography.Paragraph type="secondary">{children}</Typography.Paragraph>;

/** A number tile: quiet label, large tabular value. */
export const StatTile = ({label, value}: {label: string; value: ReactNode}) => (
  <div>
    <div className="kb-stat-label">{label}</div>
    <div className="kb-stat-value">{value}</div>
  </div>
);
