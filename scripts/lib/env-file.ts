import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const ENV_FILE_NAME = '.env';
const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
// Generated values are IDs, DER hex, base64url and UAIDs (which carry `;`); anything needing
// quotes is refused, not escaped
const SAFE_VALUE_PATTERN = /^[A-Za-z0-9._:/+=;-]*$/;

export type EnvValues = Record<string, string | undefined>;
export type EnvFile = { path: string; values: EnvValues };

export type EnvFileRead =
  { ok: true; data: EnvFile } | { ok: false; data: { reason: 'env_file_missing'; path: string } };

export type EnvFileWrite =
  | { ok: true; data: { updated: string[]; appended: string[] } }
  | { ok: false; data: { reason: 'invalid_key' | 'unsafe_value'; key: string } };

// `.env` is a symlink to the shared file outside both checkouts; writes go to the real file so
// the other checkout sees them, and the link itself is never replaced.
export const readEnvFile = (root: string): EnvFileRead => {
  const linkPath = join(root, ENV_FILE_NAME);
  if (!existsSync(linkPath))
    return { ok: false, data: { reason: 'env_file_missing', path: linkPath } };
  const path = realpathSync(linkPath);
  return { ok: true, data: { path, values: parseEnv(readFileSync(path, 'utf8')) } };
};

// Sets each key in place (keeping comments and order) and appends keys the file lacks.
// Never logs values; callers print only the returned key names.
export const writeEnvValues = (path: string, updates: Record<string, string>): EnvFileWrite => {
  for (const [key, value] of Object.entries(updates)) {
    if (!KEY_PATTERN.test(key)) return { ok: false, data: { reason: 'invalid_key', key } };
    if (!SAFE_VALUE_PATTERN.test(value))
      return { ok: false, data: { reason: 'unsafe_value', key } };
  }

  const pending = new Map(Object.entries(updates));
  const updated: string[] = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  const rewritten = lines.map((line) => {
    const key = line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1];
    const value = key === undefined ? undefined : pending.get(key);
    if (key === undefined || value === undefined) return line;
    pending.delete(key);
    updated.push(key);
    return `${key}=${value}`;
  });

  const appended = [...pending.keys()];
  if (appended.length > 0) {
    if (rewritten.at(-1) === '') rewritten.pop();
    rewritten.push(...appended.map((key) => `${key}=${pending.get(key) ?? ''}`), '');
  }

  // Write beside the file and rename, so a crash never leaves a half-written env file
  const tempPath = `${path}.tmp-${process.pid}`;
  writeFileSync(tempPath, rewritten.join('\n'), { mode: statSync(path).mode });
  renameSync(tempPath, path);
  return { ok: true, data: { updated, appended } };
};

// Treats an empty string like an unset key, matching `KEY=` lines in .env.example
export const hasValue = (values: EnvValues, key: string): boolean =>
  (values[key] ?? '').trim() !== '';
