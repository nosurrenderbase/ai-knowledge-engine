import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {displayValue, generateKeys, parseEnv, seal, setEnvValue, settingByKey, SETTINGS, unseal, validateChange} from '../src/index.ts';

describe('catalog', () => {
  it('validates changes and keeps dangerous keys read-only', () => {
    assert.equal(validateChange('POLL_INTERVAL_MS', '60000'), null);
    assert.match(validateChange('POLL_INTERVAL_MS', '1 dakika')!, /geçersiz/);
    assert.match(validateChange('POSTGRES_PASSWORD', 'x')!, /sunucuda/);
    assert.match(validateChange('CF_TUNNEL_TOKEN', 'x')!, /sunucuda/);
    assert.match(validateChange('PATH', '/bin')!, /değiştirilebilen bir ayar değil/);
    assert.match(validateChange('CLAUDE_CODE_OAUTH_TOKEN', '')!, /boş bırakılamaz/);
    assert.equal(validateChange('MCP_TOKEN', ''), null, 'zorunlu olmayan boşaltılabilir');
    assert.match(validateChange('ALERT_WEBHOOK_URL', 'https://x\ninjected=1')!, /tek satır/);
    assert.equal(new Set(SETTINGS.map(s => s.key)).size, SETTINGS.length);
  });

  it('shows secrets only as their last four characters', () => {
    assert.equal(displayValue(settingByKey('MONGO_RO_URI')!, 'mongodb+srv://u:p@host/db'), '…t/db');
    assert.equal(displayValue(settingByKey('MCP_TOKEN')!, 'short'), '••••');
    assert.equal(displayValue(settingByKey('POLL_INTERVAL_MS')!, '120000'), '120000');
    assert.equal(displayValue(settingByKey('MCP_TOKEN')!, ''), null);
  });
});

describe('env files', () => {
  const FILE = '# Ayarlar\nKB_REPO=/a/b\n\n# CLAUDE_CODE_OAUTH_TOKEN=\nGIT_AUTHOR_NAME="NoSurrender AI"\n';

  it('parses like the shell and edits without touching other lines', () => {
    assert.deepEqual(parseEnv(FILE), {KB_REPO: '/a/b', GIT_AUTHOR_NAME: 'NoSurrender AI'});
    const a = setEnvValue(FILE, 'CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant-oat01-abc');
    assert.equal(a, '# Ayarlar\nKB_REPO=/a/b\n\nCLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-abc\nGIT_AUTHOR_NAME="NoSurrender AI"\n', 'yorum satırı yeniden kullanılır');
    const b = setEnvValue(a, 'POLL_INTERVAL_MS', '60000');
    assert.ok(b.endsWith('GIT_AUTHOR_NAME="NoSurrender AI"\nPOLL_INTERVAL_MS=60000\n'));
    assert.equal(setEnvValue(b, 'KB_REPO', null).includes('KB_REPO'), false);
  });

  it('quotes values so that sourcing them in zsh gives back exactly the same string', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envfile-'));
    const tricky = `it's $HOME \`x\` "q" a b;c|d&e`;
    const file = path.join(dir, 'x.env');
    fs.writeFileSync(file, setEnvValue('', 'V', tricky));
    const out = execFileSync('zsh', ['-c', `set -a; source ${file}; printf %s "$V"`], {encoding: 'utf8'});
    assert.equal(out, tricky);
    assert.equal(parseEnv(fs.readFileSync(file, 'utf8')).V.replace(/'\\''/g, "'"), tricky);
    fs.rmSync(dir, {recursive: true});
  });
});

describe('seal', () => {
  it('only the private key opens a value, and tampering is detected', () => {
    const k = generateKeys();
    const sealed = seal('mongodb+srv://u:çok-gizli@host/db', k.publicKey);
    assert.ok(!sealed.includes('gizli'));
    assert.equal(unseal(sealed, k.privateKey), 'mongodb+srv://u:çok-gizli@host/db');
    assert.throws(() => unseal(sealed, generateKeys().privateKey));
    const parts = sealed.split('.');
    parts[4] = Buffer.from('başka').toString('base64url');
    assert.throws(() => unseal(parts.join('.'), k.privateKey));
  });
});
