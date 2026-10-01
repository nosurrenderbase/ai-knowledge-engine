/** Knowledge base areas, each with its own search index (safe to import from client components). */
export const AREAS = ['backend', 'frontend', 'mac-motoru'] as const;
export type AreaName = (typeof AREAS)[number];
