import { App } from "./app";
import { logger } from "./config/logger";

const app = new App();

async function bootstrap(): Promise<void> {
  await app.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down Haku");
    await app.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrap().catch((error) => {
  logger.error({ err: error }, "Failed to bootstrap Haku");
  process.exit(1);
});
