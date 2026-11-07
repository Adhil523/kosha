# @kosha/site

The public showcase site for Kosha (U01): what it does, how a payment flows, the four products,
and links to the evidence. It is a static Next.js export with no server code; it reads nothing
from Core.

```bash
pnpm --filter @kosha/site dev     # port 3100
pnpm --filter @kosha/site build   # static files in apps/site/out/
```

Every external link lives in [`content/links.ts`](content/links.ts). A `null` link renders as
"coming soon"; filling one in later is a one-file change.

## Deploy (Vercel)

Vercel reads [`vercel.json`](vercel.json): the Next.js preset, which sees `output: 'export'` and
serves the pages as static files. Leave the output directory unset. Vercel reads Next's build
metadata from `.next/`, so pointing it at `out/` fails with `NEXT_NO_ROUTES_MANIFEST`, and a
`null` framework fails the same way because Vercel still detects Next.js. No environment variables
are needed. From the repo root:

```bash
vercel link --cwd apps/site
vercel deploy --cwd apps/site --prod
```

Set the project's root directory to `apps/site` in the Vercel dashboard so the monorepo install
runs from the workspace root.
