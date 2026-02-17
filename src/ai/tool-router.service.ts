import { prisma } from "../storage/prisma";
import { RedditClient } from "../reddit/reddit.client";

type ActionType = "READ" | "MUTATE";

export type ToolRouteInput = {
  commandText: string;
  isApprover: boolean;
};

export type ToolRouteOutput = {
  actionType: ActionType;
  summary: string;
};

function extractSubreddits(text: string): string[] {
  const matches = text.match(/r\/[A-Za-z0-9_]+/g) ?? [];
  return Array.from(new Set(matches.map((row) => row.toLowerCase())));
}

function modeToLabel(mode: string): string {
  switch (mode) {
    case "FOCUS_ONLY":
      return "focus_only";
    case "FOCUS_PLUS_SIMILAR":
      return "focus_plus_similar";
    case "BROAD_SUGGEST_ONLY":
      return "broad_suggest_only";
    default:
      return mode;
  }
}

export class ToolRouterService {
  constructor(private readonly redditClient: RedditClient) {}

  async route(input: ToolRouteInput): Promise<ToolRouteOutput> {
    const command = input.commandText.trim();
    const lower = command.toLowerCase();

    if (!command) {
      return {
        actionType: "READ",
        summary: `Empty command.\n\n${await this.snapshot()}`
      };
    }

    if (
      lower.startsWith("show") ||
      lower.includes("status") ||
      lower.includes("focus list") ||
      lower.includes("config")
    ) {
      return {
        actionType: "READ",
        summary: await this.snapshot()
      };
    }

    if (lower.includes("pause")) {
      return this.guardMutation(input.isApprover, async () => {
        await prisma.discoveryPolicy.updateMany({ data: { isPaused: true } });
        return `Discovery paused.\n\n${await this.snapshot()}`;
      });
    }

    if (lower.includes("resume")) {
      return this.guardMutation(input.isApprover, async () => {
        await prisma.discoveryPolicy.updateMany({ data: { isPaused: false } });
        return `Discovery resumed.\n\n${await this.snapshot()}`;
      });
    }

    if (lower.includes("focus on")) {
      return this.guardMutation(input.isApprover, async () => {
        const subreddits = extractSubreddits(lower);
        if (subreddits.length === 0) {
          return "No subreddits found. Use syntax like: focus on r/SaaS, r/marketing and similar";
        }

        const valid = await this.validateSubreddits(subreddits);
        await prisma.subredditConfig.updateMany({ data: { isFocus: false } });

        for (const subreddit of valid.valid) {
          await prisma.subredditConfig.upsert({
            where: { name: subreddit },
            update: { isEnabled: true, isFocus: true, isAllowed: true },
            create: {
              name: subreddit,
              isEnabled: true,
              isFocus: true,
              isAllowed: true,
              isBlocked: false
            }
          });
        }

        if (lower.includes("similar")) {
          await prisma.discoveryPolicy.updateMany({ data: { mode: "FOCUS_PLUS_SIMILAR" } });
        }

        return `Focus updated. Added ${valid.valid.length} valid subreddits. Invalid: ${valid.invalid.join(", ") || "none"}.\n\n${await this.snapshot()}`;
      });
    }

    if (lower.includes("add allow")) {
      return this.guardMutation(input.isApprover, async () => {
        const subreddits = extractSubreddits(lower);
        const valid = await this.validateSubreddits(subreddits);

        for (const subreddit of valid.valid) {
          await prisma.subredditConfig.upsert({
            where: { name: subreddit },
            update: { isAllowed: true, isEnabled: true },
            create: {
              name: subreddit,
              isEnabled: true,
              isFocus: false,
              isAllowed: true,
              isBlocked: false
            }
          });
        }

        return `Allowlist updated. Added ${valid.valid.length}. Invalid: ${valid.invalid.join(", ") || "none"}.\n\n${await this.snapshot()}`;
      });
    }

    if (lower.includes("remove allow") || lower.includes("rm allow")) {
      return this.guardMutation(input.isApprover, async () => {
        const subreddits = extractSubreddits(lower);
        await prisma.subredditConfig.updateMany({
          where: { name: { in: subreddits.map((row) => row.toLowerCase()) } },
          data: { isAllowed: false }
        });

        return `Allowlist entries removed: ${subreddits.join(", ") || "none"}.\n\n${await this.snapshot()}`;
      });
    }

    if (lower.includes("add block")) {
      return this.guardMutation(input.isApprover, async () => {
        const subreddits = extractSubreddits(lower);
        const valid = await this.validateSubreddits(subreddits);

        for (const subreddit of valid.valid) {
          await prisma.subredditConfig.upsert({
            where: { name: subreddit },
            update: { isBlocked: true, isEnabled: true },
            create: {
              name: subreddit,
              isEnabled: true,
              isFocus: false,
              isAllowed: false,
              isBlocked: true
            }
          });
        }

        return `Blocklist updated. Added ${valid.valid.length}. Invalid: ${valid.invalid.join(", ") || "none"}.\n\n${await this.snapshot()}`;
      });
    }

    if (lower.includes("remove block") || lower.includes("rm block")) {
      return this.guardMutation(input.isApprover, async () => {
        const subreddits = extractSubreddits(lower);
        await prisma.subredditConfig.updateMany({
          where: { name: { in: subreddits.map((row) => row.toLowerCase()) } },
          data: { isBlocked: false }
        });

        return `Blocklist entries removed: ${subreddits.join(", ") || "none"}.\n\n${await this.snapshot()}`;
      });
    }

    if (lower.includes("focus_only")) {
      return this.guardMutation(input.isApprover, async () => {
        await prisma.discoveryPolicy.updateMany({ data: { mode: "FOCUS_ONLY" } });
        return `Discovery mode set to focus_only.\n\n${await this.snapshot()}`;
      });
    }

    if (lower.includes("broad_suggest_only")) {
      return this.guardMutation(input.isApprover, async () => {
        await prisma.discoveryPolicy.updateMany({ data: { mode: "BROAD_SUGGEST_ONLY" } });
        return `Discovery mode set to broad_suggest_only.\n\n${await this.snapshot()}`;
      });
    }

    if (lower.includes("focus_plus_similar") || lower.includes("similar mode")) {
      return this.guardMutation(input.isApprover, async () => {
        await prisma.discoveryPolicy.updateMany({ data: { mode: "FOCUS_PLUS_SIMILAR" } });
        return `Discovery mode set to focus_plus_similar.\n\n${await this.snapshot()}`;
      });
    }

    return {
      actionType: "READ",
      summary: [
        "Command not recognized.",
        "Try: show config | focus on r/SaaS, r/marketing and similar | add allow r/x | add block r/x | pause | resume",
        "",
        await this.snapshot()
      ].join("\n")
    };
  }

  private async guardMutation(
    isApprover: boolean,
    run: () => Promise<string>
  ): Promise<ToolRouteOutput> {
    if (!isApprover) {
      return {
        actionType: "MUTATE",
        summary: "You can run read-only commands here. Mutating commands are restricted to the approver account."
      };
    }

    return {
      actionType: "MUTATE",
      summary: await run()
    };
  }

  private async validateSubreddits(subreddits: string[]): Promise<{ valid: string[]; invalid: string[] }> {
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const subreddit of subreddits) {
      const canonical = await this.redditClient.validateAndNormalizeSubreddit(subreddit);
      if (canonical) {
        valid.push(canonical.toLowerCase());
      } else {
        invalid.push(subreddit);
      }
    }

    return { valid, invalid };
  }

  private async snapshot(): Promise<string> {
    const policy = await prisma.discoveryPolicy.findFirst();
    const allSubreddits = await prisma.subredditConfig.findMany({
      orderBy: { name: "asc" }
    });
    const latestLearning = await prisma.learningSnapshot.findFirst({
      orderBy: { generatedAt: "desc" }
    });

    const focus = allSubreddits.filter((row) => row.isFocus).map((row) => row.name);
    const allowed = allSubreddits.filter((row) => row.isAllowed).map((row) => row.name);
    const blocked = allSubreddits.filter((row) => row.isBlocked).map((row) => row.name);

    return [
      `Mode: ${policy ? modeToLabel(policy.mode) : "unknown"}`,
      `Paused: ${policy?.isPaused ? "yes" : "no"}`,
      `Last learning update: ${latestLearning?.generatedAt.toISOString() ?? "none"}`,
      `Focus: ${focus.join(", ") || "none"}`,
      `Allow: ${allowed.join(", ") || "none"}`,
      `Block: ${blocked.join(", ") || "none"}`
    ].join("\n");
  }
}
