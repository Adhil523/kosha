import { createPublicClient, createWalletClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { type Hex, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Reads need no wallet, so this client is safe in a browser. An empty access key uses Rabdi's
// public endpoint, which is heavily rate limited.
export const createArkivReader = (accessKey: string) =>
  createPublicClient({ chain: rabdi({ accessKey }), transport: http() });

export const createArkivWriter = (privateKey: Hex, accessKey: string) =>
  createWalletClient({
    chain: rabdi({ accessKey }),
    transport: http(),
    account: privateKeyToAccount(privateKey)
  });
