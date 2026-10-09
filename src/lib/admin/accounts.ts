import { db } from "@/lib/db";
import { ServiceError } from "@/lib/practice/http";
import { hashPassword } from "@/lib/password";
import type { CurrentUser } from "@/lib/guards";
import { emailSchema, passwordSchema } from "@/lib/validation";
import { z } from "zod";

export const adminAccountSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  email: emailSchema,
  password: passwordSchema,
});

export async function createAdminAccount(input: z.infer<typeof adminAccountSchema>, actor: CurrentUser | null) {
  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async (tx) => {
    const existingAdmins = await tx.user.count({ where: { role: "ADMIN" } });
    if (existingAdmins > 0 && actor?.role !== "ADMIN") {
      throw new ServiceError(403, "An admin already exists. Sign in as that admin to add another.");
    }
    const taken = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (taken) throw new ServiceError(409, "That email is already registered.");
    return tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        role: "ADMIN",
        emailVerified: new Date(),
      },
      select: { id: true, email: true, name: true },
    });
  });
}

export async function deleteAdminAccount(id: string, actor: CurrentUser) {
  if (actor.role !== "ADMIN") throw new ServiceError(403, "Forbidden");
  const target = await db.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target || target.role !== "ADMIN") throw new ServiceError(404, "Admin not found.");
  await db.user.delete({ where: { id } });
  const left = await db.user.count({ where: { role: "ADMIN" } });
  return { last: left === 0, self: id === actor.id };
}
