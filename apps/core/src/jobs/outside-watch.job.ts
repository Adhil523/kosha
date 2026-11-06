import { type WatcherDeps,watchOutsidePayments } from '../outside-watcher';
import cron from 'node-cron';

export const JOB_NAME = 'outside-watch';
// Every 30 seconds (A19), so a payment made outside Kosha reaches the Console within a minute.
// UTC, though a 30-second interval doesn't depend on the zone.
const SCHEDULE = '*/30 * * * * *';

// Thin by design: the pass lives in outside-watcher.ts. noOverlap skips a tick while the previous
// pass is still reading the Mirror Node, so two passes never flag at once. Returns a stop function.
export const scheduleOutsideWatch = (deps: WatcherDeps): (() => void) => {
  const task = cron.schedule(
    SCHEDULE,
    async () => {
      const report = await watchOutsidePayments(deps);
      if (report.flagged > 0) console.info(`[${JOB_NAME}]: flagged ${report.flagged} payment(s)`);
    },
    { name: JOB_NAME, timezone: 'UTC', noOverlap: true }
  );
  return () => {
    void task.stop();
  };
};
