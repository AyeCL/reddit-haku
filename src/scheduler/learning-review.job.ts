import cron, { type ScheduledTask } from "node-cron";
import { env } from "../config/env";
import { logger } from "../config/logger";

export class LearningReviewJob {
  private task: ScheduledTask | null = null;

  start(run: () => Promise<void>): void {
    const everyHours = env.LEARNING_REVIEW_INTERVAL_HOURS;
    const expression = `0 */${everyHours} * * *`;
    this.task = cron.schedule(expression, async () => {
      logger.info("Running learning review job");
      await run();
    });
  }

  stop(): void {
    this.task?.stop();
  }
}
