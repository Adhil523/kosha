import { type PrivateKey } from '@hiero-ledger/sdk';
import { accountIdSchema, type AgentIdentity } from '@kosha/shared/ids';
import {
  agentChallengeSchema,
  type AgentRow,
  agentRowSchema,
  type AgentSelfRegister,
  type Credential
} from '@kosha/shared/registry';

// An agent registers itself with Core, or upgrades its record (Level 0 to Level 1 with a
// credential, or a CAIP-10 account to its HCS-14 UAID), without ever holding Kosha's admin token:
// it signs a one-time nonce from GET /v1/agents/challenge with its own account key and posts the
// registration to POST /v1/agents/self (docs/core-api.md, #56).

const OK = 200;
const CREATED = 201;

export type RegisterInput = {
  coreUrl: string;
  identity: AgentIdentity;
  credential?: Credential;
};

export type RegisterFailureReason = 'challenge_unavailable' | 'refused' | 'invalid_response';
export type RegisterResult =
  | { ok: true; data: { status: 'created' | 'updated'; agent: AgentRow } }
  | { ok: false; data: { reason: RegisterFailureReason; status: number; message: string } };

export type RegisterDeps = {
  fetch: typeof fetch;
  accountId: string;
  privateKey: PrivateKey;
};

const fail = (reason: RegisterFailureReason, status: number, message: string): RegisterResult => ({
  ok: false,
  data: { reason, status, message }
});

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const refusalMessage = (payload: unknown): string => {
  if (payload && typeof payload === 'object') {
    const { error, message } = payload as { error?: unknown; message?: unknown };
    return [error, message].filter((part) => typeof part === 'string').join(': ');
  }
  return '';
};

export const registerAgent = async (
  deps: RegisterDeps,
  input: RegisterInput
): Promise<RegisterResult> => {
  const base = input.coreUrl.replace(/\/+$/, '');

  const challengeResponse = await deps.fetch(`${base}/v1/agents/challenge`);
  if (!challengeResponse.ok) {
    return fail('challenge_unavailable', challengeResponse.status, 'Core issued no challenge');
  }
  const challenge = agentChallengeSchema.safeParse(await readJson(challengeResponse));
  if (!challenge.success) {
    return fail('invalid_response', challengeResponse.status, 'the challenge was not readable');
  }

  // The proof of control: the nonce's UTF-8 bytes, signed by the identity account's key
  const nonceBytes = new TextEncoder().encode(challenge.data.nonce);
  const signature = Buffer.from(deps.privateKey.sign(nonceBytes)).toString('hex');
  const body: AgentSelfRegister = {
    identity: input.identity,
    wallets: [accountIdSchema.parse(deps.accountId)],
    challengeNonce: challenge.data.nonce,
    signature,
    ...(input.credential ? { credential: input.credential } : {})
  };

  const response = await deps.fetch(`${base}/v1/agents/self`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await readJson(response);
  if (response.status !== OK && response.status !== CREATED) {
    return fail('refused', response.status, refusalMessage(payload) || 'Core refused');
  }
  const agent = agentRowSchema.safeParse(payload);
  if (!agent.success) {
    return fail('invalid_response', response.status, 'the agent record was not readable');
  }
  return {
    ok: true,
    data: { status: response.status === CREATED ? 'created' : 'updated', agent: agent.data }
  };
};
