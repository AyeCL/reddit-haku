import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  APP_TIMEZONE: z.string().default("America/Los_Angeles"),
  DEPLOY_TARGET: z.string().default("railway"),
  HEALTH_HOST: z.string().default("0.0.0.0"),
  HEALTH_PORT: z.coerce.number().int().positive().default(8080),

  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_CHANNEL_ID: z.string().min(1),
  APPROVER_DISCORD_USER_ID: z.string().min(1),
  BOT_NAME: z.string().default("Haku"),
  MENTION_CONTEXT_LOOKBACK_MESSAGES: z.coerce.number().int().min(1).max(25).default(10),
  ALLOW_READONLY_MENTION_COMMANDS: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  NON_APPROVER_MENTION_SCOPE: z.string().default("config_status_only"),

  REDDIT_CLIENT_ID: z.string().min(1),
  REDDIT_CLIENT_SECRET: z.string().min(1),
  REDDIT_AUTH_MODE: z.string().default("user_refresh_token"),
  REDDIT_OAUTH_REDIRECT_URI: z.string().url(),
  REDDIT_REFRESH_TOKEN: z.string().optional(),
  REDDIT_ACCOUNT_USERNAME: z.string().optional(),
  REDDIT_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  USE_DB_REDDIT_REFRESH_TOKEN: z.string().default("true").transform((v) => v === "true"),
  REDDIT_USER_AGENT: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),
  AI_MODEL: z.string().default("claude-sonnet-4-5"),
  AI_TEMPERATURE: z.coerce.number().default(0.3),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(1200),
  DEFAULT_TONE_POLICY: z.string().default("helpful_non_promotional_transparent"),
  REPLY_LANGUAGE_MODE: z.string().default("en_only"),

  DISCOVERY_INTERVAL_MINUTES: z.coerce.number().int().positive().default(20),
  DISCOVERY_FETCH_LIMIT: z.coerce.number().int().positive().default(25),
  DISCOVERY_QUERY_TERMS: z.string().default("youanai"),
  MAX_THREADS_PER_RUN: z.coerce.number().int().positive().default(10),
  MAX_SUGGESTIONS_TO_DISCORD: z.coerce.number().int().positive().default(3),
  FOCUS_SUBREDDITS: z.string().min(1),
  DISCOVERY_MODE: z.string().default("focus_plus_similar"),
  SIMILAR_SUBREDDIT_HANDLING: z.string().default("suggest_only"),
  SIMILARITY_STRICTNESS: z.string().default("balanced"),
  POST_APPROVAL_MODE: z.string().default("single_gate"),
  AUTOPUBLISH_SCOPE: z.string().default("comments_only"),
  MAX_REVISIONS_PER_CANDIDATE: z.coerce.number().int().min(0).default(0),
  SUBREDDIT_COOLDOWN_HOURS: z.coerce.number().int().min(0).default(0),
  MAX_THREAD_AGE_HOURS: z.coerce.number().int().positive().default(168),
  MIN_THREAD_UPVOTES: z.coerce.number().int().min(0).default(10),
  MIN_THREAD_COMMENTS: z.coerce.number().int().min(0).default(5),
  THREAD_QUALITY_OPERATOR: z.enum(["OR", "AND"]).default("OR"),
  DAILY_POST_CAP: z.coerce.number().int().min(0).default(0),
  ACTIVE_HOURS_ENABLED: z.string().default("true").transform((v) => v === "true"),
  ACTIVE_HOURS_TIMEZONE: z.string().default("America/Los_Angeles"),
  ACTIVE_HOURS_START: z.string().default("08:00"),
  ACTIVE_HOURS_END: z.string().default("22:00"),
  APPROVAL_EXPIRY_HOURS: z.coerce.number().int().min(0).default(0),

  ENABLE_APPROVED_MEMORY: z.string().default("true").transform((v) => v === "true"),
  LEARNING_SOURCE: z.string().default("approved_plus_rejected_plus_performance"),
  LEARNING_REVIEW_INTERVAL_HOURS: z.coerce.number().int().positive().default(12),
  ENABLE_WEEKLY_LEARNING_DIGEST: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  WEEKLY_DIGEST_INCLUDE_REJECTIONS: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  WEEKLY_DIGEST_INCLUDE_ACCEPTED_PERFORMANCE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  LEARNING_OUTPUT_DESTINATION: z.string().default("approvals_channel"),
  EXCLUDE_PREVIOUSLY_POSTED_THREADS: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  LEARNING_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
  STORE_REJECTED_AS_NEGATIVE_SIGNAL: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  REJECT_STALE_APPROVALS: z.string().default("true").transform((v) => v === "true"),
  RAW_CONTEXT_RETENTION_MODE: z.string().default("forever"),
  CONTEXT_COMPACTION_POST_THRESHOLD: z.coerce.number().int().positive().default(500),
  CONTEXT_COMPACTION_ENABLED: z.string().default("true").transform((v) => v === "true"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  DB_PROVIDER: z.string().default("supabase"),
  MEMORY_RETRIEVAL_MODE: z.string().default("sql"),

  DRY_RUN: z.string().default("true").transform((v) => v === "true"),

  POST_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  NOTIFY_ON_POST_FAILURE: z.string().default("true").transform((v) => v === "true"),
  SEED_SUBREDDIT_VALIDATION_MODE: z.string().default("normalize_and_skip_invalid")
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
