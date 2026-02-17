import { Queue } from "bullmq";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { JobName, RepeatJobId } from "./jobs";

export class QueueSchedulerService {
  constructor(private readonly queue: Queue) {}

  async ensureRepeatableJobs(): Promise<void> {
    await this.queue.upsertJobScheduler(
      RepeatJobId.DiscoveryRun,
      {
        every: env.DISCOVERY_INTERVAL_MINUTES * 60_000
      },
      {
        name: JobName.DiscoveryRun,
        data: {},
        opts: {
          removeOnComplete: true,
          removeOnFail: false
        }
      }
    );

    await this.queue.upsertJobScheduler(
      RepeatJobId.LearningIncremental,
      {
        every: env.LEARNING_REVIEW_INTERVAL_HOURS * 3_600_000
      },
      {
        name: JobName.LearningIncremental,
        data: {},
        opts: {
          removeOnComplete: true,
          removeOnFail: false
        }
      }
    );

    if (env.ENABLE_WEEKLY_LEARNING_DIGEST) {
      await this.queue.upsertJobScheduler(
        RepeatJobId.LearningWeekly,
        {
          pattern: "0 10 * * 1",
          tz: env.APP_TIMEZONE
        },
        {
          name: JobName.LearningWeekly,
          data: {},
          opts: {
            removeOnComplete: true,
            removeOnFail: false
          }
        }
      );
    }

    logger.info(
      {
        queueName: this.queue.name,
        discoveryMinutes: env.DISCOVERY_INTERVAL_MINUTES,
        learningHours: env.LEARNING_REVIEW_INTERVAL_HOURS,
        weeklyEnabled: env.ENABLE_WEEKLY_LEARNING_DIGEST
      },
      "Ensured BullMQ repeatable jobs"
    );
  }

  async enqueueDiscoveryNow(): Promise<void> {
    await this.queue.add(JobName.DiscoveryRun, {}, { removeOnComplete: true, removeOnFail: false });
  }
}
