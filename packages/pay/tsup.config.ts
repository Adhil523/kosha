import { defineConfig } from 'tsup';

const INTERNAL = /^@kosha\//;

// Builds the published package. Inside the workspace, consumers import the TypeScript source.
export default defineConfig({
  entry: [
    'src/kosha-pay.ts',
    'src/kosha-split-scheme.ts',
    'src/spend-store.ts',
    'src/agent-kit-plugin.ts'
  ],
  format: ['esm', 'cjs'],
  // Inline the internal packages' types too: they are never published on their own. tsup's type
  // resolver ignores package `exports`, so the subpaths are mapped by hand.
  dts: {
    resolve: [INTERNAL],
    compilerOptions: {
      // tsup 8 sets baseUrl for the declaration build, which TypeScript 6 deprecates
      ignoreDeprecations: '6.0',
      paths: {
        '@kosha/hedera/*': ['../hedera/src/*.ts'],
        '@kosha/shared/*': ['../shared/src/*.ts'],
        '@kosha/tax-engine/*': ['../tax-engine/src/*.ts']
      }
    }
  },
  // The internal packages are bundled in; the SDK, x402, zod and the optional Agent Kit stay the
  // user's dependencies
  noExternal: [INTERNAL],
  external: ['@hiero-ledger/sdk', '@x402/core', 'zod', '@hashgraph/hedera-agent-kit'],
  target: 'node24',
  clean: true,
  sourcemap: true
});
