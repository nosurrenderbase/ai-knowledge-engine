/**
 * What a set of changed files needs: dependency install, worker restart,
 * container rebuilds. Unknown paths restart nothing; docs never do.
 */

export type Service = 'mcp' | 'panel';

export interface Plan {
  npmCi: boolean;
  worker: boolean;
  services: Service[];
  /** compose.yaml or Redis settings changed: bring every service up again. */
  composeAll: boolean;
  /** Changes this job cannot apply by itself (e.g. the launchd plist). */
  manual: string[];
}

/** Workspace packages and the apps that load them. */
const PACKAGE_USERS: Record<string, {worker: boolean; services: Service[]}> = {
  kb: {worker: true, services: ['mcp', 'panel']},
  search: {worker: true, services: ['mcp', 'panel']},
  accounts: {worker: false, services: ['mcp', 'panel']},
  gamedb: {worker: false, services: ['mcp']},
};

export function planDeploy(changed: string[]): Plan {
  const plan: Plan = {npmCi: false, worker: false, services: [], composeAll: false, manual: []};
  const services = new Set<Service>();
  for (const f of changed) {
    if (/(^|\/)[^/]+\.md$/i.test(f) || /\/test\//.test(f) || f.startsWith('docs/')) continue;
    if (f === 'package-lock.json' || /^(apps|packages)\/[^/]+\/package\.json$/.test(f) || f === 'package.json') {
      plan.npmCi = true;
      plan.worker = true;
      services.add('mcp').add('panel');
    } else if (f.startsWith('apps/sync/') || f === 'deploy/run.sh' || f === 'deploy/kbsync.env.example') {
      plan.worker = true;
    } else if (f.startsWith('apps/mcp/')) {
      services.add('mcp');
    } else if (f.startsWith('apps/panel/')) {
      services.add('panel');
    } else if (f === 'compose.yaml' || f.startsWith('deploy/redis/')) {
      plan.composeAll = true;
    } else if (/^deploy\/.*\.plist$|^deploy\/install-launchd\.sh$/.test(f)) {
      plan.manual.push(`${f}: launchd ajanını yeniden kurmak gerekir (deploy/install-launchd.sh)`);
    } else {
      const pkg = f.match(/^packages\/([^/]+)\//)?.[1];
      const users = pkg ? PACKAGE_USERS[pkg] : undefined;
      if (users) {
        plan.worker ||= users.worker;
        for (const s of users.services) services.add(s);
      }
    }
  }
  plan.services = [...services].sort();
  return plan;
}

export function describePlan(p: Plan): string {
  const parts = [p.npmCi && 'npm ci', p.worker && 'işçi', ...p.services, p.composeAll && 'tüm compose servisleri'].filter(Boolean);
  return parts.length ? parts.join(', ') : 'yeniden başlatma gerekmiyor';
}
