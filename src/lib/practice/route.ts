import { apiUser, type CurrentUser } from "@/lib/guards";
import { handle } from "@/lib/practice/http";

type Params = Record<string, string>;
type Ctx = { params: Promise<Params> };

/**
 * Wraps a route handler: 401 when signed out, error mapping for expected failures, and
 * resolved path params. Every student-facing API route goes through this.
 */
export function userRoute(
  fn: (user: CurrentUser, req: Request, params: Params) => Promise<Response>,
  opts: { admin?: boolean } = {},
) {
  return (req: Request, ctx: Ctx) =>
    handle(async () => {
      const { user, response } = await apiUser({ admin: opts.admin });
      if (response) return response;
      return fn(user, req, await ctx.params);
    });
}

export const noStore = { "Cache-Control": "no-store" };

/** Parses a path segment as a non-negative integer, or returns null. */
export function intParam(v: string | undefined): number | null {
  if (v === undefined || !/^\d{1,4}$/.test(v)) return null;
  return Number(v);
}
