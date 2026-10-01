import * as fs from 'node:fs';
import * as path from 'node:path';
import {generateCards, generateFrontendDocs, loadDocs} from '@ai-knowledge-engine/kb';
import {dropStampOnlyChanges, snapshotGenBlocks} from './cards.ts';
import {parseNameStatus, relevantChanges, type Change} from './changes.ts';
import {runClaude, type ClaudeOutcome, type ClaudeRequest, type Report} from './claude.ts';
import type {Config} from './config.ts';
import {Git, type Merge} from './git.ts';
import {planGroups} from './groups.ts';
import {computeFrontendImpact} from './frontend-impact.ts';
import {computeImpact, type CodeView, type Impact} from './impact.ts';
import type {Logger} from './log.ts';
import {buildFixMessage, buildRunMessage, loadSystemPrompt} from './prompt.ts';
import {describeMerges, type Job} from './queue.ts';
import {updateReadmeStatus} from './readme.ts';
import {validate} from './validate.ts';

/** The subscription's usage limit was hit; retry after `resetAt` without counting an attempt. */
export class LimitReached extends Error {
  readonly resetAt: Date | null;
  constructor(message: string, resetAt: Date | null) {
    super(message);
    this.resetAt = resetAt;
  }
}

/** The job did not finish. `fatal` means retrying will not help: a human must look. */
export class JobFailed extends Error {
  readonly fatal: boolean;
  constructor(message: string, fatal = false) {
    super(message);
    this.fatal = fatal;
  }
}

export interface JobDeps {
  cfg: Config;
  log: Logger;
  now: () => Date;
  claude: (req: ClaudeRequest) => Promise<ClaudeOutcome>;
}

export interface JobResult {
  commitMessage: string;
  report: Report | null;
  changedDocs: string[];
  costUsd: number;
}

export function defaultClaude(cfg: Config) {
  return (req: ClaudeRequest) => runClaude(cfg.claude, req);
}

export function sourceCommitFile(cfg: Config): string {
  return path.join(cfg.kbRepo, cfg.area, '.source-commit');
}

/**
 * Brings both clones to their remotes' latest state (discarding anything
 * local) and reads the queue: merges on the code branch after the watermark.
 */
export async function readQueue(cfg: Config): Promise<{base: string; queue: Merge[]}> {
  const kb = new Git(cfg.kbRepo);
  const code = new Git(cfg.codeRepo);
  await kb.fetch(cfg.kbRemote);
  await kb.resetHard(`${cfg.kbRemote}/${cfg.kbBranch}`);
  await code.fetch(cfg.codeRemote);

  const watermark = fs.readFileSync(sourceCommitFile(cfg), 'utf8').trim();
  const headRef = `${cfg.codeRemote}/${cfg.codeBranch}`;
  let base: string;
  try {
    base = await code.revParse(watermark);
  } catch {
    throw new JobFailed(`.source-commit (${watermark}) kod reposunda bulunamadı`, true);
  }
  if (!(await code.isAncestor(base, headRef))) {
    throw new JobFailed(`.source-commit (${watermark}) ${headRef} geçmişinde değil (force-push?)`, true);
  }
  return {base, queue: await code.mergesAfter(base, headRef)};
}

/** Combines the reports of a split job (and of fix rounds) into one. */
export function mergeReports(reports: Report[]): Report {
  const merged: Report = {updated: [], created: [], retired: [], no_change: [], value_changes: [], findings: [], open_questions: []};
  for (const r of reports) {
    for (const key of Object.keys(merged) as (keyof Report)[]) {
      (merged[key] as unknown[]).push(...(r[key] as unknown[]));
    }
  }
  return merged;
}

function commitMessage(cfg: Config, job: Job, base7: string, head7: string, report: Report | null): string {
  const title = `${cfg.area}: ${describeMerges(job.merges)} senkronu (kod ${base7}..${head7})`;
  if (!report) return `${title}\n\nBelgelenen davranışı etkileyen kod değişikliği yok.`;
  const body: string[] = [];
  body.push(`Güncellenen: ${report.updated.length}, yeni: ${report.created.length}, kaldırılan: ${report.retired.length}`);
  if (report.value_changes.length) {
    body.push('', 'Barem değişiklikleri:');
    for (const v of report.value_changes) body.push(`- ${v.rule}: ${v.old} → ${v.new} (${v.doc})`);
  }
  if (report.findings.length) {
    body.push('', 'Bulgular:');
    for (const f of report.findings) body.push(`- [${f.severity}] ${f.path}: ${f.summary}`);
  }
  return `${title}\n\n${body.join('\n')}`;
}

async function finish(cfg: Config, deps: JobDeps, kb: Git, head7: string, message: string): Promise<void> {
  fs.writeFileSync(sourceCommitFile(cfg), `${head7}\n`);
  updateReadmeStatus(path.join(cfg.kbRepo, cfg.area), head7, deps.now());
  await kb.commitAll(message, cfg.author);
  if (cfg.dryRun) {
    deps.log('info', 'DRY_RUN: push atlanıyor', {message: message.split('\n')[0]});
    return;
  }
  await kb.push(cfg.kbRemote, cfg.kbBranch);
}

interface Prepared {
  impact: Impact;
  /** Generated documents whose content changed (repo-relative). */
  regeneratedCards: string[];
  /** Resolver/controller files to check endpoint coverage for (backend). */
  endpointFiles: string[];
}

/** Backend: impact from sources and category rules, then use case cards for the touched modules. */
async function prepareBackend(cfg: Config, kb: Git, code: Git, job: Job, changes: Change[]): Promise<Prepared> {
  const areaDir = path.join(cfg.kbRepo, cfg.area);
  const view: CodeView = {
    read: async (c: Change) => {
      if (c.status === 'D') return code.show(job.base, c.path);
      const file = path.join(cfg.codeRepo, c.path);
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    },
    moduleExists: m => fs.existsSync(path.join(cfg.codeRepo, 'src/modules', m)),
  };
  const impact = await computeImpact(changes, loadDocs(areaDir), view);
  generateCards({areaDir, sourceDir: cfg.codeRepo, modules: impact.cardModules});
  const regeneratedCards = await dropStampOnlyChanges(kb, cfg.area);
  const endpointFiles = changes.filter(c => c.status !== 'D' && /\.(resolver|controller)\.ts$/.test(c.path)).map(c => c.path);
  return {impact, regeneratedCards, endpointFiles};
}

/**
 * Frontend: every generated document (operation and screen cards, API map,
 * unused code) is rebuilt from the app and the backend; the impact list then
 * adds the cards that changed and the flows using them.
 */
async function prepareFrontend(cfg: Config, kb: Git, changes: Change[]): Promise<Prepared> {
  if (!cfg.backendRepo) throw new JobFailed('frontend için backend kod reposu (CODE_REPO) gerekli', true);
  const areaDir = path.join(cfg.kbRepo, cfg.area);
  const before = new Set(loadDocs(areaDir).map(d => d.path));
  const generated = generateFrontendDocs({
    areaDir,
    sourceDir: cfg.codeRepo,
    backendDir: cfg.backendRepo,
    backendAreaDir: path.join(cfg.kbRepo, 'backend'),
  });
  const regeneratedCards = await dropStampOnlyChanges(kb, cfg.area);
  const prefix = `${cfg.area}/`;
  const changedRel = regeneratedCards.map(f => f.slice(prefix.length));
  const newCards = new Set(changedRel.filter(f => !before.has(f)));
  const docs = loadDocs(areaDir);
  const impact = computeFrontendImpact(changes, docs, changedRel, newCards);
  for (const orphan of generated.orphanCards) {
    impact.docs.set(orphan, [...(impact.docs.get(orphan) ?? []), 'işlem koddan kaldırıldı: "kaldırıldı" işaretle, linklerini kaldır']);
  }
  return {impact, regeneratedCards, endpointFiles: []};
}

/** Runs one job end to end: diff → cards → Claude → validation → commit → push. */
export async function runJob(job: Job, deps: JobDeps): Promise<JobResult> {
  const {cfg, log} = deps;
  const kb = new Git(cfg.kbRepo);
  const code = new Git(cfg.codeRepo);
  const areaDir = path.join(cfg.kbRepo, cfg.area);

  await code.checkoutDetached(job.head);
  const base7 = await code.shortSha(job.base);
  const head7 = await code.shortSha(job.head);
  const changes = relevantChanges(parseNameStatus(await code.diffNameStatus(job.base, job.head)));

  if (changes.length === 0) {
    const message = commitMessage(cfg, job, base7, head7, null);
    await finish(cfg, deps, kb, head7, message);
    log('info', 'etkisiz değişiklik, yalnız watermark ilerledi', {head: head7});
    return {commitMessage: message, report: null, changedDocs: [], costUsd: 0};
  }

  const {impact, regeneratedCards, endpointFiles} =
    cfg.area === 'frontend' ? await prepareFrontend(cfg, kb, changes) : await prepareBackend(cfg, kb, code, job, changes);
  log('info', 'etki listesi çıkarıldı', {head: head7, docs: impact.docs.size, cardModules: impact.cardModules});
  const genBlocks = snapshotGenBlocks(cfg.kbRepo, cfg.area);

  const systemPrompt = loadSystemPrompt(cfg.promptsDir, cfg.area);
  const date = deps.now().toISOString().slice(0, 10);
  const groups = planGroups(impact, cfg.groupMaxDocs);
  const request = (part: typeof impact, index: number): ClaudeRequest => ({
    cwd: cfg.kbRepo,
    areaDir,
    codeDir: cfg.codeRepo,
    systemPrompt,
    message: buildRunMessage({
      job,
      base7,
      head7,
      date,
      changes,
      impact: part,
      area: cfg.area,
      kbRoot: cfg.kbRepo,
      codeDir: cfg.codeRepo,
      part: groups.length > 1 ? {index: index + 1, total: groups.length} : undefined,
    }),
  });
  // Large jobs: one call per group; validation feedback then continues the last session.
  let costUsd = 0;
  const reports: Report[] = [];
  const call = async (req: ClaudeRequest): Promise<string> => {
    const outcome = await deps.claude(req);
    if (outcome.kind === 'limit') throw new LimitReached(outcome.message, outcome.resetAt);
    if (outcome.kind === 'error') throw new JobFailed(outcome.message);
    costUsd += outcome.costUsd ?? 0;
    reports.push(outcome.report);
    return outcome.sessionId;
  };

  let sessionId = '';
  for (const [i, part] of groups.entries()) {
    if (groups.length > 1) log('info', 'grup çağrısı', {part: i + 1, total: groups.length, docs: part.docs.size});
    sessionId = await call(request(part, i));
  }
  for (let round = 0; ; round++) {
    const result = await validate({
      kbGit: kb,
      codeGit: code,
      area: cfg.area,
      head: job.head,
      genBlocks,
      cardModules: impact.cardModules,
      endpointFiles,
      regeneratedCards,
      impactCount: impact.docs.size,
    });
    if (result.fatal.length) throw new JobFailed(`doğrulama durdurdu:\n${result.fatal.join('\n')}`, true);
    if (result.retryable.length === 0) {
      const report = mergeReports(reports);
      const message = commitMessage(cfg, job, base7, head7, report);
      await finish(cfg, deps, kb, head7, message);
      log('info', 'iş tamamlandı', {head: head7, changed: result.changed.length, costUsd});
      return {commitMessage: message, report, changedDocs: result.changed, costUsd};
    }
    if (round >= cfg.validationRounds) {
      throw new JobFailed(`doğrulama ${round + 1} turda geçmedi:\n${result.retryable.join('\n')}`);
    }
    log('warn', 'doğrulama hataları Claude\'a geri veriliyor', {round: round + 1, errors: result.retryable.length});
    const last = request(groups[groups.length - 1], groups.length - 1);
    sessionId = await call({...last, message: buildFixMessage(result.retryable), resume: sessionId});
  }
}
