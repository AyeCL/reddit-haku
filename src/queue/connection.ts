import type { ConnectionOptions } from "bullmq";
import { env } from "../config/env";

export function createBullmqConnection(): ConnectionOptions {
  const parsed = new URL(env.REDIS_URL);
  const isTls = parsed.protocol === "rediss:";
  const dbFromPath = parsed.pathname ? Number(parsed.pathname.replace("/", "")) : 0;
  const db = Number.isNaN(dbFromPath) ? 0 : dbFromPath;

  const base: ConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    db,
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  };

  if (parsed.username) {
    (base as ConnectionOptions & { username: string }).username = parsed.username;
  }
  if (parsed.password) {
    (base as ConnectionOptions & { password: string }).password = parsed.password;
  }
  if (isTls) {
    (base as ConnectionOptions & { tls: object }).tls = {};
  }

  return base;
}
