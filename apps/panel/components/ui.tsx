'use client';

import {Typography} from 'antd';
import type {ReactNode} from 'react';

// antd sub-components (Typography.Title, …) are not reachable from server
// components; pages use these client wrappers instead.
export const PageTitle = ({children}: {children: ReactNode}) => <Typography.Title level={3}>{children}</Typography.Title>;
export const Hint = ({children}: {children: ReactNode}) => <Typography.Paragraph type="secondary">{children}</Typography.Paragraph>;
