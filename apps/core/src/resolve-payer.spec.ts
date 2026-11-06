import type { DbHandle } from './db/client';
import { agent, agentWallet } from './db/schema';
import { testDb } from './db/test-db';
import { createPayerResolver, type ReserveFactory } from './resolve-payer';
import { agentIdentitySchema } from '@kosha/shared/ids';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const id = (text: string) => agentIdentitySchema.parse(text);

describe('createPayerResolver', () => {
  let handle: DbHandle;
  let created: string[];
  const factory: ReserveFactory = async (account) => {
    created.push(account);
    return `0.0.9${created.length}`;
  };

  beforeEach(async () => {
    handle = await testDb();
    created = [];
  });

  afterEach(async () => {
    await handle.close();
  });

  it('registers an unknown account at Level 0 and creates its reserve once, even concurrently', async () => {
    const resolve = createPayerResolver(handle.db, factory);
    const identity = id('hedera:testnet:0.0.6003');

    const results = await Promise.all([resolve(identity), resolve(identity), resolve(identity)]);

    expect(created).toEqual(['0.0.6003']);
    for (const result of results) {
      expect(result).toMatchObject({
        ok: true,
        data: { level: 0, residency: 'unknown', panOnFile: false, reserveAccountId: '0.0.91' }
      });
    }
    const wallets = await handle.db.select().from(agentWallet);
    expect(wallets.map((wallet) => wallet.accountID)).toEqual(['0.0.6003']);
  });

  it('uses a registered agent’s reserve without creating another', async () => {
    const [row] = await handle.db
      .insert(agent)
      .values({
        identity: 'hedera:testnet:0.0.6001',
        level: 1,
        residency: 'resident',
        panOnFile: true,
        reserveAccountID: '0.0.6101'
      })
      .returning();
    const resolve = createPayerResolver(handle.db, factory);

    expect(await resolve(id('hedera:testnet:0.0.6001'))).toEqual({
      ok: true,
      data: {
        agentId: row?.id,
        level: 1,
        residency: 'resident',
        panOnFile: true,
        reserveAccountId: '0.0.6101'
      }
    });
    expect(created).toEqual([]);
  });

  it('creates a reserve for a registered agent that has none, from its first wallet', async () => {
    const uaid =
      'uaid:aid:7Hq3JX9;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0.0.6002';
    const [row] = await handle.db
      .insert(agent)
      .values({ identity: uaid, level: 1, residency: 'non_resident' })
      .returning();
    await handle.db.insert(agentWallet).values({ agentID: row?.id ?? '', accountID: '0.0.6002' });

    const result = await createPayerResolver(handle.db, factory)(id(uaid));

    expect(created).toEqual(['0.0.6002']);
    expect(result.ok && result.data.reserveAccountId).toBe('0.0.91');
    const [saved] = await handle.db
      .select()
      .from(agent)
      .where(eq(agent.id, row?.id ?? ''));
    expect(saved?.reserveAccountID).toBe('0.0.91');
  });

  it('finds an agent that moved to a UAID by its old CAIP-10 identity, and the reverse', async () => {
    const uaid = 'uaid:aid:z6Mk6001;uid=0;nativeId=hedera:testnet:0.0.6001';
    const [row] = await handle.db
      .insert(agent)
      .values({ identity: uaid, level: 1, residency: 'resident', reserveAccountID: '0.0.6101' })
      .returning();
    await handle.db.insert(agentWallet).values({ agentID: row?.id ?? '', accountID: '0.0.6001' });
    const resolve = createPayerResolver(handle.db, factory);

    const byAccount = await resolve(id('hedera:testnet:0.0.6001'));
    expect(byAccount).toMatchObject({ ok: true, data: { agentId: row?.id, level: 1 } });
    expect(await handle.db.select().from(agent)).toHaveLength(1);
    expect(created).toEqual([]);
  });

  it('refuses an unregistered UAID', async () => {
    const result = await createPayerResolver(
      handle.db,
      factory
    )(id('uaid:aid:unknown;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0.0.6099'));
    expect(result).toMatchObject({ ok: false, data: { error: 'payer_not_declared' } });
  });

  it('reports the network refusing to create a reserve', async () => {
    const result = await createPayerResolver(
      handle.db,
      async () => null
    )(id('hedera:testnet:0.0.6004'));
    expect(result).toMatchObject({ ok: false, data: { error: 'core_unavailable' } });
  });
});
