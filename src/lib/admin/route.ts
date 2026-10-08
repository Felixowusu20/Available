import type { CurrentUser } from "@/lib/guards";
import { userRoute } from "@/lib/practice/route";

/** Route wrapper for admin-only endpoints: 401 when signed out, 403 for students. */
export function adminRoute(fn: (admin: CurrentUser, req: Request, params: Record<string, string>) => Promise<Response>) {
  return userRoute(fn, { admin: true });
}
