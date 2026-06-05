import { env, prisma } from "@e-verify-it/backend";
import { buildServer } from "./server";

async function main() {
  const app = await buildServer();

  try {
    await app.listen({ host: "0.0.0.0", port: env.API_PORT });
    app.log.info(`API listening on port ${env.API_PORT}`);
  } catch (error) {
    app.log.error(error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();

