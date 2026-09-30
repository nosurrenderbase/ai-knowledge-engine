import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {loadConfig} from '../src/config.ts';

describe('loadConfig', () => {
  it('requires the two clones', () => {
    assert.throws(() => loadConfig({CODE_REPO: '/c'}), /KB_REPO/);
    assert.throws(() => loadConfig({KB_REPO: '/k'}), /CODE_REPO/);
  });

  it('fills in defaults', () => {
    const cfg = loadConfig({KB_REPO: '/k', CODE_REPO: '/c'});
    assert.equal(cfg.kbRepo, '/k');
    assert.equal(cfg.area, 'backend');
    assert.equal(cfg.pollIntervalMs, 120_000);
    assert.equal(cfg.batchThreshold, 3);
    assert.equal(cfg.maxAttempts, 3);
    assert.equal(cfg.validationRounds, 2);
    assert.ok(cfg.promptsDir.endsWith('/prompts'), cfg.promptsDir);
    assert.equal(cfg.claude.bin, 'claude');
    assert.equal(cfg.claude.model, 'opus');
    assert.equal(cfg.alertWebhookUrl, undefined);
    assert.equal(cfg.dryRun, false);
  });

  it('reads overrides', () => {
    const cfg = loadConfig({
      KB_REPO: 'k',
      CODE_REPO: 'c',
      POLL_INTERVAL_MS: '900000',
      BATCH_THRESHOLD: '5',
      CLAUDE_MODEL: 'sonnet',
      PROMPTS_DIR: '/etc/prompts',
      DRY_RUN: '1',
      ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/x',
    });
    assert.equal(cfg.pollIntervalMs, 900_000);
    assert.equal(cfg.batchThreshold, 5);
    assert.equal(cfg.claude.model, 'sonnet');
    assert.equal(cfg.promptsDir, '/etc/prompts');
    assert.equal(cfg.dryRun, true);
    assert.equal(cfg.alertWebhookUrl, 'https://hooks.example.invalid/x');
    assert.ok(cfg.kbRepo.startsWith('/'), 'yollar mutlak yapılır');
  });

  it('rejects bad numbers', () => {
    assert.throws(() => loadConfig({KB_REPO: 'k', CODE_REPO: 'c', BATCH_THRESHOLD: '0'}), /BATCH_THRESHOLD/);
    assert.throws(() => loadConfig({KB_REPO: 'k', CODE_REPO: 'c', POLL_INTERVAL_MS: 'iki dakika'}), /POLL_INTERVAL_MS/);
  });
});
