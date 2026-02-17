import { prisma } from "../storage/prisma";

type ApprovedPostInput = {
  threadCandidateId: string;
  redditPostId: string;
  subreddit: string;
  permalink: string;
  postedByUsername: string;
  redditCommentId: string;
  redditCommentPermalink: string;
  approvedComment: string;
};

export class PostingMemoryService {
  async recordApprovedPost(input: ApprovedPostInput): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.redditCommentPost.create({
        data: {
          threadCandidateId: input.threadCandidateId,
          redditCommentId: input.redditCommentId,
          redditPermalink: input.redditCommentPermalink,
          postedByUsername: input.postedByUsername
        }
      });

      await tx.postedThreadHistory.upsert({
        where: { redditPostId: input.redditPostId },
        update: {
          subreddit: input.subreddit,
          permalink: input.permalink
        },
        create: {
          redditPostId: input.redditPostId,
          subreddit: input.subreddit,
          permalink: input.permalink
        }
      });

      await tx.approvedCommentMemory.create({
        data: {
          threadCandidateId: input.threadCandidateId,
          subreddit: input.subreddit,
          redditPostId: input.redditPostId,
          approvedComment: input.approvedComment
        }
      });

      await tx.threadCandidate.update({
        where: { id: input.threadCandidateId },
        data: { status: "POSTED" }
      });
    });
  }
}
