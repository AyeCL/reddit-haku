import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../config/logger";

export class WeeklyLearningDigestJob {
  private task: ScheduledTask | null = null;

  start(run: () => Promise<void>): void {
    this.task = cron.schedule("0 10 * * 1", async () => {
      logger.info("Running weekly learning digest job");
      await run();
    });
  }

  stop(): void {
    this.task?.stop();
  }
}
