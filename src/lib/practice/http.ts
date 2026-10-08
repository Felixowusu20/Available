import { logger, safeError } from "@/lib/logger";
import { NotEnoughQuestionsError } from "@/lib/practice/compose";

/** An expected failure with a client-safe message and HTTP status. */
export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Runs a route body and converts known errors to JSON responses; unknown errors become a logged 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof NotEnoughQuestionsError) return Response.json({ error: err.message }, { status: 422 });
    logger.error({ err: safeError(err) }, "unhandled route error");
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
