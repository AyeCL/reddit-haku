import { createServer, type Server } from "http";
import { env } from "../config/env";
import { logger } from "../config/logger";

export type RuntimeState = {
  startedAt: string;
  dbConnected: boolean;
  discordReady: boolean;
  discoveryRuns: number;
  discoveryFailures: number;
  learningRuns: number;
  learningFailures: number;
  weeklyRuns: number;
  weeklyFailures: number;
  lastDiscoveryRunAt: string | null;
  lastLearningRunAt: string | null;
  lastWeeklyRunAt: string | null;
};

export class HealthServer {
  private server: Server | null = null;

  constructor(private readonly getState: () => RuntimeState) {}

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = req.url ?? "/";
      if (url === "/health") {
        this.respond(res, 200, {
          ok: true,
          service: "haku",
          state: this.getState()
        });
        return;
      }

      if (url === "/ready") {
        const state = this.getState();
        const ready = state.dbConnected && state.discordReady;
        this.respond(res, ready ? 200 : 503, {
          ok: ready,
          ready,
          state
        });
        return;
      }

      this.respond(res, 404, {
        ok: false,
        error: "not_found"
      });
    });

    await new Promise<void>((resolve) => {
      this.server?.listen(env.HEALTH_PORT, env.HEALTH_HOST, () => {
        logger.info(
          { host: env.HEALTH_HOST, port: env.HEALTH_PORT },
          "Health server listening"
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.server = null;
  }

  private respond(
    res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body: string) => void },
    statusCode: number,
    payload: unknown
  ): void {
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  }
}
