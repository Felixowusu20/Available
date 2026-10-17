import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";

/** `premium`: the account has the one-time unlock (admins always count as premium). */
export type CurrentUser = { id: string; email: string; name: string | null; role: "STUDENT" | "ADMIN"; premium: boolean };

/**
 * Resolves the signed-in user from the database (not just the JWT), so a demoted admin
 * or a user whose password was reset loses access immediately. Returns null if not signed in.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, tokenVersion: true, premiumAt: true },
  });
  if (!user || user.tokenVersion !== session.tv) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, premium: user.role === "ADMIN" || user.premiumAt !== null };
}

/** For pages / server components: redirects to /login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: redirects non-admins home. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");
  return user;
}

/** For route handlers: returns the user or a ready-made 401/403 Response. */
export async function apiUser(opts: { admin?: boolean } = {}): Promise<
  { user: CurrentUser; response?: undefined } | { user?: undefined; response: Response }
> {
  const user = await getCurrentUser();
  if (!user) return { response: Response.json({ error: "Unauthorised" }, { status: 401 }) };
  if (opts.admin && user.role !== "ADMIN") {
    return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}
