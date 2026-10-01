'use client';

import {Typography} from 'antd';
import type {ReactNode} from 'react';

// antd sub-components (Typography.Title, …) are not reachable from server
// components; pages use these client wrappers instead.
export const PageTitle = ({children}: {children: ReactNode}) => (
  <div>
    <Typography.Title level={3} style={{margin: 0, fontWeight: 650, letterSpacing: '-0.01em'}}>
      {children}
    </Typography.Title>
    <div className="kb-title-rule" />
  </div>
);
export const Hint = ({children}: {children: ReactNode}) => <Typography.Paragraph type="secondary">{children}</Typography.Paragraph>;

/** A number tile: small caps label, large mono value in the accent gradient. */
export const StatTile = ({label, value}: {label: string; value: ReactNode}) => (
  <div>
    <div className="kb-stat-label">{label}</div>
    <div className="kb-stat-value kb-gradient-text">{value}</div>
  </div>
);
