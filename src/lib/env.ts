import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v.toLowerCase() === "true"));

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(16),
  REQUIRE_EMAIL_VERIFICATION: bool(true),

  EMAIL_FROM: z.string().default("Available <no-reply@example.com>"),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),

  ANTHROPIC_API_KEY: z.string().optional().default(""),
  AI_TAGGING_MODEL: z.string().default("claude-haiku-5-5"),
  AI_QUALITY_MODEL: z.string().default("claude-sonnet-5-5"),
  AI_QUALITY_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),

  // Paystack, for the one-time premium unlock. Empty means payments are off. Use a TEST key (sk_test_...) until
  // launch; a live key is refused unless PAYSTACK_ALLOW_LIVE=true, so one cannot be used by accident.
  PAYSTACK_SECRET_KEY: z.string().optional().default(""),
  PAYSTACK_ALLOW_LIVE: bool(false),
  PREMIUM_PRICE_PESEWAS: z.coerce.number().int().min(100).max(1_000_000).default(1000),

  EXAM_SECONDS_PER_QUESTION: z.coerce.number().int().min(10).max(600).default(72),
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed, validated environment. Server-side only; throws a readable error on bad config. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}

export const paystackEnabled = () => env().PAYSTACK_SECRET_KEY.length > 0;
export const aiEnabled = () => env().ANTHROPIC_API_KEY.length > 0;
