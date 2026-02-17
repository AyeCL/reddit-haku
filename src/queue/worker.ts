import { QueueEvents, Worker, type ConnectionOptions, type Job } from "bullmq";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { JobName } from "./jobs";

export type QueueJobHandlers = {
  onDiscoveryRun: () => Promise<void>;
  onLearningIncremental: () => Promise<void>;
  onLearningWeekly: () => Promise<void>;
};

export class QueueWorkerService {
  private worker: Worker | null = null;
  private events: QueueEvents | null = null;

  constructor(
    private readonly queueName: string,
    private readonly workerConnection: ConnectionOptions,
    private readonly eventsConnection: ConnectionOptions,
    private readonly handlers: QueueJobHandlers
  ) {}

  async start(): Promise<void> {
    this.worker = new Worker(
      this.queueName,
      async (job: Job) => {
        switch (job.name) {
          case JobName.DiscoveryRun:
            await this.handlers.onDiscoveryRun();
            return;
          case JobName.LearningIncremental:
            await this.handlers.onLearningIncremental();
            return;
          case JobName.LearningWeekly:
            await this.handlers.onLearningWeekly();
            return;
          default:
            logger.warn({ jobName: job.name }, "Received unknown queue job");
        }
      },
      {
        connection: this.workerConnection,
        concurrency: env.WORKER_CONCURRENCY
      }
    );

    this.worker.on("failed", (job, error) => {
      logger.error({ jobName: job?.name, jobId: job?.id, err: error }, "Queue job failed");
    });

    this.worker.on("completed", (job) => {
      logger.info({ jobName: job.name, jobId: job.id }, "Queue job completed");
    });

    this.events = new QueueEvents(this.queueName, {
      connection: this.eventsConnection
    });

    await this.events.waitUntilReady();
    logger.info(
      { queueName: this.queueName, concurrency: env.WORKER_CONCURRENCY },
      "Queue worker started"
    );
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    await this.events?.close();
    this.worker = null;
    this.events = null;
  }
}
