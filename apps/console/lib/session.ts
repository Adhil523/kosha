import { WORKSPACE_ORDER, type WorkspaceId } from '@/lib/workspaces';
import { z } from 'zod';

// Demo sign-in: the cookie holds which workspace the viewer picked. There are no accounts.
export const SESSION_COOKIE = 'kosha_demo_role';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const roleSchema = z.enum(WORKSPACE_ORDER as [WorkspaceId, ...WorkspaceId[]]);

export const parseRole = (value: unknown): WorkspaceId | null => {
  const parsed = roleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const isDemoAuthEnabled = (): boolean => process.env.DEMO_AUTH === '1';
