import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export type CurrentUser = { id: string; email: string; name: string | null; role: "STUDENT" | "ADMIN" };

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
    select: { id: true, email: true, name: true, role: true, tokenVersion: true },
  });
  if (!user || user.tokenVersion !== session.tv) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/** Where a signed-in user should land. Admins open the console; everyone else opens the student dashboard. */
export function homeFor(user: CurrentUser): "/admin" | "/dashboard" {
  return user.role === "ADMIN" ? "/admin" : "/dashboard";
}

/** For pages / server components: redirects to /login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For admin pages. Sends visitors to setup when no admin exists, and students back to the dashboard. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user?.role === "ADMIN") return user;
  const admins = await db.user.count({ where: { role: "ADMIN" } });
  if (admins === 0) redirect("/admin/setup");
  if (!user) redirect("/login");
  redirect("/dashboard");
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
