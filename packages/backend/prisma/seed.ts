import { hash } from "bcryptjs";
import { prisma } from "../src/prisma";
import { env } from "../src/env";

async function main() {
  const passwordHash = await hash(env.ADMIN_PASSWORD, 12);

  await prisma.adminUser.upsert({
    where: { email: env.ADMIN_EMAIL.toLowerCase() },
    update: { passwordHash },
    create: {
      email: env.ADMIN_EMAIL.toLowerCase(),
      passwordHash
    }
  });

  console.log(`Seeded admin user ${env.ADMIN_EMAIL.toLowerCase()}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

