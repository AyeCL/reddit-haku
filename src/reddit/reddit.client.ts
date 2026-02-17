import { prisma } from "../storage/prisma";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { decryptString } from "../security/crypto";
import type { DiscoveryCandidate } from "../types/discovery";

type AccessTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
};

type RedditListingChild = {
  data: {
    id: string;
    name: string;
    subreddit: string;
    title: string;
    permalink: string;
    author?: string;
    score?: number;
    num_comments?: number;
    selftext?: string;
    created_utc: number;
  };
};

type RedditListingResponse = {
  data?: {
    children?: RedditListingChild[];
  };
};

type RedditThingInfo = {
  name: string;
  score: number | undefined;
  num_comments: number | undefined;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class RedditClient {
  private cachedAccessToken: string | null = null;
  private expiresAtEpochMs = 0;

  private async getRefreshToken(): Promise<string> {
    if (env.REDDIT_REFRESH_TOKEN) {
      return env.REDDIT_REFRESH_TOKEN;
    }

    if (!env.USE_DB_REDDIT_REFRESH_TOKEN) {
      throw new Error("No refresh token configured. Set REDDIT_REFRESH_TOKEN or enable DB token mode.");
    }

    const credential = await prisma.redditAuthCredential.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: "desc" }
    });

    if (!credential) {
      throw new Error("No active Reddit auth credential found in DB");
    }

    if (!env.REDDIT_TOKEN_ENCRYPTION_KEY) {
      throw new Error("REDDIT_TOKEN_ENCRYPTION_KEY is required to decrypt DB refresh token");
    }

    return decryptString(credential.refreshTokenEnc, env.REDDIT_TOKEN_ENCRYPTION_KEY);
  }

  private computeRetryDelayMs(response: Response | null, attempt: number): number {
    const retryAfter = response?.headers.get("retry-after");
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
    if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }

    return Math.min(15_000, attempt * 1500);
  }

  private logRateLimitHeaders(response: Response, context: string): void {
    const remainingRaw = response.headers.get("x-ratelimit-remaining");
    const resetRaw = response.headers.get("x-ratelimit-reset");
    const usedRaw = response.headers.get("x-ratelimit-used");

    const remaining = remainingRaw ? Number(remainingRaw) : NaN;
    const reset = resetRaw ? Number(resetRaw) : NaN;
    const used = usedRaw ? Number(usedRaw) : NaN;

    if (!Number.isNaN(remaining) && remaining <= 2) {
      logger.warn({ context, remaining, reset, used }, "Reddit rate limit running low");
    }
  }

  private async fetchWithRetry(
    context: string,
    makeRequest: () => Promise<Response>,
    maxAttempts = 3
  ): Promise<Response> {
    let lastError: unknown;
    let lastResponse: Response | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await makeRequest();
        lastResponse = response;
        this.logRateLimitHeaders(response, context);

        if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
          if (attempt < maxAttempts) {
            const delay = this.computeRetryDelayMs(response, attempt);
            logger.warn(
              { context, status: response.status, attempt, delayMs: delay },
              "Retrying Reddit request due to rate limit/server error"
            );
            await sleep(delay);
            continue;
          }
        }

        return response;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          const delay = this.computeRetryDelayMs(null, attempt);
          logger.warn(
            { context, attempt, delayMs: delay, err: error },
            "Retrying Reddit request after network error"
          );
          await sleep(delay);
          continue;
        }
      }
    }

    if (lastResponse) {
      return lastResponse;
    }

    throw new Error(`Reddit request failed for ${context}: ${String(lastError)}`);
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedAccessToken && now < this.expiresAtEpochMs - 30_000) {
      return this.cachedAccessToken;
    }

    const refreshToken = await this.getRefreshToken();
    const basic = Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString("base64");

    const response = await this.fetchWithRetry(
      "token_refresh",
      async () => {
        const body = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        });

        return fetch("https://www.reddit.com/api/v1/access_token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": env.REDDIT_USER_AGENT
          },
          body
        });
      },
      3
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to refresh Reddit token: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as AccessTokenResponse;
    this.cachedAccessToken = payload.access_token;
    this.expiresAtEpochMs = Date.now() + payload.expires_in * 1000;
    return payload.access_token;
  }

  private async fetchListing(path: string): Promise<DiscoveryCandidate[]> {
    const token = await this.getAccessToken();
    const response = await this.fetchWithRetry(
      `listing:${path}`,
      async () =>
        fetch(`https://oauth.reddit.com${path}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": env.REDDIT_USER_AGENT
          }
        }),
      3
    );

    if (!response.ok) {
      const text = await response.text();
      logger.warn({ path, status: response.status, text }, "Reddit listing request failed");
      return [];
    }

    const payload = (await response.json()) as RedditListingResponse;
    const children = payload.data?.children ?? [];

    return children.map((child) => {
      const data = child.data;
      const permalink = data.permalink.startsWith("http")
        ? data.permalink
        : `https://reddit.com${data.permalink}`;

      return {
        redditPostId: data.id,
        redditPostFullname: data.name,
        subreddit: data.subreddit,
        title: data.title,
        permalink,
        author: data.author ?? undefined,
        score: data.score ?? undefined,
        numComments: data.num_comments ?? undefined,
        body: data.selftext ?? undefined,
        createdUtc: data.created_utc,
        source: "subreddit_new"
      } satisfies DiscoveryCandidate;
    });
  }

  async validateAndNormalizeSubreddit(name: string): Promise<string | null> {
    const token = await this.getAccessToken();
    const normalized = name.replace(/^r\//i, "").trim();
    const response = await this.fetchWithRetry(
      `subreddit_about:${normalized}`,
      async () =>
        fetch(`https://oauth.reddit.com/r/${normalized}/about`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": env.REDDIT_USER_AGENT
          }
        }),
      2
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      data?: {
        display_name?: string;
      };
    };

    const canonical = payload.data?.display_name;
    return canonical ? `r/${canonical}`.toLowerCase() : `r/${normalized}`.toLowerCase();
  }

  async validateSubreddit(name: string): Promise<boolean> {
    const normalized = await this.validateAndNormalizeSubreddit(name);
    return normalized !== null;
  }

  async discoverThreads(subreddits: string[]): Promise<DiscoveryCandidate[]> {
    const deduped = new Map<string, DiscoveryCandidate>();

    for (const input of subreddits) {
      const subreddit = input.replace(/^r\//i, "");
      const path = `/r/${subreddit}/new?limit=${env.DISCOVERY_FETCH_LIMIT}`;
      const rows = await this.fetchListing(path);

      for (const row of rows) {
        deduped.set(row.redditPostFullname, {
          ...row,
          source: "subreddit_new"
        });
      }
    }

    const terms = env.DISCOVERY_QUERY_TERMS.split(",")
      .map((term) => term.trim())
      .filter(Boolean);

    for (const term of terms) {
      const path = `/search?restrict_sr=false&sort=new&t=week&limit=${env.DISCOVERY_FETCH_LIMIT}&q=${encodeURIComponent(term)}`;
      const rows = await this.fetchListing(path);

      for (const row of rows) {
        deduped.set(row.redditPostFullname, {
          ...row,
          source: "global_search"
        });
      }
    }

    const results = Array.from(deduped.values());
    logger.info({ count: results.length }, "Discovered candidate threads from Reddit");
    return results;
  }

  async fetchThingInfo(fullnames: string[]): Promise<Map<string, RedditThingInfo>> {
    if (fullnames.length === 0) {
      return new Map();
    }

    const token = await this.getAccessToken();
    const uniq = Array.from(new Set(fullnames));
    const response = await this.fetchWithRetry(
      "thing_info",
      async () =>
        fetch(`https://oauth.reddit.com/api/info?id=${encodeURIComponent(uniq.join(","))}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": env.REDDIT_USER_AGENT
          }
        }),
      3
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch thing info: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as {
      data?: {
        children?: Array<{
          data?: {
            name?: string;
            score?: number;
            num_comments?: number;
          };
        }>;
      };
    };

    const map = new Map<string, RedditThingInfo>();
    for (const row of payload.data?.children ?? []) {
      if (row.data?.name) {
        map.set(row.data.name, {
          name: row.data.name,
          score: row.data.score ?? undefined,
          num_comments: row.data.num_comments ?? undefined
        });
      }
    }

    return map;
  }

  async postComment(redditPostFullname: string, text: string): Promise<{ id: string; permalink: string }> {
    const token = await this.getAccessToken();

    if (env.DRY_RUN) {
      logger.info({ redditPostFullname, textLength: text.length }, "DRY_RUN enabled; skipping Reddit comment post");
      return { id: "dry_run_comment_id", permalink: "https://reddit.com/dry-run" };
    }

    const response = await this.fetchWithRetry(
      "comment_post",
      async () => {
        const body = new URLSearchParams({
          api_type: "json",
          thing_id: redditPostFullname,
          text
        });

        return fetch("https://oauth.reddit.com/api/comment", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": env.REDDIT_USER_AGENT
          },
          body
        });
      },
      env.POST_RETRY_MAX_ATTEMPTS
    );

    if (!response.ok) {
      const textBody = await response.text();
      throw new Error(`Failed to post Reddit comment: ${response.status} ${textBody}`);
    }

    const payload = (await response.json()) as {
      json?: {
        data?: {
          things?: Array<{
            data?: {
              id?: string;
              permalink?: string;
            };
          }>;
        };
      };
    };

    const firstThing = payload.json?.data?.things?.[0]?.data;
    if (!firstThing?.id || !firstThing.permalink) {
      throw new Error("Unexpected Reddit response while posting comment");
    }

    return { id: firstThing.id, permalink: `https://reddit.com${firstThing.permalink}` };
  }
}
