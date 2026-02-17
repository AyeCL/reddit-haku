# Youanai Reddit-to-Discord Bot Initial Plan

## Goal
Build an AI-assisted bot named `Haku` that:
- discovers high-signal Reddit threads about Youanai,
- proposes replies and sends them to Discord for approval,
- posts to Reddit only after approval from the authorized approver account, using your authorized personal Reddit account,
- accepts mention-based control commands in Discord to adjust discovery behavior.

## Stack Decision

### Recommended
- Language/runtime: TypeScript on Node.js 22 LTS
- Bot framework: `discord.js`
- AI layer: Vercel AI SDK (`ai` + `@ai-sdk/anthropic`)
- Model: `claude-sonnet-4-5` (configurable via env)
- Reddit integration: Reddit OAuth + REST API (read + submit scopes)
- Data store: PostgreSQL + Prisma
- Queue/scheduler: BullMQ + Redis repeatable jobs (20m discovery, 12h learning, weekly digest)

### Why This Is The Best Fit
- Vercel AI SDK is strongest in TypeScript, so we avoid glue code.
- `discord.js` is mature and event-friendly for reactions + reply loops.
- TypeScript gives strong typing for workflow state transitions (pending -> approved -> posted/cancelled).
- PostgreSQL gives durable state and audit history for what was approved/posted.

### Alternatives
- Python: Faster Reddit scripting with PRAW, but weaker alignment with Vercel AI SDK ergonomics.
- Go/Rust: Great performance, but slower iteration and smaller ecosystem for this exact AI + Discord workflow.

## Reddit Auth Strategy (Personal Account)
- Use user OAuth authorization-code flow with permanent refresh token.
- Authenticate once with your personal Reddit account, then store refresh token securely for background posting.
- Refresh access tokens server-side before API calls.
- Avoid storing Reddit password in app config.
- MVP does not require a full webapp: use a one-time local auth callback script to connect account.
- Optional V2: add a small web UI for reconnect/revoke/account management.

## Product Workflow (Target Behavior)
1. Every 20 minutes, fetch candidate Reddit threads from configured subreddits.
2. Rank and filter to keep only high-quality opportunities.
3. Generate a ready-to-send draft comment.
4. Post a Discord message with thread link + draft + reactions `👍` and `👎`.
5. If `👍` is added by the configured approver user only, post comment to Reddit and send confirmation in Discord.
6. If approver replies with edits (for example, "add this line"), regenerate draft using:
   - current Reddit thread context,
   - all previous revision history for this candidate,
   - latest human edit instruction.
7. Send revised draft as a new approval message; repeat until approved or rejected.
8. If `👎` by approver, mark cancelled and stop.
9. On approved + posted comments, persist learning artifacts (thread features + final approved comment).

## Learning Loop (12-Hour + Weekly)
- Store approved comments as positive learning memory for style and relevance.
- Store rejected drafts as negative ranking signals (avoid similar weak candidates in future).
- Collect post-performance signals for accepted comments (for example score/replies over time).
- Run recurring learning jobs:
  - every 12 hours: incremental review and quick ranking/style updates,
  - weekly: deeper review across accepted + rejected + performance trends.
- Post learning outputs to Discord in the approvals channel so decision context stays centralized.
- Feed both 12-hour and weekly learning outputs back into:
  - thread ranking/scoring,
  - dedupe heuristics,
  - draft-generation guidance.
- Keep raw learning/context records indefinitely, but enable auto-compaction once scale grows (threshold-based).

## Mention Command Workflow (`@Haku`)
1. Approver mentions `@Haku` in Discord.
2. Bot loads mention message plus up to 10 prior channel messages as context.
3. Bot runs command-intent parsing with tool-calling enabled.
4. If command is config-related, bot can call internal tools to update subreddit strategy.
5. Bot replies with a concise change summary and the updated config snapshot.

## Initial Focus Subreddits
- `r/SaaS`
- `r/startups`
- `r/entrepreneur`
- `r/smallbusiness`
- `r/marketing`
- `r/socialmedia`
- `r/agency`
- `r/digitalmarketing` (validate existence during setup; auto-skip or map if needed)
- Validate all seed subreddits at startup via Reddit API and store canonical names.

### Supported Command Intents (MVP)
- Update focus list: "focus on r/SaaS, r/marketing and similar"
- Add or remove explicitly allowed subreddits
- Show current discovery configuration
- Pause/resume discovery

### Mention Permissions Policy
- Approver (`APPROVER_DISCORD_USER_ID`): full read/write command access.
- Non-approver users: read-only config/status command access for visibility.
- Read-only examples: "show focus list", "show mode", "show learning status".
- Mutating commands from non-approvers should be rejected with a clear permission response.

## Security and Correctness Rules
- Approval identity: validate Discord user by immutable user ID (`APPROVER_DISCORD_USER_ID`), not display name (`@youanai`).
- Mention-command identity: execute config-changing tool calls only when mention author is `APPROVER_DISCORD_USER_ID`.
- Least privilege Reddit scopes: start with `read` and `submit` only.
- Use OAuth refresh-token auth for personal account access; do not rely on password grant.
- Add dedupe guardrails so the same Reddit post is not repeatedly suggested.
- Do not enforce subreddit cooldown for now; rely on dedupe + ranking + manual approval controls.
- Sanitize and constrain prompt inputs (Reddit text can contain adversarial instructions).
- Keep dry-run mode for safe end-to-end testing.
- Persist command audit logs for every config mutation (who, when, before/after).
- Persist posted-thread history and block future re-suggestions of the same thread.

## Proposed Service Modules
- `src/queue/scheduler.ts`: repeatable job registration in BullMQ.
- `src/queue/worker.ts`: queue worker processor and job lifecycle logging.
- `src/worker.ts`: worker process bootstrap (job execution runtime).
- `src/reddit/reddit.client.ts`: OAuth token + search + comment API calls.
- `src/reddit/thread-filter.service.ts`: filtering, dedupe, and ranking.
- `src/ai/draft.service.ts`: Vercel AI SDK generation and rewrite logic.
- `src/ai/learning.service.ts`: builds prompts from approved-comment memory.
- `src/reddit/performance.client.ts`: fetches performance snapshots for previously posted comments/threads.
- `src/discord/discord.bot.ts`: publish candidate messages and handle events.
- `src/discord/mention-command.service.ts`: parse `@Haku` mentions and load 10-message context window.
- `src/ai/tool-router.service.ts`: maps model tool calls to internal config actions.
- `src/approval/approval.service.ts`: state machine for approve/reject/revise.
- `src/posting/posting.service.ts`: execute Reddit comments and post status back to Discord.
- `src/posting/posting-memory.service.ts`: writes approved posting outcomes into learning memory.
- `src/storage/*`: Prisma schema and persistence layer.

## Discovery Strategy Model
- `focus_subreddits`: high-priority seed subreddits provided by team.
- `allow_subreddits`: explicitly approved subreddits.
- `block_subreddits`: explicitly excluded subreddits.
- `similarity_expansion`: optional exploration of subreddits similar to focus seeds.

### Discovery Policy
- Search broadly across Reddit, but score matches in `focus_subreddits` and semantically similar communities higher.
- Never propose threads from blocked subreddits.
- Require allowlist membership for posting, unless discovery mode explicitly permits "suggest-only" outside allowlist.
- Keep semantically similar subreddits in suggest-only mode by default; do not auto-add them to allowlist.
- Use balanced similarity expansion (not strict, not aggressive).
- Exclude any Reddit thread already posted by Haku from future candidate lists.
- Prefer threads up to 7 days old.
- Minimum candidate quality threshold: `>=10 upvotes OR >=5 comments`.

## AI Tools for Config Mutation (Internal)
- `getDiscoveryConfig()`
- `addFocusSubreddits(subreddits[])`
- `removeFocusSubreddits(subreddits[])`
- `addAllowSubreddits(subreddits[])`
- `removeAllowSubreddits(subreddits[])`
- `setDiscoveryMode(mode)` where `mode` in (`focus_only`, `focus_plus_similar`, `broad_suggest_only`)
- `pauseDiscovery()` / `resumeDiscovery()`

All config tools should:
- enforce approver authorization,
- validate subreddit names,
- write audit logs,
- return updated config after mutation.

## Data Model (MVP)
- `subreddit_config`: subreddit name, query hints, enabled, interval.
- `thread_candidate`: Reddit post metadata, dedupe hash, score, status.
- `draft_revision`: draft text, rationale, revision number, prompt input snapshot.
- `discord_message_map`: Discord message IDs mapped to revision IDs.
- `approval_event`: who approved/rejected/replied and when.
- `reddit_comment_post`: posted comment ID/permalink and timestamps.
- `discovery_policy`: mode + tuning parameters.
- `focus_subreddit`: prioritized seeds editable via mention commands.
- `allow_subreddit`: approved communities for posting.
- `block_subreddit`: excluded communities.
- `discord_command_event`: mention command history and tool mutations.
- `approved_comment_memory`: approved final comments with thread metadata/features.
- `posted_thread_history`: canonical list of already-commented threads for hard dedupe.
- `learning_snapshot`: 12-hour rollup summaries and ranking signal updates.
- `weekly_learning_digest`: weekly trend analysis output (accepted + rejected + performance).
- `comment_performance_snapshot`: periodic performance data for approved/posted comments.
- `discord_context_message`: persisted context windows used for mention-command decisions (up to 10 prior messages per event).
- `rejected_draft_signal`: rejected drafts stored as negative ranking signals.
- `compacted_context_summary`: compressed memory summaries generated after threshold compaction.

## Persistence Strategy (Decided)
- Use PostgreSQL as the source of truth for workflow state, message windows, approvals, posted history, and learning memory.
- Do not use Markdown files as machine memory for learning state.
- Optionally publish human-readable learning summaries to docs/Discord, but keep canonical data in DB.
- Production DB host: Supabase Postgres.
- Runtime host target: Railway.
- Memory retrieval in MVP: SQL-first (no vector search initially).
- Context retention mode: keep raw forever; start auto-compaction to summaries after approximately 500 posted comments.

## Draft Generation Defaults
- Reply length mode: adaptive based on thread tone and context.
- Include affiliation disclosure contextually when relevant (for example, "I'm with Youanai" where trust/clarity needs it).
- Reply language: English-only for now.

## Discord UX Format
Each candidate message should include:
- subreddit + post title + post link
- concise reason this thread is a good target
- proposed reply text
- explicit instruction: "React 👍 to send, 👎 to cancel, or reply with edits"

Mention command responses should include:
- recognized intent,
- action taken (or rejected with reason),
- current discovery mode + key subreddit lists.

## Reddit API Notes (What We Need First)
- Read/search endpoints to discover relevant threads.
- `POST /api/comment` to publish approved replies.
- OAuth2 API usage for authenticated actions.

## Suggested Scaffolding (First Build Pass)
1. Initialize TypeScript project + strict linting + formatting.
2. Add Discord bot connectivity and event handlers for reactions and replies.
3. Add mention-command handler with 10-message context fetch.
4. Add Reddit OAuth client with search + comment methods.
5. Add generation service using Vercel AI SDK + Sonnet and internal tool-calling.
6. Add database models for approvals + discovery config + posted/approved memory.
7. Implement BullMQ repeatable jobs for 20-minute discovery + 12-hour learning + weekly digest.
8. Implement posting retry policy (up to 3 retries) with Discord failure notifications.
9. Implement post-performance snapshot collection for learning feedback.
10. Implement dry-run end-to-end test.

## MVP Milestones
- Milestone 1: Discovery + Discord draft delivery (no posting yet).
- Milestone 2: Approval-gated posting to Reddit.
- Milestone 3: Multi-revision edit loop with full history context.
- Milestone 4: Mention-command control plane (`@Haku`) with config mutation tools.
- Milestone 5: Learning loop (12-hour incremental + weekly digest, including rejects/performance feedback).
- Milestone 6: Reliability hardening (retry, rate limits, queueing, observability).

## Implementation Status Snapshot
- Milestone 1 implemented in code scaffold and runtime flow.
- Milestone 2 implemented with approver-only `👍` posting + allowlist guardrails.
- Milestone 3 implemented with reply-driven revision loop and stale-approval rejection.
- Milestone 4 implemented with `@Haku` read/mutate command routing and permission gates.
- Milestone 5 implemented with 12-hour learning snapshots + weekly digest + performance capture.
- Milestone 6 implemented with retry/backoff, rate-limit telemetry, posting idempotency locks, and health/readiness endpoints.
- Scheduling runtime now uses BullMQ worker architecture instead of in-process cron timers.

## Open Decisions To Confirm
- None for MVP planning. Remaining items are implementation details and API credentials.

## Decisions Locked
- Similar subreddit handling: suggest-only until explicitly approved.
- Non-approver mention policy: allow read-only `@Haku` commands for visibility.
- Posting safety gate: single gate (`👍` from approver posts immediately).
- Reddit account strategy: single account for now.
- Candidate volume: 3 suggestions per 20-minute run.
- Tone policy: helpful + non-promotional + transparent.
- Autopost scope: comments only for now.
- Similarity strictness: balanced.
- Edit-loop revision cap: unlimited.
- Subreddit cooldown: none for now.
- Learning memory: store all approved comments and use for future ranking/drafting.
- Alerts: Discord-only for MVP.
- Initial thread age preference: up to 7 days old.
- Minimum candidate threshold: `>=10 upvotes OR >=5 comments`.
- Active hours: 8:00 AM to 10:00 PM Pacific time.
- Daily posting cap: none (approval-gated manual control only).
- Learning retention: keep forever.
- Rejected drafts: store as negative ranking signals.
- Stale approvals: reject stale approval and require approval on latest revision.
- Context storage: keep raw history; auto-compact to summaries after large scale (~500 posted comments).
- Production DB host: Supabase Postgres.
- Memory retrieval engine: SQL-first in MVP.
- Posting failure policy: auto-retry up to 3 times and notify Discord if still failing.
- Seed subreddit validation: normalize/skip invalid subreddit names and continue startup.
- Learning cadence: run both 12-hour incremental learning and weekly deep digest.
- Weekly digest scope: include accepted + rejected + performance signals.
- Learning output location: approvals channel (single channel).
- Learning output location: approvals channel (no dedicated thread).
- Non-approver mentions: read-only config/status only.
- Reply language: English-only.
- Approval expiry: never auto-expire.
