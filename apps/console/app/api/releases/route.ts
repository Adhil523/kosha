import { getReceiverReleases } from '@/lib/close.server';
import { RECEIVER_VIEWERS, requireWorkspace } from '@/lib/route-guard.server';

// Every reserve release this receiver is owed, with its status
export const GET = async () => {
  const denied = await requireWorkspace(RECEIVER_VIEWERS);
  if (denied) return denied;
  const releases = await getReceiverReleases();
  return Response.json(releases.data, { status: releases.ok ? 200 : releases.status || 502 });
};
