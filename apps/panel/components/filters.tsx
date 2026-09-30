'use client';

import {Checkbox, Select, Space} from 'antd';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';

export interface FilterDef {
  name: string;
  label: string;
  options?: {value: string; label: string}[];
  /** Renders a checkbox instead of a select. */
  checkbox?: boolean;
  width?: number;
}

/** Filters kept in the URL (?days=30&user=2), so views can be linked. */
export function Filters({defs}: {defs: FilterDef[]}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const set = (name: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    router.push(`${path}?${next}`);
  };
  return (
    <Space wrap style={{marginBottom: 16}}>
      {defs.map(d =>
        d.checkbox ? (
          <Checkbox key={d.name} checked={params.get(d.name) === '1'} onChange={e => set(d.name, e.target.checked ? '1' : undefined)}>
            {d.label}
          </Checkbox>
        ) : (
          <Select
            key={d.name}
            allowClear
            placeholder={d.label}
            style={{width: d.width ?? 180}}
            value={params.get(d.name) ?? undefined}
            options={d.options}
            onChange={v => set(d.name, v)}
          />
        ),
      )}
    </Space>
  );
}

export const DAY_OPTIONS = [1, 7, 30, 90].map(d => ({value: String(d), label: `Son ${d} gün`}));
export const TOOL_OPTIONS = ['search', 'read_doc', 'grep', 'list_docs'].map(t => ({value: t, label: t}));
