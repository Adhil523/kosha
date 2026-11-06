import type { NextConfig } from 'next';

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
