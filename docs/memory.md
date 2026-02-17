# Haku Working Memory

Last updated: 2026-02-17
Owner: acl + Codex

## Purpose
Use this file as persistent working memory for the project:
- progress updates
- implementation notes
- decisions
- next steps
- resume points after interruptions

## Mission Snapshot
Build Haku: an AI Reddit discovery + Discord approval bot for Youanai that:
1. Finds high-signal Reddit threads every 20 minutes.
2. Drafts ready-to-send comments.
3. Sends candidates to Discord with `👍`/`👎`.
4. Posts only after approver (`APPROVER_DISCORD_USER_ID`) approval.
5. Supports iterative revision loop through Discord replies.
6. Learns from approved, rejected, and performance signals over time.

## Locked Product Decisions
- Runtime host: Railway.
- DB: Supabase Postgres.
- Reddit auth: personal Reddit account via OAuth refresh token.
- OAuth bootstrap: one-time local callback script.
- Discovery mode default: focus + similar (similar is suggest-only).
- Candidate cadence: every 20 minutes.
- Candidate delivery count: 3 suggestions per run.
- Freshness window: up to 7 days old.
- Quality threshold: `>=10 upvotes OR >=5 comments`.
- Approval gate: single `👍` from approver posts.
- Non-approver permissions: read-only config/status mentions.
- Learning cadence: 12-hour incremental + weekly digest.
- Learning output: approvals channel (no dedicated thread).
- Learning retention: keep raw history; auto-compaction threshold ~500 posted comments.
- Language: English-only.
- Approval expiry: none.
- Scheduling runtime: BullMQ workers on Redis (no in-process cron).

## Milestone Tracker
- [x] M1 Discovery + Discord draft delivery
- [x] M2 Approval-gated posting to Reddit
- [x] M3 Multi-revision edit loop
- [x] M4 Mention-command control plane
- [x] M5 Learning loops (12h + weekly + performance snapshots)
- [x] M6 Reliability hardening (retry/backoff, rate-limit telemetry, idempotency lock, health/readiness endpoints)

## Current Code State
- Typecheck: passing (`npm run typecheck`)
- Build: passing (`npm run build`)
- Prisma generate: passing (`npm run prisma:generate`)
- Core workflow paths implemented in:
  - `src/discovery/discovery.service.ts`
  - `src/workflow/workflow.service.ts`
  - `src/reddit/reddit.client.ts`
  - `src/discord/discord.bot.ts`
  - `src/ai/tool-router.service.ts`
  - `src/ai/learning.service.ts`
  - `src/reddit/performance.client.ts`
  - `src/queue/scheduler.ts`
  - `src/queue/worker.ts`
  - `src/worker.ts`
  - `prisma/schema.prisma`

## Remaining External Setup
1. Fill `.env` with real secrets/IDs.
2. Run DB migration:
   - `npm run prisma:migrate -- --name init`
3. Run Reddit OAuth bootstrap:
   - `npm run oauth:reddit`
4. Start app process:
   - `npm run dev`
5. Start worker process:
   - `npm run dev:worker`
6. Deploy app + worker on Railway with env parity.

## Reliability Follow-Ups (Post-Launch Tuning)
- Add explicit dashboards/alerts around existing rate-limit telemetry.
- Add failure alerts for scheduler misses and DB connectivity issues.

## Activity Log
- 2026-02-17: Created full TypeScript scaffold and wired end-to-end core flow.
- 2026-02-17: Implemented discovery pipeline, ranking, dedupe, and candidate publishing.
- 2026-02-17: Implemented approval reactions (`👍`/`👎`) and revision reply loop.
- 2026-02-17: Implemented mention command router with read/mutate permission gates.
- 2026-02-17: Implemented learning snapshots + weekly digest + performance snapshot collection.
- 2026-02-17: Added encrypted Reddit token persistence path via OAuth bootstrap script.
- 2026-02-17: Added this `docs/memory.md` as persistent working notebook.
- 2026-02-17: Closed reliability milestone with Reddit backoff+rate-limit logging, POSTING idempotency lock, and `/health`/`/ready` endpoints.
- 2026-02-17: Migrated scheduling from `node-cron` to BullMQ repeatable jobs + dedicated worker process.
- 2026-02-17: Split runtime responsibilities into app process (`src/index.ts`) and worker process (`src/worker.ts`).
