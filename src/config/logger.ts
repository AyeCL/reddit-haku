import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "haku",
    deployTarget: env.DEPLOY_TARGET
  }
});
