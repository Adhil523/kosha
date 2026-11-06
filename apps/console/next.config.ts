import { loadEnv } from '@kosha/shared/env';
import type { NextConfig } from 'next';

// The shared env (Core URL, admin token, Mirror Node, token and topic IDs) lives at the repo root;
// Next.js only reads .env files next to this config. Process variables still win.
loadEnv();

const nextConfig: NextConfig = {
  // Internal packages export TypeScript source (PROTOCOL §2)
  transpilePackages: ['@kosha/shared'],
  // Agent instructions live in docs/agents/; stop `next dev` writing its own AGENTS.md
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css'
      }
    }
  }
};

export default nextConfig;
