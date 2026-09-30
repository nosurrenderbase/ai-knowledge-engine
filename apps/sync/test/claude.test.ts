import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {buildArgs, detectLimit, interpretOutput, parseResetTime, permissionSettings, REPORT_SCHEMA, type ClaudeRequest} from '../src/claude.ts';

const cfg = {bin: 'claude', model: 'opus', maxTurns: 80, timeoutMs: 1000};
const req: ClaudeRequest = {
  cwd: '/srv/kb',
  areaDir: '/srv/kb/backend',
  codeDir: '/srv/code',
  systemPrompt: 'SİSTEM',
  message: 'MESAJ',
};

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe('buildArgs', () => {
  it('runs unattended with the report schema, the code dir and our permission rules only', () => {
    const args = buildArgs(cfg, req);
    assert.equal(args[0], '-p');
    assert.equal(flag(args, '--output-format'), 'json');
    assert.equal(flag(args, '--permission-mode'), 'dontAsk');
    assert.equal(flag(args, '--model'), 'opus');
    assert.equal(flag(args, '--max-turns'), '80');
    assert.equal(flag(args, '--add-dir'), '/srv/code');
    assert.equal(flag(args, '--setting-sources'), '');
    assert.equal(flag(args, '--append-system-prompt'), 'SİSTEM');
    assert.deepEqual(JSON.parse(flag(args, '--json-schema')), REPORT_SCHEMA);
    assert.deepEqual(JSON.parse(flag(args, '--settings')), permissionSettings('/srv/kb/backend', '/srv/code'));
    assert.ok(!args.includes('--resume'));
    assert.ok(!args.includes('MESAJ'), 'mesaj stdin ile gider');
  });

  it('resumes a session for validation feedback', () => {
    assert.equal(flag(buildArgs(cfg, {...req, resume: 'abc'}), '--resume'), 'abc');
  });
});

describe('permissionSettings', () => {
  const {permissions} = permissionSettings('/srv/kb/backend', '/srv/code') as {permissions: {allow: string[]; deny: string[]}};

  it('lets Claude edit markdown in the area only, with absolute paths', () => {
    assert.ok(permissions.allow.includes('Edit(//srv/kb/backend/**/*.md)'));
    assert.ok(permissions.allow.includes('Write(//srv/kb/backend/**/*.md)'));
    assert.ok(!permissions.allow.some(r => r.startsWith('Edit(') && r.includes('/srv/code')));
  });

  it('allows read-only git on the code repo and nothing else in Bash', () => {
    const bash = permissions.allow.filter(r => r.startsWith('Bash('));
    assert.deepEqual(bash, ['Bash(git -C /srv/code diff:*)', 'Bash(git -C /srv/code show:*)', 'Bash(git -C /srv/code log:*)']);
  });

  it('denies env files, the watermark, the worker-kept README, committing and the network', () => {
    for (const rule of [
      'Read(**/.env*)',
      'Read(//srv/code/.env*)',
      'Edit(//srv/kb/backend/.source-commit)',
      'Write(//srv/kb/backend/README.md)',
      'Bash(git commit:*)',
      'Bash(git push:*)',
      'WebFetch',
      'WebSearch',
    ]) {
      assert.ok(permissions.deny.includes(rule), rule);
    }
  });
});

describe('parseResetTime', () => {
  const now = new Date(2026, 8, 29, 13, 20);

  it('reads 12-hour times later today', () => {
    assert.deepEqual(parseResetTime("You've hit your session limit · resets 3pm", now), new Date(2026, 8, 29, 15, 1));
  });

  it('reads 24-hour times with minutes', () => {
    assert.deepEqual(parseResetTime('limit resets at 15:30', now), new Date(2026, 8, 29, 15, 31));
  });

  it('rolls over to tomorrow when the time has passed', () => {
    assert.deepEqual(parseResetTime('resets 9:05am', now), new Date(2026, 8, 30, 9, 6));
  });

  it('handles 12am and 12pm', () => {
    assert.deepEqual(parseResetTime('resets 12am', now), new Date(2026, 8, 30, 0, 1));
    assert.deepEqual(parseResetTime('resets 12pm', new Date(2026, 8, 29, 8, 0)), new Date(2026, 8, 29, 12, 1));
  });

  it('returns null when there is no readable time', () => {
    assert.equal(parseResetTime('resets soon', now), null);
    assert.equal(parseResetTime('resets 27:00', now), null);
  });
});

describe('detectLimit', () => {
  it('recognises the limit messages', () => {
    for (const text of ["You've hit your session limit · resets 3pm", "You've hit your weekly limit", 'Claude usage limit reached', '{"type":"rate_limit_error"}']) {
      assert.ok(detectLimit(text, new Date()), text);
    }
  });

  it('ignores other errors', () => {
    assert.equal(detectLimit('Error: ENOENT', new Date()), null);
  });
});

describe('interpretOutput', () => {
  const now = new Date(2026, 8, 29, 13, 0);
  const report = {updated: [], created: [], retired: [], no_change: [], value_changes: [], findings: [], open_questions: []};

  it('returns the structured report on success', () => {
    const out = interpretOutput(0, JSON.stringify({type: 'result', subtype: 'success', is_error: false, session_id: 's1', structured_output: report, total_cost_usd: 1.25, num_turns: 9}), '', now);
    assert.deepEqual(out, {kind: 'ok', sessionId: 's1', report, costUsd: 1.25, turns: 9});
  });

  it('reports a usage limit with its reset time', () => {
    const out = interpretOutput(1, JSON.stringify({is_error: true, subtype: 'success', result: "You've hit your session limit · resets 3pm"}), '', now);
    assert.equal(out.kind, 'limit');
    assert.deepEqual(out.kind === 'limit' && out.resetAt, new Date(2026, 8, 29, 15, 1));
  });

  it('detects a limit reported as a successful run without a report', () => {
    const out = interpretOutput(0, JSON.stringify({subtype: 'success', is_error: false, result: "You've hit your weekly limit · resets 9am"}), '', now);
    assert.equal(out.kind, 'limit');
  });

  it('does not mistake a report that mentions limits for a limit', () => {
    const withText = {...report, open_questions: ['usage limit reached mı?']};
    const out = interpretOutput(0, JSON.stringify({subtype: 'success', is_error: false, session_id: 's', structured_output: withText, result: 'usage limit reached'}), '', now);
    assert.equal(out.kind, 'ok');
  });

  it('detects a limit printed on stderr without JSON', () => {
    assert.equal(interpretOutput(1, '', 'Claude usage limit reached.', now).kind, 'limit');
  });

  it('reports max-turns and other failures as errors, keeping the session id', () => {
    const out = interpretOutput(1, JSON.stringify({is_error: true, subtype: 'error_max_turns', session_id: 's2', result: 'çok uzun'}), '', now);
    assert.equal(out.kind, 'error');
    assert.match(out.kind === 'error' ? out.message : '', /error_max_turns/);
    assert.equal(out.kind === 'error' && out.sessionId, 's2');
  });

  it('rejects output that is not JSON or has no valid report', () => {
    assert.equal(interpretOutput(0, 'merhaba', '', now).kind, 'error');
    const bad = interpretOutput(0, JSON.stringify({subtype: 'success', is_error: false, structured_output: {updated: []}}), '', now);
    assert.equal(bad.kind, 'error');
  });
});
