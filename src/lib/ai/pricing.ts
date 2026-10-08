// Approximate list prices in USD per million tokens, used only to show an ESTIMATED cost next to the
// token counts. Tokens are the source of truth; check Anthropic's pricing page and edit this table
// if prices change or you switch the models in .env. Unknown models show no estimate.
const PRICES: { prefix: string; input: number; output: number }[] = [
  { prefix: "claude-haiku-5-5", input: 0.1, output: 0.5 }, // prompts up to 100K tokens
  { prefix: "claude-sonnet-5-5", input: 2, output: 10 },
  { prefix: "claude-sonnet-5", input: 2, output: 10 },
  { prefix: "claude-opus-5-5", input: 4, output: 20 },
  { prefix: "claude-opus-5", input: 5, output: 25 },
];

const CACHE_READ_FACTOR = 0.1;

export function estimateCostUsd(model: string, tokens: { input: number; output: number; cacheRead: number }): number | null {
  const p = PRICES.find((x) => model.startsWith(x.prefix));
  if (!p) return null;
  // `input` here means uncached input tokens, which is what the API reports as input_tokens.
  return (tokens.input * p.input + tokens.cacheRead * p.input * CACHE_READ_FACTOR + tokens.output * p.output) / 1_000_000;
}
