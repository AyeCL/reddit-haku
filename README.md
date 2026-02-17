# Haku (Youanai Reddit Bot)

Haku discovers Reddit threads, drafts replies with AI, sends approval cards to Discord, and posts to Reddit only after approver reaction.

## Implemented MVP Behaviors
- BullMQ repeatable discovery job every 20 minutes (active-hours aware)
- Candidate ranking with focus boosts + approved/rejected learning signals
- Discord approval cards with `👍` / `👎`
- Approver-only posting gate and revision loop via Discord reply
- Mention-command control plane (`@Haku`) for config/status and policy mutation (permission-gated)
- BullMQ repeatable 12-hour learning snapshot + weekly digest
- Performance snapshot collection (24h + 7d windows)
- Retry-on-post-failure with Discord notification
- Health/readiness endpoints for app process (`/health`, `/ready`)

## Stack
- TypeScript + Node.js 22
- Discord: `discord.js`
- AI: Vercel AI SDK + Anthropic Sonnet
- Storage: PostgreSQL (Supabase) + Prisma
- Runtime target: Railway

## Setup
1. Install dependencies:
```bash
npm install
```
2. Copy environment template and fill values:
```bash
cp .env.example .env
```
3. Generate Prisma client + apply DB schema:
```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```
4. Run one-time personal Reddit OAuth connect flow:
```bash
npm run oauth:reddit
```
- If `DATABASE_URL`, `REDDIT_TOKEN_ENCRYPTION_KEY`, and `REDDIT_ACCOUNT_USERNAME` are set, the script stores encrypted refresh token in DB.
- Otherwise, copy the printed `REDDIT_REFRESH_TOKEN` to `.env`.

## Run
- Dev app process (Discord interactions + health):
```bash
npm run dev
```
- Dev worker process (BullMQ jobs):
```bash
npm run dev:worker
```
- Typecheck:
```bash
npm run typecheck
```
- Build:
```bash
npm run build
```
- Production app command:
```bash
npm run start
```
- Production worker command:
```bash
npm run start:worker
```

## Ops Endpoints
- `GET /health`: process alive + runtime counters
- `GET /ready`: readiness status (DB connected + Discord connected)

## Key Files
- App bootstrap/wiring: `src/app.ts` (`src/index.ts`)
- Worker bootstrap/wiring: `src/worker.ts`
- Health server: `src/monitoring/health.server.ts`
- Discovery pipeline: `src/discovery/discovery.service.ts`
- Discord event handling: `src/discord/discord.bot.ts`
- Mention command router: `src/ai/tool-router.service.ts`
- Approval/revision/post workflow: `src/workflow/workflow.service.ts`
- Reddit API client + OAuth refresh: `src/reddit/reddit.client.ts`
- Learning jobs: `src/ai/learning.service.ts`, `src/reddit/performance.client.ts`
- Queue scheduling/worker: `src/queue/scheduler.ts`, `src/queue/worker.ts`
- Data model: `prisma/schema.prisma`
