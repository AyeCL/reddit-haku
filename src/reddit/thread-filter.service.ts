import type { DiscoveryCandidate, RankedCandidate } from "../types/discovery";

type RankingInput = {
  focusSubreddits: Set<string>;
  approvedCountsBySubreddit: Map<string, number>;
  rejectedCountsBySubreddit: Map<string, number>;
  minUpvotes: number;
  minComments: number;
  qualityOperator: "OR" | "AND";
  maxAgeHours: number;
};

export class ThreadFilterService {
  rank(candidates: DiscoveryCandidate[], rankingInput: RankingInput): RankedCandidate[] {
    const nowSeconds = Date.now() / 1000;

    return candidates
      .filter((candidate) => {
        const ageHours = (nowSeconds - candidate.createdUtc) / 3600;
        if (ageHours > rankingInput.maxAgeHours) {
          return false;
        }

        const upvotes = candidate.score ?? 0;
        const comments = candidate.numComments ?? 0;

        if (rankingInput.qualityOperator === "AND") {
          return upvotes >= rankingInput.minUpvotes && comments >= rankingInput.minComments;
        }

        return upvotes >= rankingInput.minUpvotes || comments >= rankingInput.minComments;
      })
      .map((candidate) => {
        const normalizedSubreddit = `r/${candidate.subreddit}`.toLowerCase();
        const focusBoost = rankingInput.focusSubreddits.has(normalizedSubreddit) ? 8 : 0;
        const approvedBoost = rankingInput.approvedCountsBySubreddit.get(normalizedSubreddit) ?? 0;
        const rejectedPenalty = rankingInput.rejectedCountsBySubreddit.get(normalizedSubreddit) ?? 0;
        const engagement = (candidate.score ?? 0) * 0.7 + (candidate.numComments ?? 0) * 1.2;

        const composite = engagement + focusBoost + approvedBoost * 0.8 - rejectedPenalty * 0.8;

        return {
          ...candidate,
          scoreComposite: composite,
          reason: `engagement=${engagement.toFixed(1)} focusBoost=${focusBoost} approvedBoost=${approvedBoost} rejectedPenalty=${rejectedPenalty}`
        } satisfies RankedCandidate;
      })
      .sort((a, b) => b.scoreComposite - a.scoreComposite);
  }
}
