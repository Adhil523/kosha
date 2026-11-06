import { hasValue, readEnvFile, writeEnvValues } from './env-file';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const SHARED_ENV = [
  '# --- Hedera ---',
  'CORE_ACCOUNT_ID=0.0.1001',
  'SETTLEMENT_TOKEN_ID=',
  ''
].join('\n');

let dir: string;
let sharedPath: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'kosha-env-')));
  sharedPath = join(dir, 'kosha.env');
  writeFileSync(sharedPath, SHARED_ENV, { mode: 0o600 });
});

// Mirrors PROTOCOL §10: the checkout's .env links to the shared file outside it
const linkCheckout = () => {
  const checkout = mkdtempSync(join(dir, 'checkout-'));
  symlinkSync(sharedPath, join(checkout, '.env'));
  return checkout;
};

describe('readEnvFile', () => {
  it('follows the .env symlink to the shared file', () => {
    const checkout = linkCheckout();
    const read = readEnvFile(checkout);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.path).toBe(sharedPath);
    expect(read.data.values.CORE_ACCOUNT_ID).toBe('0.0.1001');
  });

  it('reports a missing .env', () => {
    const read = readEnvFile(mkdtempSync(join(dir, 'empty-')));
    expect(read).toMatchObject({ ok: false, data: { reason: 'env_file_missing' } });
  });
});

describe('writeEnvValues', () => {
  it('fills empty keys in place and appends new ones, keeping comments', () => {
    const write = writeEnvValues(sharedPath, { SETTLEMENT_TOKEN_ID: '0.0.5005', NEW_KEY: 'abc' });
    expect(write).toEqual({
      ok: true,
      data: { updated: ['SETTLEMENT_TOKEN_ID'], appended: ['NEW_KEY'] }
    });
    expect(readFileSync(sharedPath, 'utf8')).toBe(
      [
        '# --- Hedera ---',
        'CORE_ACCOUNT_ID=0.0.1001',
        'SETTLEMENT_TOKEN_ID=0.0.5005',
        'NEW_KEY=abc',
        ''
      ].join('\n')
    );
  });

  it('writes through the symlink and keeps the link and file mode', () => {
    const checkout = linkCheckout();
    const read = readEnvFile(checkout);
    if (!read.ok) throw new Error('expected the env file');
    writeEnvValues(read.data.path, { SETTLEMENT_TOKEN_ID: '0.0.5005' });
    expect(lstatSync(join(checkout, '.env')).isSymbolicLink()).toBe(true);
    expect(statSync(sharedPath).mode & 0o777).toBe(0o600);
    expect(readEnvFile(checkout)).toMatchObject({
      ok: true,
      data: { values: { SETTLEMENT_TOKEN_ID: '0.0.5005' } }
    });
  });

  it('refuses values that would need quoting, without writing anything', () => {
    const write = writeEnvValues(sharedPath, { SETTLEMENT_TOKEN_ID: 'has space' });
    expect(write).toEqual({
      ok: false,
      data: { reason: 'unsafe_value', key: 'SETTLEMENT_TOKEN_ID' }
    });
    expect(readFileSync(sharedPath, 'utf8')).toBe(SHARED_ENV);
  });

  it('refuses malformed keys', () => {
    expect(writeEnvValues(sharedPath, { 'bad-key': 'x' })).toMatchObject({
      ok: false,
      data: { reason: 'invalid_key' }
    });
  });
});

describe('hasValue', () => {
  it('treats an empty or blank value as unset', () => {
    expect(hasValue({ A: '', B: '  ', C: 'x' }, 'A')).toBe(false);
    expect(hasValue({ A: '', B: '  ', C: 'x' }, 'B')).toBe(false);
    expect(hasValue({ A: '', B: '  ', C: 'x' }, 'C')).toBe(true);
    expect(hasValue({}, 'D')).toBe(false);
  });
});
