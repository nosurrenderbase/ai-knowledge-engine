/**
 * Values travel from the panel to the server sealed: the panel holds only the
 * public key, the private key stays in work/settings on the server. Hybrid:
 * a fresh AES-256-GCM key per value, wrapped with RSA-OAEP-SHA256.
 */
import {constants, createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes} from 'node:crypto';

export function generateKeys(): {publicKey: string; privateKey: string} {
  return generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: {type: 'spki', format: 'pem'},
    privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
  });
}

/** "v1.<wrapped key>.<iv>.<tag>.<ciphertext>", base64url parts. */
export function seal(value: string, publicKey: string): string {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const wrapped = publicEncrypt({key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256'}, key);
  return ['v1', wrapped, iv, cipher.getAuthTag(), data].map(p => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function unseal(sealed: string, privateKey: string): string {
  const [v, wrapped, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !data) throw new Error('tanınmayan şifreli değer');
  const key = privateDecrypt({key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256'}, Buffer.from(wrapped, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
