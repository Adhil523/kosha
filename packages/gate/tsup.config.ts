import { defineConfig } from 'tsup';

// Builds the published package. Inside the workspace, consumers import the TypeScript source.
export default defineConfig({
  entry: ['src/express-middleware.ts', 'src/gate-handler.ts'],
  format: ['esm', 'cjs'],
  // Inline @kosha/shared's types too: it is never published on its own. tsup's type resolver
  // ignores package `exports`, so the subpaths are mapped by hand.
  dts: {
    resolve: [/^@kosha\//],
    compilerOptions: {
      // tsup 8 sets baseUrl for the declaration build, which TypeScript 6 deprecates
      ignoreDeprecations: '6.0',
      paths: { '@kosha/shared/*': ['../shared/src/*.ts'] }
    }
  },
  // @kosha/shared is bundled in; zod and express stay the user's dependencies
  noExternal: [/^@kosha\//],
  external: ['express', 'zod'],
  target: 'node24',
  clean: true,
  sourcemap: true
});
