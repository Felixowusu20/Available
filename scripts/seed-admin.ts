import "./load-env";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { emailSchema, passwordSchema } from "../src/lib/validation";

// Creates the admin account from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD, or promotes and
// resets the password of that account if it already exists. Safe to re-run.
async function main() {
  const email = emailSchema.parse(process.env.ADMIN_SEED_EMAIL ?? "");
  const password = passwordSchema.parse(process.env.ADMIN_SEED_PASSWORD ?? "");
  const passwordHash = await hashPassword(password);

  const user = await db.user.upsert({
    where: { email },
    create: { email, name: "Admin", passwordHash, role: "ADMIN", emailVerified: new Date() },
    update: { passwordHash, role: "ADMIN", emailVerified: new Date(), tokenVersion: { increment: 1 } },
  });
  console.log(`Admin ready: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
