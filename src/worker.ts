import { Queue } from "bullmq";
import { DraftService } from "./ai/draft.service";
import { LearningService } from "./ai/learning.service";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { DiscoveryService } from "./discovery/discovery.service";
import { DiscordBot } from "./discord/discord.bot";
import { createBullmqConnection } from "./queue/connection";
import { QueueSchedulerService } from "./queue/scheduler";
import { QueueWorkerService } from "./queue/worker";
import { PerformanceClient } from "./reddit/performance.client";
import { RedditClient } from "./reddit/reddit.client";
import { ThreadFilterService } from "./reddit/thread-filter.service";
import { prisma } from "./storage/prisma";

type WorkerRuntimeState = {
  discoveryRuns: number;
  discoveryFailures: number;
  learningRuns: number;
  learningFailures: number;
  weeklyRuns: number;
  weeklyFailures: number;
};

async function bootstrapWorker(): Promise<void> {
  const state: WorkerRuntimeState = {
    discoveryRuns: 0,
    discoveryFailures: 0,
    learningRuns: 0,
    learningFailures: 0,
    weeklyRuns: 0,
    weeklyFailures: 0
  };

  const queueConnection = createBullmqConnection();
  const workerConnection = createBullmqConnection();
  const eventsConnection = createBullmqConnection();

  const queue = new Queue(env.QUEUE_NAME, {
    connection: queueConnection
  });
  const scheduler = new QueueSchedulerService(queue);

  const redditClient = new RedditClient();
  const discordBot = new DiscordBot({
    listenForEvents: false
  });
  const discoveryService = new DiscoveryService(
    redditClient,
    new ThreadFilterService(),
    new DraftService(),
    discordBot
  );
  const learningService = new LearningService();
  const performanceClient = new PerformanceClient(redditClient);

  const worker = new QueueWorkerService(env.QUEUE_NAME, workerConnection, eventsConnection, {
    onDiscoveryRun: async () => {
      try {
        await discoveryService.runCycle();
        state.discoveryRuns += 1;
      } catch (error) {
        state.discoveryFailures += 1;
        throw error;
      }
    },
    onLearningIncremental: async () => {
      try {
        const summary = await learningService.runIncrementalLearning();
        await discordBot.postLearningUpdate(`12h learning update:\n${summary}`);
        state.learningRuns += 1;
      } catch (error) {
        state.learningFailures += 1;
        throw error;
      }
    },
    onLearningWeekly: async () => {
      try {
        await performanceClient.captureSnapshots();
        const digest = await learningService.runWeeklyDigest();
        await discordBot.postLearningUpdate(`Weekly learning digest:\n${digest}`);
        state.weeklyRuns += 1;
      } catch (error) {
        state.weeklyFailures += 1;
        throw error;
      }
    }
  });

  logger.info(
    {
      queueName: env.QUEUE_NAME,
      workerConcurrency: env.WORKER_CONCURRENCY,
      scheduleEnabled: env.ENABLE_JOB_SCHEDULER
    },
    "Starting Haku worker process"
  );

  await prisma.$connect();
  await discoveryService.ensureBootstrapConfig();
  await discordBot.start();
  await worker.start();

  if (env.ENABLE_JOB_SCHEDULER) {
    await scheduler.ensureRepeatableJobs();
  }

  if (env.RUN_STARTUP_DISCOVERY) {
    await scheduler.enqueueDiscoveryNow();
  }

  logger.info("Haku worker process started");

  const shutdown = async (signal: string) => {
    logger.info({ signal, state }, "Shutting down Haku worker process");

    await worker.stop();
    await queue.close();

    await discordBot.stop();
    await prisma.$disconnect();

    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrapWorker().catch((error) => {
  logger.error({ err: error }, "Failed to bootstrap Haku worker process");
  process.exit(1);
});
