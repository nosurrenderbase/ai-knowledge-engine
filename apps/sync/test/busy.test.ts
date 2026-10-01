import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {isBusy, whileBusy, writeVersionFile} from '../src/busy.ts';
import {tmpDir} from './helpers/repos.ts';

describe('busy file', () => {
  it('exists only while the job runs, also when it throws', async () => {
    const file = path.join(tmpDir(), 'state/busy.json');
    assert.equal(isBusy(file), false);
    await whileBusy(file, {area: 'backend'}, async () => {
      assert.equal(isBusy(file), true);
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).area, 'backend');
    });
    assert.equal(isBusy(file), false);
    await assert.rejects(whileBusy(file, {}, async () => Promise.reject(new Error('x'))));
    assert.equal(fs.existsSync(file), false);
  });

  it('ignores a file left by a process that is gone', () => {
    const file = path.join(tmpDir(), 'busy.json');
    fs.writeFileSync(file, JSON.stringify({pid: 2 ** 22 + 12345}));
    assert.equal(isBusy(file), false);
  });

  it('writes the loaded commit to the version file', () => {
    const file = path.join(tmpDir(), 'state/version.json');
    writeVersionFile(file);
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.match(v.sha, /^([0-9a-f]{40}|unknown)$/);
    assert.equal(v.pid, process.pid);
    writeVersionFile(file, tmpDir());
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sha, 'unknown', 'git deposu değilse');
  });
});
