import { createHash } from "crypto";
import { prisma } from "../storage/prisma";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { DraftService } from "../ai/draft.service";
import { DiscordBot } from "../discord/discord.bot";
import { formatCandidateMessage } from "../discord/message-format";
import { RedditClient } from "../reddit/reddit.client";
import { ThreadFilterService } from "../reddit/thread-filter.service";
import type { DiscoveryCandidate, RankedCandidate } from "../types/discovery";

function parseTimeToMinutes(hhmm: string): number {
  const [hRaw, mRaw] = hhmm.split(":");
  const hour = Number(hRaw);
  const minute = Number(mRaw);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid HH:mm time format: ${hhmm}`);
  }
  return hour * 60 + minute;
}

export class DiscoveryService {
  constructor(
    private readonly redditClient: RedditClient,
    private readonly threadFilterService: ThreadFilterService,
    private readonly draftService: DraftService,
    private readonly discordBot: DiscordBot
  ) {}

  async ensureBootstrapConfig(): Promise<void> {
    const policy = await prisma.discoveryPolicy.findFirst();
    if (!policy) {
      await prisma.discoveryPolicy.create({
        data: {
          mode: "FOCUS_PLUS_SIMILAR",
          isPaused: false,
          similarityStrictness: env.SIMILARITY_STRICTNESS,
          maxThreadAgeHours: env.MAX_THREAD_AGE_HOURS,
          minThreadUpvotes: env.MIN_THREAD_UPVOTES,
          minThreadComments: env.MIN_THREAD_COMMENTS,
          qualityOperator: env.THREAD_QUALITY_OPERATOR
        }
      });
    }

    const seeds = env.FOCUS_SUBREDDITS.split(",")
      .map((row) => row.trim())
      .filter(Boolean);

    for (const seed of seeds) {
      const canonical = await this.redditClient.validateAndNormalizeSubreddit(seed);
      if (!canonical) {
        logger.warn({ seed }, "Skipping invalid subreddit seed");
        continue;
      }
      const canonicalLower = canonical.toLowerCase();

      await prisma.subredditConfig.upsert({
        where: { name: canonicalLower },
        update: {
          isEnabled: true,
          isFocus: true,
          isAllowed: true
        },
        create: {
          name: canonicalLower,
          isEnabled: true,
          isFocus: true,
          isAllowed: true,
          isBlocked: false
        }
      });
    }
  }

  async runCycle(): Promise<void> {
    const policy = await prisma.discoveryPolicy.findFirst();
    if (!policy) {
      logger.warn("No discovery policy found; skipping cycle");
      return;
    }

    if (policy.isPaused) {
      logger.info("Discovery paused by policy; skipping cycle");
      return;
    }

    if (!this.isWithinActiveHours()) {
      logger.info("Outside configured active hours; skipping discovery cycle");
      return;
    }

    const whereClause =
      policy.mode === "FOCUS_ONLY"
        ? {
            isEnabled: true,
            isBlocked: false,
            isFocus: true
          }
        : policy.mode === "FOCUS_PLUS_SIMILAR"
          ? {
              isEnabled: true,
              isBlocked: false,
              OR: [{ isFocus: true }, { isAllowed: true }]
            }
          : {
              isEnabled: true,
              isBlocked: false
            };

    const subredditRows = await prisma.subredditConfig.findMany({
      where: whereClause
    });

    if (subredditRows.length === 0) {
      logger.warn("No enabled focus/allowed subreddits configured");
      return;
    }

    const subreddits = subredditRows.map((row) => row.name);
    const blocked = new Set(
      (
        await prisma.subredditConfig.findMany({
          where: { isBlocked: true },
          select: { name: true }
        })
      ).map((row) => row.name.toLowerCase())
    );

    const candidates = await this.redditClient.discoverThreads(subreddits);
    const filteredCandidates = candidates.filter(
      (candidate) => !blocked.has(`r/${candidate.subreddit}`.toLowerCase())
    );

    const postedIds = new Set(
      (
        await prisma.postedThreadHistory.findMany({
          select: { redditPostId: true }
        })
      ).map((row) => row.redditPostId)
    );

    const existingIds = new Set(
      (
        await prisma.threadCandidate.findMany({
          where: {
            status: {
              in: ["PENDING", "APPROVED", "POSTED"]
            }
          },
          select: { redditPostId: true }
        })
      ).map((row) => row.redditPostId)
    );

    const deduped = filteredCandidates.filter(
      (candidate) =>
        !postedIds.has(candidate.redditPostFullname) && !existingIds.has(candidate.redditPostFullname)
    );

    const approvedCountsBySubreddit = await this.getApprovedCountsBySubreddit();
    const rejectedCountsBySubreddit = await this.getRejectedCountsBySubreddit();
    const focusSet = new Set(
      subredditRows
        .filter((row) => row.isFocus)
        .map((row) => row.name.toLowerCase())
    );

    const ranked = this.threadFilterService.rank(deduped, {
      focusSubreddits: focusSet,
      approvedCountsBySubreddit,
      rejectedCountsBySubreddit,
      minUpvotes: policy.minThreadUpvotes,
      minComments: policy.minThreadComments,
      qualityOperator: policy.qualityOperator === "AND" ? "AND" : "OR",
      maxAgeHours: policy.maxThreadAgeHours
    });

    const pool = ranked.slice(0, env.MAX_THREADS_PER_RUN);
    const selected = pool.slice(0, env.MAX_SUGGESTIONS_TO_DISCORD);

    for (const candidate of selected) {
      try {
        await this.publishCandidate(candidate);
      } catch (error) {
        logger.warn(
          {
            err: error,
            redditPostFullname: candidate.redditPostFullname
          },
          "Failed publishing candidate; continuing"
        );
      }
    }

    logger.info(
      {
        discovered: candidates.length,
        afterFilter: filteredCandidates.length,
        afterDedupe: deduped.length,
        selected: selected.length
      },
      "Discovery cycle completed"
    );
  }

  private isWithinActiveHours(): boolean {
    if (!env.ACTIVE_HOURS_ENABLED) {
      return true;
    }

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: env.ACTIVE_HOURS_TIMEZONE,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    });

    const parts = formatter.formatToParts(new Date());
    const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
    const currentMinutes = parseTimeToMinutes(`${hour}:${minute}`);

    const startMinutes = parseTimeToMinutes(env.ACTIVE_HOURS_START);
    const endMinutes = parseTimeToMinutes(env.ACTIVE_HOURS_END);

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }

    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }

  private async getApprovedCountsBySubreddit(): Promise<Map<string, number>> {
    const rows = await prisma.approvedCommentMemory.groupBy({
      by: ["subreddit"],
      _count: { subreddit: true }
    });

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(`r/${row.subreddit}`.toLowerCase(), row._count.subreddit);
    }

    return map;
  }

  private async getRejectedCountsBySubreddit(): Promise<Map<string, number>> {
    const rows = await prisma.rejectedDraftSignal.groupBy({
      by: ["subreddit"],
      _count: { subreddit: true }
    });

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(`r/${row.subreddit}`.toLowerCase(), row._count.subreddit);
    }

    return map;
  }

  private async publishCandidate(candidate: RankedCandidate): Promise<void> {
    const dedupeHash = createHash("sha256").update(candidate.redditPostFullname).digest("hex");

    const threadCandidate = await prisma.threadCandidate.create({
      data: {
        redditPostId: candidate.redditPostFullname,
        subreddit: candidate.subreddit,
        title: candidate.title,
        permalink: candidate.permalink,
        author: candidate.author ?? null,
        score: candidate.score ?? null,
        numComments: candidate.numComments ?? null,
        similaritySource: candidate.source,
        dedupeHash,
        status: "PENDING"
      }
    });

    const draft = await this.draftService.generateDraft(candidate, this.composeContext(candidate));

    const revision = await prisma.draftRevision.create({
      data: {
        threadCandidateId: threadCandidate.id,
        revisionNumber: 1,
        draftText: draft,
        rationale: candidate.reason,
        promptSnapshot: this.composeContext(candidate)
      }
    });

    const messageText = formatCandidateMessage(
      threadCandidate.id,
      candidate,
      revision.revisionNumber,
      draft
    );
    const posted = await this.discordBot.postApprovalCandidate(messageText);

    await prisma.discordMessageMap.create({
      data: {
        threadCandidateId: threadCandidate.id,
        revisionId: revision.id,
        channelId: posted.channelId,
        messageId: posted.messageId
      }
    });
  }

  private composeContext(candidate: DiscoveryCandidate): string {
    return [
      `Title: ${candidate.title}`,
      `Subreddit: r/${candidate.subreddit}`,
      `Body: ${(candidate.body ?? "").slice(0, 1500)}`,
      `Permalink: ${candidate.permalink}`
    ].join("\n");
  }

}
