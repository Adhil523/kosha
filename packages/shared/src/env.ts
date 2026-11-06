import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

// Later files override earlier ones. Variables already set in the process override both.
const ENV_FILES = ['.env', '.env.local'] as const;

export type LoadEnvResult =
  | { ok: true; data: { root: string; loadedFiles: string[] } }
  | { ok: false; data: { reason: 'repo_root_not_found'; searchedFrom: string } };

export const findRepoRoot = (from: string): string | undefined => {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) {
      return dir;
    }
    if (dirname(dir) === dir) {
      return undefined;
    }
  }
};

export const loadEnv = ({
  cwd = process.cwd(),
  target = process.env
}: { cwd?: string; target?: NodeJS.ProcessEnv } = {}): LoadEnvResult => {
  const root = findRepoRoot(cwd);
  if (!root) {
    return { ok: false, data: { reason: 'repo_root_not_found', searchedFrom: cwd } };
  }

  const loadedFiles: string[] = [];
  const fromFiles: Record<string, string> = {};
  for (const name of ENV_FILES) {
    const path = join(root, name);
    if (!existsSync(path)) {
      continue;
    }
    Object.assign(fromFiles, parseEnv(readFileSync(path, 'utf8')));
    loadedFiles.push(path);
  }

  for (const [key, value] of Object.entries(fromFiles)) {
    if (target[key] === undefined) {
      target[key] = value;
    }
  }

  return { ok: true, data: { root, loadedFiles } };
};
