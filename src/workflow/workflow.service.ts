import type { Message } from "discord.js";
import { prisma } from "../storage/prisma";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { DraftService } from "../ai/draft.service";
import { ToolRouterService } from "../ai/tool-router.service";
import { ApprovalService } from "../approval/approval.service";
import { DiscordBot, type DiscordReactionInput, type DiscordReplyInput } from "../discord/discord.bot";
import { MentionCommandService } from "../discord/mention-command.service";
import { formatCandidateMessage } from "../discord/message-format";
import { PostingMemoryService } from "../posting/posting-memory.service";
import { PostingService } from "../posting/posting.service";

export class WorkflowService {
  constructor(
    private readonly discordBot: DiscordBot,
    private readonly draftService: DraftService,
    private readonly toolRouterService: ToolRouterService,
    private readonly mentionCommandService: MentionCommandService,
    private readonly approvalService: ApprovalService,
    private readonly postingService: PostingService,
    private readonly postingMemoryService: PostingMemoryService
  ) {}

  async handleMention(message: Message): Promise<void> {
    const commandText = this.mentionCommandService.extractCommandText(message);
    const context = await this.mentionCommandService.getContextWindow(message);

    const isApprover = this.approvalService.isApprover(message.author.id);
    const route = await this.toolRouterService.route({
      commandText,
      isApprover
    });

    const commandEvent = await prisma.discordCommandEvent.create({
      data: {
        discordUserId: message.author.id,
        channelId: message.channelId,
        messageId: message.id,
        commandText,
        actionType: route.actionType,
        resultSummary: route.summary.slice(0, 4000)
      }
    });

    if (context.length > 0) {
      await prisma.discordContextMessage.createMany({
        data: context.map((item) => ({
          commandEventId: commandEvent.id,
          channelId: item.channelId,
          messageId: item.id,
          authorId: item.author.id,
          content: item.content.slice(0, 4000),
          messageCreatedAt: item.createdAt
        }))
      });
    }

    await message.reply(route.summary.slice(0, 1800));
  }

  async handleReply(input: DiscordReplyInput): Promise<void> {
    const { message, referencedMessageId } = input;

    if (!this.approvalService.isApprover(message.author.id)) {
      return;
    }

    const mapping = await prisma.discordMessageMap.findUnique({
      where: { messageId: referencedMessageId }
    });

    if (!mapping) {
      return;
    }

    const candidate = await prisma.threadCandidate.findUnique({
      where: { id: mapping.threadCandidateId }
    });

    if (!candidate || ["POSTING", "POSTED", "FAILED", "CANCELLED"].includes(candidate.status)) {
      return;
    }

    const latestRevision = await prisma.draftRevision.findFirst({
      where: { threadCandidateId: candidate.id },
      orderBy: { revisionNumber: "desc" }
    });

    if (!latestRevision) {
      return;
    }

    if (
      env.MAX_REVISIONS_PER_CANDIDATE > 0 &&
      latestRevision.revisionNumber >= env.MAX_REVISIONS_PER_CANDIDATE
    ) {
      await message.reply(
        `Revision limit reached for this candidate (max=${env.MAX_REVISIONS_PER_CANDIDATE}).`
      );
      return;
    }

    const editInstruction = message.content.trim();
    if (!editInstruction) {
      await message.reply("Add edit instructions in your reply so I can revise the draft.");
      return;
    }

    const historyRows = await prisma.draftRevision.findMany({
      where: { threadCandidateId: candidate.id },
      orderBy: { revisionNumber: "asc" }
    });

    const historyContext = historyRows
      .map((row) => `v${row.revisionNumber}: ${row.draftText}`)
      .join("\n\n")
      .slice(0, 4000);

    const revisedDraft = await this.draftService.reviseDraft(
      `${latestRevision.draftText}\n\nHistory:\n${historyContext}`,
      editInstruction
    );

    const newRevision = await prisma.draftRevision.create({
      data: {
        threadCandidateId: candidate.id,
        revisionNumber: latestRevision.revisionNumber + 1,
        draftText: revisedDraft,
        rationale: "Revision requested in Discord reply",
        promptSnapshot: `Instruction: ${editInstruction}`
      }
    });

    await prisma.approvalEvent.create({
      data: {
        threadCandidateId: candidate.id,
        discordUserId: message.author.id,
        eventType: "REVISION_REQUEST",
        eventPayload: editInstruction.slice(0, 2000)
      }
    });

    const messageText = formatCandidateMessage(
      candidate.id,
      {
        subreddit: candidate.subreddit,
        title: candidate.title,
        permalink: candidate.permalink,
        reason: "Revision from approver feedback"
      },
      newRevision.revisionNumber,
      revisedDraft
    );

    const posted = await this.discordBot.postApprovalCandidate(messageText);

    await prisma.discordMessageMap.create({
      data: {
        threadCandidateId: candidate.id,
        revisionId: newRevision.id,
        channelId: posted.channelId,
        messageId: posted.messageId
      }
    });

    await message.reply(`Posted revised draft v${newRevision.revisionNumber} for approval.`);
  }

  async handleReaction(input: DiscordReactionInput): Promise<void> {
    if (input.emoji !== "👍" && input.emoji !== "👎") {
      return;
    }

    if (!this.approvalService.isApprover(input.userId)) {
      return;
    }

    const mapping = await prisma.discordMessageMap.findUnique({
      where: { messageId: input.messageId }
    });

    if (!mapping) {
      return;
    }

    const candidate = await prisma.threadCandidate.findUnique({
      where: { id: mapping.threadCandidateId }
    });

    if (!candidate) {
      return;
    }

    if (["POSTING", "POSTED", "FAILED", "CANCELLED"].includes(candidate.status)) {
      return;
    }

    if (input.emoji === "👎") {
      await this.rejectCandidate(candidate.id, input.userId, input.channelId, input.messageId);
      return;
    }

    await this.approveCandidate(candidate.id, input.userId, input.channelId, input.messageId);
  }

  private async rejectCandidate(
    candidateId: string,
    userId: string,
    channelId: string,
    messageId: string
  ): Promise<void> {
    const latestRevision = await prisma.draftRevision.findFirst({
      where: { threadCandidateId: candidateId },
      orderBy: { revisionNumber: "desc" }
    });

    const cancelled = await prisma.threadCandidate.updateMany({
      where: {
        id: candidateId,
        status: {
          in: ["PENDING", "APPROVED"]
        }
      },
      data: { status: "CANCELLED" }
    });

    if (cancelled.count === 0) {
      await this.discordBot.replyToMessage(
        channelId,
        messageId,
        "This candidate is already being posted or already finalized."
      );
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.approvalEvent.create({
        data: {
          threadCandidateId: candidateId,
          discordUserId: userId,
          eventType: "REJECTED",
          eventPayload: "thumbs_down"
        }
      });

      if (latestRevision) {
        const candidate = await tx.threadCandidate.findUnique({ where: { id: candidateId } });
        if (candidate) {
          await tx.rejectedDraftSignal.create({
            data: {
              threadCandidateId: candidateId,
              subreddit: candidate.subreddit,
              redditPostId: candidate.redditPostId,
              rejectedDraft: latestRevision.draftText,
              rejectionReason: "Approver reacted with thumbs down"
            }
          });
        }
      }
    });

    await this.discordBot.replyToMessage(
      channelId,
      messageId,
      "Candidate cancelled. I won't post this thread."
    );
  }

  private async approveCandidate(
    candidateId: string,
    userId: string,
    channelId: string,
    messageId: string
  ): Promise<void> {
    const latestMap = await prisma.discordMessageMap.findFirst({
      where: { threadCandidateId: candidateId },
      orderBy: { createdAt: "desc" }
    });

    if (env.REJECT_STALE_APPROVALS && latestMap && latestMap.messageId !== messageId) {
      await this.discordBot.replyToMessage(
        channelId,
        messageId,
        "This approval is stale because a newer revision exists. Approve the latest draft message."
      );
      return;
    }

    const candidate = await prisma.threadCandidate.findUnique({
      where: { id: candidateId }
    });

    if (!candidate) {
      return;
    }

    const policy = await prisma.discoveryPolicy.findFirst();
    const allowedRows = await prisma.subredditConfig.findMany({
      where: { isAllowed: true },
      select: { name: true }
    });
    const allowedSet = new Set(allowedRows.map((row) => row.name.toLowerCase()));
    const subredditKey = `r/${candidate.subreddit}`.toLowerCase();

    if (policy?.mode !== "BROAD_SUGGEST_ONLY" && !allowedSet.has(subredditKey)) {
      await this.discordBot.replyToMessage(
        channelId,
        messageId,
        `Posting blocked because r/${candidate.subreddit} is not in allowlist.`
      );
      return;
    }

    if (env.DAILY_POST_CAP > 0) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);

      const postedToday = await prisma.redditCommentPost.count({
        where: {
          postedAt: {
            gte: dayStart
          }
        }
      });

      if (postedToday >= env.DAILY_POST_CAP) {
        await this.discordBot.replyToMessage(
          channelId,
          messageId,
          `Daily post cap reached (${env.DAILY_POST_CAP}). Try again tomorrow.`
        );
        return;
      }
    }

    const latestRevision = await prisma.draftRevision.findFirst({
      where: { threadCandidateId: candidate.id },
      orderBy: { revisionNumber: "desc" }
    });

    if (!latestRevision) {
      return;
    }

    const lock = await prisma.threadCandidate.updateMany({
      where: {
        id: candidate.id,
        status: {
          in: ["PENDING", "APPROVED"]
        }
      },
      data: { status: "POSTING" }
    });

    if (lock.count === 0) {
      await this.discordBot.replyToMessage(
        channelId,
        messageId,
        "This candidate is already being processed or already finalized."
      );
      return;
    }

    await prisma.approvalEvent.create({
      data: {
        threadCandidateId: candidate.id,
        discordUserId: userId,
        eventType: "APPROVED",
        eventPayload: "thumbs_up"
      }
    });

    try {
      const posted = await this.postingService.postWithRetry(candidate.redditPostId, latestRevision.draftText);

      await this.postingMemoryService.recordApprovedPost({
        threadCandidateId: candidate.id,
        redditPostId: candidate.redditPostId,
        subreddit: candidate.subreddit,
        permalink: candidate.permalink,
        postedByUsername: env.REDDIT_ACCOUNT_USERNAME ?? "unknown",
        redditCommentId: posted.id,
        redditCommentPermalink: posted.permalink,
        approvedComment: latestRevision.draftText
      });

      await prisma.approvalEvent.create({
        data: {
          threadCandidateId: candidate.id,
          discordUserId: userId,
          eventType: "POSTED",
          eventPayload: posted.permalink
        }
      });

      await this.discordBot.replyToMessage(
        channelId,
        messageId,
        `Posted to Reddit successfully: ${posted.permalink}`
      );
    } catch (error) {
      logger.error({ err: error, candidateId }, "Failed posting approved candidate");

      await prisma.$transaction(async (tx) => {
        await tx.threadCandidate.update({
          where: { id: candidate.id },
          data: { status: "FAILED" }
        });

        await tx.approvalEvent.create({
          data: {
            threadCandidateId: candidate.id,
            discordUserId: userId,
            eventType: "POST_FAILED",
            eventPayload: String(error).slice(0, 2000)
          }
        });
      });

      if (env.NOTIFY_ON_POST_FAILURE) {
        await this.discordBot.replyToMessage(
          channelId,
          messageId,
          `Failed to post after retries. Error: ${String(error).slice(0, 800)}`
        );
      }
    }
  }
}
