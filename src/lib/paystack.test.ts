import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { estimateFee, formatGhs } from "./money";
import { livePaymentsAllowed, paystackMode, verifySignature } from "./paystack";

const SECRET = "sk_test_unit_secret";
const sign = (body: string, secret = SECRET) => createHmac("sha512", secret).update(body).digest("hex");

describe("verifySignature", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "AD-1", amount: 5000 } });

  it("accepts the exact body signed with the secret key", () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
    expect(verifySignature(body, sign(body).toUpperCase(), SECRET)).toBe(true); // hex case does not matter
  });
  it("rejects a missing, wrong, truncated or other-key signature", () => {
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, "", SECRET)).toBe(false);
    expect(verifySignature(body, "abc", SECRET)).toBe(false);
    expect(verifySignature(body, sign(body).slice(0, -2), SECRET)).toBe(false);
    expect(verifySignature(body, sign(body, "other"), SECRET)).toBe(false);
  });
  it("rejects a body that was changed after signing, even by one character or a space", () => {
    const signature = sign(body);
    expect(verifySignature(body.replace("5000", "5001"), signature, SECRET)).toBe(false);
    expect(verifySignature(`${body} `, signature, SECRET)).toBe(false);
  });
  it("rejects everything when no secret key is configured", () => {
    expect(verifySignature(body, sign(body, ""), "")).toBe(false);
  });
});

describe("paystackMode", () => {
  it("tells a test key from a live key, and anything else from both", () => {
    expect(paystackMode("sk_test_abc")).toBe("test");
    expect(paystackMode("sk_live_abc")).toBe("live");
    expect(paystackMode("pk_test_abc")).toBeNull();
    expect(paystackMode("")).toBeNull();
  });
});

describe("livePaymentsAllowed", () => {
  it("lets Vercel production use a live key, and keeps live keys off everywhere else", () => {
    expect(livePaymentsAllowed({ secret: "sk_live_abc", allowLive: false, vercelEnv: "production" })).toBe(true);
    expect(livePaymentsAllowed({ secret: "sk_live_abc", allowLive: true, vercelEnv: "preview" })).toBe(true);
    expect(livePaymentsAllowed({ secret: "sk_live_abc", allowLive: false, vercelEnv: "preview" })).toBe(false);
    expect(livePaymentsAllowed({ secret: "sk_live_abc", allowLive: false, vercelEnv: undefined })).toBe(false);
    expect(livePaymentsAllowed({ secret: "sk_test_abc", allowLive: false, vercelEnv: "preview" })).toBe(true);
  });
});

describe("money", () => {
  it("formats pesewas as cedis", () => {
    expect(formatGhs(1000)).toBe("GHS 10.00");
    expect(formatGhs(5)).toBe("GHS 0.05");
    expect(formatGhs(123456)).toBe("GHS 1,234.56");
  });
  it("estimates Paystack's 1.95% fee, never above the amount", () => {
    expect(estimateFee(1000)).toBe(20);
    expect(estimateFee(10)).toBeLessThanOrEqual(10);
  });
});
