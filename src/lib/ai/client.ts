import Anthropic from "@anthropic-ai/sdk";
import { aiEnabled, env } from "@/lib/env";

/** The only part of the SDK the pipeline uses, so tests can pass a fake. */
export type AiClient = { messages: Pick<Anthropic["messages"], "parse"> };

export class AiUnavailableError extends Error {
  constructor() {
    super("AI features are unavailable: no ANTHROPIC_API_KEY is configured.");
  }
}

let cached: AiClient | undefined;

/**
 * Server-side only. The key comes from the environment and is never sent to the browser.
 * The SDK retries 408/409/429/5xx and connection errors with backoff (honouring retry-after).
 */
export function getAiClient(): AiClient {
  if (!aiEnabled()) throw new AiUnavailableError();
  cached ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 5, timeout: 120_000 });
  return cached;
}
