import { env } from "../config/env";
import { prisma } from "../storage/prisma";

function formatTop(entries: Array<{ key: string; count: number }>, empty = "none"): string {
  if (entries.length === 0) {
    return empty;
  }

  return entries
    .slice(0, 5)
    .map((entry) => `${entry.key}(${entry.count})`)
    .join(", ");
}

export class LearningService {
  async runIncrementalLearning(): Promise<string> {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);

    const approved = await prisma.approvedCommentMemory.findMany({
      where: { createdAt: { gte: since } }
    });
    const rejected = await prisma.rejectedDraftSignal.findMany({
      where: { createdAt: { gte: since } }
    });

    const approvedBySub = this.countBy(approved.map((row) => `r/${row.subreddit}`));
    const rejectedBySub = this.countBy(rejected.map((row) => `r/${row.subreddit}`));

    const summary = [
      `Window: last 12h`,
      `Approved: ${approved.length}`,
      `Rejected: ${rejected.length}`,
      `Top approved subreddits: ${formatTop(approvedBySub)}`,
      `Top rejected subreddits: ${formatTop(rejectedBySub)}`,
      `Signal: favor high approved-rate subreddits, down-rank repeated reject patterns.`
    ].join("\n");

    await prisma.learningSnapshot.create({
      data: {
        windowType: "12h",
        summaryText: summary,
        scoringChanges: `approved=${approved.length};rejected=${rejected.length}`
      }
    });

    return summary;
  }

  async runWeeklyDigest(): Promise<string> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const approved = await prisma.approvedCommentMemory.findMany({
      where: { createdAt: { gte: since } }
    });
    const rejected = await prisma.rejectedDraftSignal.findMany({
      where: { createdAt: { gte: since } }
    });
    const snapshots = await prisma.commentPerformanceSnapshot.findMany({
      where: { capturedAt: { gte: since } }
    });

    const approvedBySub = this.countBy(approved.map((row) => `r/${row.subreddit}`));
    const rejectedBySub = this.countBy(rejected.map((row) => `r/${row.subreddit}`));

    const avgCommentScore = this.avg(
      snapshots
        .map((row) => row.commentScore)
        .filter((value): value is number => typeof value === "number")
    );

    const digest = [
      `Window: last 7d`,
      `Approved: ${approved.length}`,
      `Rejected: ${rejected.length}`,
      `Performance snapshots captured: ${snapshots.length}`,
      `Average approved-comment score (captured windows): ${avgCommentScore.toFixed(2)}`,
      `Top approved subreddits: ${formatTop(approvedBySub)}`,
      `Top rejected subreddits: ${formatTop(rejectedBySub)}`,
      `Recommendation: prioritize high-conversion subreddit patterns, avoid repeating rejected framing.`
    ].join("\n");

    await prisma.weeklyLearningDigest.create({
      data: {
        digestText: digest
      }
    });

    if (env.CONTEXT_COMPACTION_ENABLED) {
      const postedCount = await prisma.postedThreadHistory.count();
      if (postedCount >= env.CONTEXT_COMPACTION_POST_THRESHOLD) {
        const contextCount = await prisma.discordContextMessage.count();
        await prisma.compactedContextSummary.create({
          data: {
            summaryText: [
              `Compaction checkpoint reached.`,
              `Posted threads: ${postedCount}`,
              `Stored context records: ${contextCount}`,
              `Latest digest key signals: approved=${approved.length}, rejected=${rejected.length}, avgCommentScore=${avgCommentScore.toFixed(2)}`
            ].join("\n"),
            sourceRecordCount: contextCount
          }
        });
      }
    }

    await prisma.learningSnapshot.create({
      data: {
        windowType: "7d",
        summaryText: digest,
        scoringChanges: `avgCommentScore=${avgCommentScore.toFixed(2)}`
      }
    });

    return digest;
  }

  private countBy(items: string[]): Array<{ key: string; count: number }> {
    const map = new Map<string, number>();
    for (const item of items) {
      map.set(item, (map.get(item) ?? 0) + 1);
    }

    return Array.from(map.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  }

  private avg(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    const total = values.reduce((sum, value) => sum + value, 0);
    return total / values.length;
  }
}
