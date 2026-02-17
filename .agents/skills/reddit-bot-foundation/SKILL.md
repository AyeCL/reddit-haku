---
name: reddit-bot-foundation
description: Use when working in the reddit-bot repository to design or implement the Youanai Reddit-to-Discord approval workflow, including discovery, draft generation, Discord approvals, revision loops, and approved posting behavior.
---

# Reddit Bot Foundation

- Call the user `acl`.
- Treat this repository as a TypeScript-first codebase unless acl asks otherwise.
- Keep the core product flow intact: discover high-quality threads, draft replies, send to Discord, require approval, then post.
- Treat the bot name as `Haku` and support mention-based commands (`@Haku`) as part of core behavior.
- For implementation audits, run plan-to-code parity checks with file-backed evidence; do not rely solely on status snapshots in docs.
- Validate approver identity by Discord user ID (`APPROVER_DISCORD_USER_ID`) rather than username/display name.
- Process mention commands with up to 10 prior Discord messages as context by default.
- Allow AI tool-calls to update subreddit focus/allow/block lists, but gate all mutating actions to the approver user ID.
- Allow non-approver users to run read-only config/status mention commands for visibility; reject their mutating commands.
- Treat semantically similar subreddits as suggest-only; require explicit approval before allowlist changes.
- Prefer balanced similarity discovery mode and comments-only posting scope in MVP.
- Keep posting gate as single-step approval (`👍` from approver posts immediately).
- Post using acl's authorized personal Reddit account via OAuth refresh-token flow (not username/password storage).
- Use one-time local OAuth callback script for initial personal-account connection in MVP.
- Use accepted + rejected + accepted-performance signals in learning, with a 12-hour incremental review plus weekly deep digest.
- Discovery currently pulls from subreddit `new` feeds plus global search query terms, then ranks with learning-aware subreddit boosts/penalties.
- Exclude previously posted Reddit threads from future suggestions.
- Prefer threads up to 7 days old with minimum quality threshold (`>=10 upvotes OR >=5 comments`).
- Default focus seeds: `r/SaaS,r/startups,r/entrepreneur,r/smallbusiness,r/marketing,r/socialmedia,r/agency,r/digitalmarketing`, with startup validation/normalization.
- Generate adaptive-length replies that fit thread vibe while remaining helpful, non-promotional, and transparent.
- Keep reply language English-only in MVP.
- Run in active-hours mode (8:00 AM to 10:00 PM Pacific) and keep daily post cap unlimited with manual approval gating.
- Keep learning data in PostgreSQL (not markdown), retain approved memory indefinitely, and store rejected drafts as negative ranking signals.
- Keep raw context indefinitely, but auto-compact memory to summaries after scale threshold (about 500 posted comments).
- Use Supabase Postgres for hosted persistence and SQL-first memory retrieval in MVP.
- If DB + encryption env vars are present, OAuth bootstrap script persists encrypted Reddit refresh token in `reddit_auth_credential`.
- Deploy runtime on Railway for always-on bot execution.
- On Reddit post failure, retry up to 3 times and notify Discord if still failing.
- Reject stale approvals when a newer draft revision exists.
- Keep approvals non-expiring unless manually resolved.
- Use `POSTING` candidate status as an idempotency lock to prevent duplicate posts on concurrent approvals.
- Keep Railway health endpoints enabled (`/health`, `/ready`) for uptime/readiness checks.
- Publish learning updates in the approvals channel (no dedicated thread).
- Use Vercel AI SDK with Anthropic Sonnet model configured via env (`AI_MODEL`) and default to latest Sonnet.
- Use `/Users/ayecl/workspace/Company/reddit-bot/docs/about-youanai.md` as canonical brand/context grounding for generated drafts.
- Preserve auditability: persist approvals, revisions, and posted-comment links.
