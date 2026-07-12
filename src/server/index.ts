import { buildApplication } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig();
const { app } = await buildApplication(config);

const close = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
