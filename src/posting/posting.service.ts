import { RedditClient } from "../reddit/reddit.client";

export class PostingService {
  constructor(private readonly redditClient: RedditClient) {}

  async postWithRetry(redditPostFullname: string, comment: string): Promise<{ id: string; permalink: string }> {
    return this.redditClient.postComment(redditPostFullname, comment);
  }
}
