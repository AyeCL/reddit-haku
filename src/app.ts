import { DraftService } from "./ai/draft.service";
import { LearningService } from "./ai/learning.service";
import { ToolRouterService } from "./ai/tool-router.service";
import { ApprovalService } from "./approval/approval.service";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { DiscoveryService } from "./discovery/discovery.service";
import { DiscordBot } from "./discord/discord.bot";
import { MentionCommandService } from "./discord/mention-command.service";
import { HealthServer, type RuntimeState } from "./monitoring/health.server";
import { PostingMemoryService } from "./posting/posting-memory.service";
import { PostingService } from "./posting/posting.service";
import { PerformanceClient } from "./reddit/performance.client";
import { RedditClient } from "./reddit/reddit.client";
import { ThreadFilterService } from "./reddit/thread-filter.service";
import { DiscoveryJob } from "./scheduler/discovery.job";
import { LearningReviewJob } from "./scheduler/learning-review.job";
import { WeeklyLearningDigestJob } from "./scheduler/weekly-learning-digest.job";
import { prisma } from "./storage/prisma";
import { WorkflowService } from "./workflow/workflow.service";

export class App {
  private readonly redditClient = new RedditClient();
  private readonly performanceClient = new PerformanceClient(this.redditClient);
  private readonly threadFilterService = new ThreadFilterService();
  private readonly draftService = new DraftService();
  private readonly learningService = new LearningService();
  private readonly toolRouter = new ToolRouterService(this.redditClient);
  private readonly approvalService = new ApprovalService();
  private readonly postingService = new PostingService(this.redditClient);
  private readonly postingMemoryService = new PostingMemoryService();
  private readonly mentionCommandService = new MentionCommandService();
  private readonly discoveryJob = new DiscoveryJob();
  private readonly learningReviewJob = new LearningReviewJob();
  private readonly weeklyDigestJob = new WeeklyLearningDigestJob();
  private readonly runtimeState: RuntimeState = {
    startedAt: new Date().toISOString(),
    dbConnected: false,
    discordReady: false,
    discoveryRuns: 0,
    discoveryFailures: 0,
    learningRuns: 0,
    learningFailures: 0,
    weeklyRuns: 0,
    weeklyFailures: 0,
    lastDiscoveryRunAt: null,
    lastLearningRunAt: null,
    lastWeeklyRunAt: null
  };
  private readonly healthServer: HealthServer;
  private readonly discordBot: DiscordBot;
  private readonly discoveryService: DiscoveryService;
  private readonly workflowService: WorkflowService;

  constructor() {
    this.discordBot = new DiscordBot({
      onMention: async (message) => {
        await this.workflowService.handleMention(message);
      },
      onReply: async (input) => {
        await this.workflowService.handleReply(input);
      },
      onReaction: async (input) => {
        await this.workflowService.handleReaction(input);
      }
    });

    this.discoveryService = new DiscoveryService(
      this.redditClient,
      this.threadFilterService,
      this.draftService,
      this.discordBot
    );

    this.workflowService = new WorkflowService(
      this.discordBot,
      this.draftService,
      this.toolRouter,
      this.mentionCommandService,
      this.approvalService,
      this.postingService,
      this.postingMemoryService
    );

    this.healthServer = new HealthServer(() => ({
      ...this.runtimeState,
      discordReady: this.discordBot.isReady()
    }));
  }

  async start(): Promise<void> {
    logger.info(
      {
        dryRun: env.DRY_RUN,
        deployTarget: env.DEPLOY_TARGET,
        focusSubreddits: env.FOCUS_SUBREDDITS
      },
      "Starting Haku"
    );

    await prisma.$connect();
    this.runtimeState.dbConnected = true;
    await this.healthServer.start();
    await this.discoveryService.ensureBootstrapConfig();
    await this.discordBot.start();
    await this.runDiscoveryCycle();

    this.discoveryJob.start(async () => {
      await this.runDiscoveryCycle();
    });

    this.learningReviewJob.start(async () => {
      await this.runLearningCycle();
    });

    if (env.ENABLE_WEEKLY_LEARNING_DIGEST) {
      this.weeklyDigestJob.start(async () => {
        await this.runWeeklyDigestCycle();
      });
    }

    logger.info("Haku started");
  }

  async stop(): Promise<void> {
    this.discoveryJob.stop();
    this.learningReviewJob.stop();
    this.weeklyDigestJob.stop();

    await this.discordBot.stop();
    await this.healthServer.stop();
    await prisma.$disconnect();
    this.runtimeState.dbConnected = false;
  }

  private async runDiscoveryCycle(): Promise<void> {
    try {
      await this.discoveryService.runCycle();
      this.runtimeState.discoveryRuns += 1;
      this.runtimeState.lastDiscoveryRunAt = new Date().toISOString();
    } catch (error) {
      this.runtimeState.discoveryFailures += 1;
      logger.error({ err: error }, "Discovery cycle failed");
    }
  }

  private async runLearningCycle(): Promise<void> {
    try {
      const summary = await this.learningService.runIncrementalLearning();
      await this.discordBot.postLearningUpdate(`12h learning update:\n${summary}`);
      this.runtimeState.learningRuns += 1;
      this.runtimeState.lastLearningRunAt = new Date().toISOString();
    } catch (error) {
      this.runtimeState.learningFailures += 1;
      logger.error({ err: error }, "Learning review cycle failed");
    }
  }

  private async runWeeklyDigestCycle(): Promise<void> {
    try {
      await this.performanceClient.captureSnapshots();
      const digest = await this.learningService.runWeeklyDigest();
      await this.discordBot.postLearningUpdate(`Weekly learning digest:\n${digest}`);
      this.runtimeState.weeklyRuns += 1;
      this.runtimeState.lastWeeklyRunAt = new Date().toISOString();
    } catch (error) {
      this.runtimeState.weeklyFailures += 1;
      logger.error({ err: error }, "Weekly digest cycle failed");
    }
  }
}
