export type DiscoveryCandidate = {
  redditPostId: string;
  redditPostFullname: string;
  subreddit: string;
  title: string;
  permalink: string;
  author: string | undefined;
  score: number | undefined;
  numComments: number | undefined;
  body: string | undefined;
  createdUtc: number;
  source: "subreddit_new" | "global_search";
};

export type RankedCandidate = DiscoveryCandidate & {
  scoreComposite: number;
  reason: string;
};
