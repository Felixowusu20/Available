import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// A structural guard, not a behaviour test: it reads the source code. Premium may only come from a verified payment
// or an admin, never from a page a student can visit. If someone adds a new place that sets premium, this test
// fails and they have to stop and think about whether that place is safe.

const SRC = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "generated" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
const rel = (p: string) => relative(SRC, p).split(sep).join("/");

describe("where premium can be set", () => {
  it("only the payment confirmation and the admin tools write premiumAt", () => {
    const writers = files(SRC)
      .filter((f) => /premiumAt\s*:\s*(?!\{\s*not)/.test(readFileSync(f, "utf8")) && /\.(update|updateMany|create|upsert)\(/.test(readFileSync(f, "utf8")))
      .map(rel)
      .sort();
    expect(writers).toEqual(["lib/premium/admin.ts", "lib/premium/confirm.ts"]);
  });

  it("only the webhook, the automatic Paystack check, and the admin re-check can reach the code that confirms payments", () => {
    const users = files(SRC)
      .filter((f) => /from "@\/lib\/premium\/confirm"/.test(readFileSync(f, "utf8")))
      .map(rel)
      .sort();
    expect(users).toEqual(["app/api/paystack/webhook/route.ts", "lib/premium/admin.ts", "lib/premium/settle.ts"]);
  });

  it("the pages a student lands on after paying never confirm a charge themselves", () => {
    const pages = files(join(SRC, "app", "(app)", "unlock"));
    expect(pages.length).toBeGreaterThan(0);
    for (const f of pages) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/premium\/confirm|applyCharge|handleWebhook|verifyTransaction/);
  });
});
