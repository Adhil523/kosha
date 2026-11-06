import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The showcase is a static site: no server code, deployable as plain files (U01)
  output: 'export',
  // Agent instructions live in docs/agents/; stop `next dev` writing its own AGENTS.md
  agentRules: false,
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
