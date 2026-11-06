import { type PrepareDeps, prepareMonthlyClose } from '../close-prepare';
import cron from 'node-cron';

export const JOB_NAME = 'monthly-close';
// 01:00 UTC on the 1st is 06:30 IST: the IST month has ended, so its payments are final (A20)
const SCHEDULE = '0 1 1 * *';

// Thin by design: the close lives in close-prepare.ts. Returns a stop function.
export const scheduleMonthlyClose = (deps: PrepareDeps): (() => void) => {
  const task = cron.schedule(
    SCHEDULE,
    async () => {
      const report = await prepareMonthlyClose(deps);
      console.info(
        `[${JOB_NAME}]: ${report.month} closed for ${report.awaitingChallan} of ${report.receivers} receiver(s)`
      );
    },
    { name: JOB_NAME, timezone: 'UTC', noOverlap: true }
  );
  return () => {
    void task.stop();
  };
};
