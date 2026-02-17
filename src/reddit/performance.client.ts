import { prisma } from "../storage/prisma";
import { logger } from "../config/logger";
import { RedditClient } from "./reddit.client";

type SnapshotWindow = "24h" | "7d";

export class PerformanceClient {
  constructor(private readonly redditClient: RedditClient) {}

  async captureSnapshots(): Promise<void> {
    const posted = await prisma.redditCommentPost.findMany({
      include: {
        threadCandidate: {
          select: {
            redditPostId: true
          }
        }
      }
    });

    const now = Date.now();

    for (const row of posted) {
      const ageHours = (now - row.postedAt.getTime()) / 3_600_000;

      const windows: SnapshotWindow[] = [];
      if (ageHours >= 24) {
        windows.push("24h");
      }
      if (ageHours >= 168) {
        windows.push("7d");
      }

      for (const window of windows) {
        const existing = await prisma.commentPerformanceSnapshot.findFirst({
          where: {
            redditCommentId: row.redditCommentId,
            snapshotWindow: window
          }
        });

        if (existing) {
          continue;
        }

        const commentFullname = row.redditCommentId.startsWith("t1_")
          ? row.redditCommentId
          : `t1_${row.redditCommentId}`;
        const postFullname = row.threadCandidate.redditPostId;

        try {
          const info = await this.redditClient.fetchThingInfo([commentFullname, postFullname]);
          const commentInfo = info.get(commentFullname);
          const postInfo = info.get(postFullname);

          await prisma.commentPerformanceSnapshot.create({
            data: {
              redditCommentId: row.redditCommentId,
              redditPostId: postFullname,
              snapshotWindow: window,
              commentScore: commentInfo?.score ?? null,
              commentReplyCount: commentInfo?.num_comments ?? null,
              postScore: postInfo?.score ?? null,
              postCommentCount: postInfo?.num_comments ?? null
            }
          });
        } catch (error) {
          logger.warn(
            {
              err: error,
              redditCommentId: row.redditCommentId,
              window
            },
            "Failed capturing performance snapshot"
          );
        }
      }
    }
  }
}
