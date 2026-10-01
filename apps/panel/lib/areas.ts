/** Knowledge base areas, each with its own search index (safe to import from client components). */
export const AREAS = ['backend', 'frontend', 'mac-motoru'] as const;
export type AreaName = (typeof AREAS)[number];

/** Code repositories of the areas, and of this repo, for commit links. */
export const AREA_REPOS: Record<AreaName, string> = {
  backend: 'nosurrenderbase/nestjs-boilerplate',
  frontend: 'nosurrenderbase/efsane-baskan-rn',
  'mac-motoru': 'nosurrenderbase/match-engine',
};
export const ENGINE_REPO = 'nosurrenderbase/ai-knowledge-engine';
