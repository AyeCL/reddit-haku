import { DraftService } from "./ai/draft.service";
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
import { RedditClient } from "./reddit/reddit.client";
import { ThreadFilterService } from "./reddit/thread-filter.service";
import { prisma } from "./storage/prisma";
import { WorkflowService } from "./workflow/workflow.service";

export class App {
  private readonly redditClient = new RedditClient();
  private readonly threadFilterService = new ThreadFilterService();
  private readonly draftService = new DraftService();
  private readonly toolRouter = new ToolRouterService(this.redditClient);
  private readonly approvalService = new ApprovalService();
  private readonly postingService = new PostingService(this.redditClient);
  private readonly postingMemoryService = new PostingMemoryService();
  private readonly mentionCommandService = new MentionCommandService();
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
      handlers: {
        onMention: async (message) => {
          await this.workflowService.handleMention(message);
        },
        onReply: async (input) => {
          await this.workflowService.handleReply(input);
        },
        onReaction: async (input) => {
          await this.workflowService.handleReaction(input);
        }
      },
      listenForEvents: true
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
        queueName: env.QUEUE_NAME
      },
      "Starting Haku app process"
    );

    await prisma.$connect();
    this.runtimeState.dbConnected = true;

    await this.healthServer.start();
    await this.discoveryService.ensureBootstrapConfig();
    await this.discordBot.start();

    logger.info("Haku app process started");
  }

  async stop(): Promise<void> {
    await this.discordBot.stop();
    await this.healthServer.stop();
    await prisma.$disconnect();
    this.runtimeState.dbConnected = false;
  }
}
