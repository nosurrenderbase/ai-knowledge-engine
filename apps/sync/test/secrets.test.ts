import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {findSecrets, isTcKimlik} from '../src/secrets.ts';

describe('isTcKimlik', () => {
  it('accepts numbers with valid check digits', () => {
    assert.equal(isTcKimlik('10000000146'), true);
  });

  it('rejects wrong check digits, a leading zero and wrong lengths', () => {
    assert.equal(isTcKimlik('10000000147'), false);
    assert.equal(isTcKimlik('01234567890'), false);
    assert.equal(isTcKimlik('1234567890'), false);
  });
});

describe('findSecrets', () => {
  const cases: [string, string][] = [
    ['MONGODB_URI=mongodb+srv://user:pw@cluster0.example.net/db', 'bağlantı adresi'],
    ['redis://default:pw@host:6379', 'bağlantı adresi'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'özel anahtar'],
    ['anahtar AKIAABCDEFGHIJKLMNOP', 'AWS erişim anahtarı'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123', 'GitHub token'],
    ['sk-ant-api03-abcdefghijklmnopqrstuv', 'Anthropic anahtarı'],
    ['xoxb-1234567890-abcdef', 'Slack token'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijklmnop', 'JWT'],
    ['password: "hunter2hunter2"', 'parola ataması'],
    ['iletişim: ahmet.yilmaz@example.com', 'e-posta'],
    ['sunucu 10.12.3.4 adresinde', 'IP adresi'],
    ['TC: 10000000146', 'TC kimlik numarası'],
  ];
  for (const [line, kind] of cases) {
    it(`flags ${kind}`, () => assert.ok(findSecrets(line).includes(kind), findSecrets(line).join()));
  }

  it('leaves ordinary documentation alone', () => {
    for (const line of [
      'Davetli 500.000 LD alır; davet eden 6 × saatlik gelir (en az 300.000 LD).',
      'Env değişkeni `MONGODB_URI` ana veritabanı bağlantısıdır.',
      'Sürüm v1.2.3.4 ve curlimages/curl:8.10.1 imajı; yerel adres 127.0.0.1.',
      'Hata kodu `PVP_DAILY_LIMIT_REACHED`, süre 86400000 ms, tutar 10000000000.',
      'password alanı loglardan silinir.',
    ]) {
      assert.deepEqual(findSecrets(line), [], line);
    }
  });
});
