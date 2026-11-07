import { createArkivReader, createArkivWriter } from '@kosha/arkiv/arkiv-clients';
import { koshaTermsSchema, toListings } from '@kosha/arkiv/listing';
import { ARKIV_EXPLORER_URL } from '@kosha/arkiv/listing-schema';
import { findExistingListings, planPublish, publishListings } from '@kosha/arkiv/publish-listings';
import { loadEnv } from '@kosha/shared/env';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';

// `pnpm arkiv:publish [source[=listed] ...]`: reads each Kosha-protected API's terms from
// /.well-known/kosha and writes one Arkiv listing per priced route, owned by ARKIV_PRIVATE_KEY's
// address. Re-running it refreshes the listings and renews their week-long lifetime, and removes
// routes the API no longer prices. `listed` is the URL agents should call, when the terms are read
// from somewhere else (e.g. a local run of an API that is deployed elsewhere).

const TERMS_PATH = '/.well-known/kosha';
const DEFAULT_SOURCES = ['http://localhost:4101', 'http://localhost:4102'];

export const arkivPublishEnvSchema = z.object({
  ARKIV_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  ARKIV_ACCESS_KEY: z.string().default('')
});

export type ApiSource = { termsUrl: string; listedUrl: string };

// "http://localhost:4101=https://api.example.com" reads from the first and lists the second
export const parseSource = (arg: string): ApiSource => {
  const [termsUrl = '', listedUrl] = arg.split('=');
  return { termsUrl, listedUrl: listedUrl ?? termsUrl };
};

export const explorerTx = (hash: Hex): string => `${ARKIV_EXPLORER_URL}/tx/${hash}`;

const fetchTerms = async (termsUrl: string) => {
  const response = await fetch(new URL(TERMS_PATH, termsUrl));
  if (!response.ok) throw new Error(`${termsUrl}${TERMS_PATH} answered ${response.status}`);
  return koshaTermsSchema.parse(await response.json());
};

const main = async (): Promise<void> => {
  loadEnv();
  const env = arkivPublishEnvSchema.safeParse(process.env);
  if (!env.success) {
    throw new Error('set ARKIV_PRIVATE_KEY in .env (a 0x-prefixed 32-byte hex key)');
  }
  const privateKey = env.data.ARKIV_PRIVATE_KEY as Hex;
  const owner = privateKeyToAccount(privateKey).address;
  const reader = createArkivReader(env.data.ARKIV_ACCESS_KEY);
  const writer = createArkivWriter(privateKey, env.data.ARKIV_ACCESS_KEY);
  const args = process.argv.slice(2);
  const sources = (args.length > 0 ? args : DEFAULT_SOURCES).map(parseSource);

  console.info(`[arkiv-publish]: writing as ${owner}`);
  for (const source of sources) {
    const listings = toListings(source.listedUrl, await fetchTerms(source.termsUrl));
    if (!listings.ok) throw new Error(`${listings.data.apiUrl} is too long to list`);
    const apiUrl = source.listedUrl.replace(/\/+$/, '');
    const plan = planPublish(listings.data, await findExistingListings(reader, owner, apiUrl));
    const receipt = await publishListings(writer, plan);
    console.info(
      `[arkiv-publish]: ${apiUrl}: ${receipt.createdKeys.length} created, ` +
        `${receipt.patchedKeys.length} refreshed, ${receipt.deletedKeys.length} removed`
    );
    for (const key of [...receipt.createdKeys, ...receipt.patchedKeys]) {
      console.info(`[arkiv-publish]:   entity ${key}`);
    }
    if (receipt.writeTxHash) console.info(`[arkiv-publish]:   ${explorerTx(receipt.writeTxHash)}`);
    if (receipt.renewTxHash) console.info(`[arkiv-publish]:   ${explorerTx(receipt.renewTxHash)}`);
  }
};

const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url);
};

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    console.error('[arkiv-publish]: failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
