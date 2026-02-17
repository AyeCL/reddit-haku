import cron, { type ScheduledTask } from "node-cron";
import { env } from "../config/env";
import { logger } from "../config/logger";

export class DiscoveryJob {
  private task: ScheduledTask | null = null;

  start(run: () => Promise<void>): void {
    const expression = `*/${env.DISCOVERY_INTERVAL_MINUTES} * * * *`;
    this.task = cron.schedule(expression, async () => {
      logger.info("Running discovery job");
      await run();
    });
  }

  stop(): void {
    this.task?.stop();
  }
}
