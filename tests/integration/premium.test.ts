import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createSession } from "@/lib/practice/service";
import { grantPremium, markProblemHandled, recheckPayment, revokePremium } from "@/lib/premium/admin";
import { startPremiumCheckout } from "@/lib/premium/checkout";
import { applyCharge, handleWebhook } from "@/lib/premium/confirm";
import { settleOwnPayment, settleRecentPayment } from "@/lib/premium/settle";
import { hasPremium, withPriorityFor } from "@/lib/premium/access";
import { makeAdmin, makeStudent, resetDb, seedBank } from "./helpers";

beforeEach(resetDb);

const SECRET = "sk_test_integration_secret_0123456789";
const sign = (body: string) => createHmac("sha512", SECRET).update(body).digest("hex");
const event = (data: Record<string, unknown>, name = "charge.success") => JSON.stringify({ event: name, data });
const charge = (reference: string, over: Record<string, unknown> = {}) => ({ id: 111, reference, status: "success", amount: 1000, currency: "GHS", channel: "mobile_money", fees: 20, paid_at: "2026-11-01T10:00:00.000Z", ...over });

/** A fake Paystack: records what was sent and answers like the real API. */
function fakePaystack(over: { ok?: boolean; verify?: Record<string, unknown> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/transaction/initialize")) {
      const sent = JSON.parse(String(init.body));
      return Response.json(over.ok === false ? { status: false } : { status: true, data: { authorization_url: "https://checkout.paystack.com/abc", reference: sent.reference } }, { status: over.ok === false ? 400 : 200 });
    }
    return Response.json({ status: true, data: over.verify });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function pendingPayment(email = "buyer@test.local") {
  const student = await makeStudent(email, { premium: false });
  const { reference } = await startPremiumCheckout(student, { fetchImpl: fakePaystack().fetchImpl });
  return { student, reference };
}

describe("starting a payment", () => {
  it("records a pending payment at the server's price and sends Paystack the right request", async () => {
    const student = await makeStudent("buyer@test.local", { premium: false });
    const ps = fakePaystack();
    const res = await startPremiumCheckout(student, { fetchImpl: ps.fetchImpl });
    expect(res.url).toBe("https://checkout.paystack.com/abc");
    expect(await db.payment.findUniqueOrThrow({ where: { reference: res.reference } })).toMatchObject({ userId: student.id, amountPesewas: 1000, currency: "GHS", status: "PENDING" });
    expect(await hasPremium(student.id)).toBe(false); // starting a payment unlocks nothing
    const body = JSON.parse(String(ps.calls[0].init.body));
    expect(body).toMatchObject({ email: "buyer@test.local", amount: 1000, currency: "GHS", reference: res.reference, channels: ["mobile_money", "card"] });
    expect(body.callback_url).toContain("/unlock/callback?reference=");
    expect((ps.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("refuses someone who already has premium, and marks the payment failed when Paystack cannot start it", async () => {
    const student = await makeStudent("buyer@test.local", { premium: false });
    await expect(startPremiumCheckout(student, { fetchImpl: fakePaystack({ ok: false }).fetchImpl })).rejects.toMatchObject({ status: 502 });
    expect(await db.payment.findFirstOrThrow()).toMatchObject({ status: "FAILED" });
    await db.user.update({ where: { id: student.id }, data: { premiumAt: new Date(), premiumSource: "ADMIN" } });
    await expect(startPremiumCheckout(student, { fetchImpl: fakePaystack().fetchImpl })).rejects.toMatchObject({ status: 409 });
  });
});

describe("the webhook", () => {
  it("rejects a bad or missing signature and changes nothing", async () => {
    const { reference, student } = await pendingPayment();
    const body = event(charge(reference));
    for (const sig of [null, "deadbeef", createHmac("sha512", "another-key").update(body).digest("hex")]) expect((await handleWebhook(body, sig)).status).toBe(401);
    expect((await handleWebhook(body + " ", sign(body))).status).toBe(401); // changed after signing
    expect(await hasPremium(student.id)).toBe(false);
    expect((await db.payment.findUniqueOrThrow({ where: { reference } })).status).toBe("PENDING");
  });

  it("a correctly signed charge.success unlocks premium and records Paystack's fee", async () => {
    const { reference, student } = await pendingPayment();
    const body = event(charge(reference));
    expect(await handleWebhook(body, sign(body))).toMatchObject({ status: 200, body: { ok: true, outcome: "granted" } });
    expect(await hasPremium(student.id)).toBe(true);
    expect(await db.user.findUniqueOrThrow({ where: { id: student.id } })).toMatchObject({ premiumSource: "PAYMENT" });
    expect(await db.payment.findUniqueOrThrow({ where: { reference } })).toMatchObject({ status: "SUCCESS", feePesewas: 20, channel: "mobile_money", paystackId: "111" });
  });

  it("is idempotent: the same event again, or three at once, unlocks once and keeps the first date", async () => {
    const { reference, student } = await pendingPayment();
    const body = event(charge(reference));
    const results = await Promise.all([handleWebhook(body, sign(body)), handleWebhook(body, sign(body)), handleWebhook(body, sign(body))]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.outcome === "granted")).toHaveLength(1);
    const first = (await db.user.findUniqueOrThrow({ where: { id: student.id } })).premiumAt;
    expect((await handleWebhook(body, sign(body))).body.outcome).toBe("already-processed");
    expect((await db.user.findUniqueOrThrow({ where: { id: student.id } })).premiumAt).toEqual(first);
  });

  it("unlocks nothing when the amount or currency is not what was asked for", async () => {
    const { reference, student } = await pendingPayment();
    expect(await applyCharge(charge(reference, { amount: 100 }))).toBe("flagged");
    expect(await applyCharge(charge(reference, { currency: "USD" }))).toBe("flagged");
    expect(await hasPremium(student.id)).toBe(false);
    expect((await db.payment.findUniqueOrThrow({ where: { reference } })).problem).toMatch(/expected/);
  });

  it("ignores other events and unknown references without error; a failed charge marks the payment failed", async () => {
    const { reference } = await pendingPayment();
    const other = event(charge(reference), "transfer.success");
    expect((await handleWebhook(other, sign(other))).body).toEqual({ ok: true });
    const unknown = event(charge("someone-elses-reference"));
    expect((await handleWebhook(unknown, sign(unknown))).body).toMatchObject({ outcome: "unknown-reference" });
    const failed = event(charge(reference, { status: "failed" }));
    expect((await handleWebhook(failed, sign(failed))).body.outcome).toBe("not-successful");
    expect((await db.payment.findUniqueOrThrow({ where: { reference } })).status).toBe("FAILED");
  });

  it("a payment that arrives for an account an admin already unlocked is recorded and flagged, and the admin's date stays", async () => {
    const { reference, student } = await pendingPayment();
    const adminDate = new Date("2026-10-01T00:00:00Z");
    await db.user.update({ where: { id: student.id }, data: { premiumAt: adminDate, premiumSource: "ADMIN" } });
    expect(await applyCharge(charge(reference))).toBe("flagged");
    expect(await db.user.findUniqueOrThrow({ where: { id: student.id } })).toMatchObject({ premiumAt: adminDate, premiumSource: "ADMIN" });
    expect(await db.payment.findUniqueOrThrow({ where: { reference } })).toMatchObject({ status: "SUCCESS", problem: expect.stringMatching(/already had premium/) });
  });

  it("the student's own return asks Paystack and opens premium without an admin", async () => {
    const { reference, student } = await pendingPayment();
    const ps = fakePaystack({ verify: charge(reference) });
    expect(await settleOwnPayment(student.id, reference, ps.fetchImpl)).toBe("PAID");
    expect(await hasPremium(student.id)).toBe(true);
    expect(await settleOwnPayment(student.id, reference, ps.fetchImpl)).toBe("PAID"); // asking again changes nothing

    const other = await makeStudent("other@test.local", { premium: false });
    await expect(settleOwnPayment(other.id, reference, ps.fetchImpl)).rejects.toMatchObject({ status: 404 });

    const waiting = await pendingPayment("waiting@test.local");
    const pending = fakePaystack({ verify: charge(waiting.reference, { status: "ongoing" }) });
    expect(await settleOwnPayment(waiting.student.id, waiting.reference, pending.fetchImpl)).toBe("WAITING");
    expect(await hasPremium(waiting.student.id)).toBe(false);

    const down = fakePaystack();
    down.fetchImpl = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const stuck = await pendingPayment("stuck@test.local");
    expect(await settleOwnPayment(stuck.student.id, stuck.reference, down.fetchImpl)).toBe("WAITING");
    expect(await hasPremium(stuck.student.id)).toBe(false);

    await settleRecentPayment(stuck.student.id, fakePaystack({ verify: charge(stuck.reference) }).fetchImpl);
    expect(await hasPremium(stuck.student.id)).toBe(true);
  });

  it("an admin re-check asks Paystack and applies the answer the same way", async () => {
    const { reference, student } = await pendingPayment();
    const ps = fakePaystack({ verify: charge(reference) });
    expect(await recheckPayment(reference, ps.fetchImpl)).toBe("granted");
    expect(ps.calls[0].url).toBe(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`);
    expect(await recheckPayment(reference, ps.fetchImpl)).toBe("already-processed");
    expect(await hasPremium(student.id)).toBe(true);
    await expect(recheckPayment("no-such-reference", ps.fetchImpl)).rejects.toMatchObject({ status: 404 });
  });
});

describe("granting and removing premium", () => {
  it("an admin can grant it once (the date is kept), and remove it again", async () => {
    const admin = await makeAdmin();
    const student = await makeStudent("free@test.local", { premium: false });
    await grantPremium(admin.id, "free@test.local");
    expect(await db.user.findUniqueOrThrow({ where: { id: student.id } })).toMatchObject({ premiumSource: "ADMIN" });
    await expect(grantPremium(admin.id, "free@test.local")).rejects.toMatchObject({ status: 409 });
    await expect(grantPremium(admin.id, "nobody@test.local")).rejects.toMatchObject({ status: 404 });
    await revokePremium(admin.id, student.id);
    expect(await hasPremium(student.id)).toBe(false);
    await expect(revokePremium(admin.id, student.id)).rejects.toMatchObject({ status: 404 });
  });

  it("a flagged payment can be marked as handled", async () => {
    const { reference } = await pendingPayment();
    await applyCharge(charge(reference, { amount: 5 }));
    const p = await db.payment.findUniqueOrThrow({ where: { reference } });
    await markProblemHandled(p.id);
    expect((await db.payment.findUniqueOrThrow({ where: { reference } })).problemHandledAt).not.toBeNull();
  });

  it("the database refuses a half-set premium (a date with no reason, or an unknown reason)", async () => {
    const student = await makeStudent("x@test.local", { premium: false });
    await expect(db.user.update({ where: { id: student.id }, data: { premiumAt: new Date() } })).rejects.toThrow();
    await expect(db.user.update({ where: { id: student.id }, data: { premiumAt: new Date(), premiumSource: "GIFT" } })).rejects.toThrow();
  });

  it("an admin account counts as premium without being unlocked", async () => {
    const admin = await makeAdmin();
    expect(await hasPremium(admin.id)).toBe(true);
  });
});

describe("what premium unlocks", () => {
  const section = (userId: string, extra: Record<string, unknown> = {}) =>
    createSession(userId, { kind: "TOPIC", disciplines: [], subtopics: [], sections: ["PRECLINICAL"], count: 20, mode: "LEARN", ...extra } as never);

  it("section practice is refused for a free account, whatever else is chosen with it, and the server enforces it", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const free = await makeStudent("free@test.local", { premium: false });
    await expect(section(free.id)).rejects.toMatchObject({ status: 402 });
    await expect(section(free.id, { disciplines: ["Anatomy"] })).rejects.toMatchObject({ status: 402 });
    expect(await db.practiceSession.count()).toBe(0);
  });

  it("section practice works once premium is unlocked, by payment or by an admin, and for admins", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const paid = await makeStudent("paid@test.local", { premium: false });
    const { reference } = await startPremiumCheckout(paid, { fetchImpl: fakePaystack().fetchImpl });
    await applyCharge(charge(reference));
    const id = await section(paid.id);
    expect(await db.sessionQuestion.count({ where: { sessionId: id, question: { section: "PRECLINICAL" } } })).toBe(20);

    const given = await makeStudent("given@test.local", { premium: false });
    await grantPremium((await makeAdmin()).id, "given@test.local");
    expect(await section(given.id)).toBeTruthy();
    expect(await section((await makeAdmin("admin2@test.local")).id)).toBeTruthy();
  });

  it("everything that was free stays free: mock exams, topic practice, redo missed, bookmarks and reporting", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const free = await makeStudent("free@test.local", { premium: false });
    expect(await createSession(free.id, { kind: "MOCK", size: 50, mode: "EXAM" })).toBeTruthy();
    expect(await createSession(free.id, { kind: "TOPIC", disciplines: ["Anatomy"], subtopics: [], count: 10, mode: "LEARN" })).toBeTruthy();
  });

  it("high-priority questions are drawn first for premium accounts only", async () => {
    await seedBank({ pre: 120, cli: 20 });
    const rows = await db.question.findMany({ where: { status: "PUBLISHED", discipline: "Anatomy" }, orderBy: { stem: "asc" }, take: 6, select: { id: true } });
    const ids = rows.map((r) => r.id);
    await db.question.updateMany({ where: { id: { in: ids } }, data: { highPriority: true } });
    const picked = async (userId: string) => {
      const sessionId = await createSession(userId, { kind: "TOPIC", disciplines: ["Anatomy"], subtopics: [], count: 10, mode: "LEARN" });
      return new Set((await db.sessionQuestion.findMany({ where: { sessionId } })).map((r) => r.questionId));
    };

    const premium = await makeStudent("premium@test.local"); // premium by default in these tests
    const free = await makeStudent("free@test.local", { premium: false });
    const withFlag = await picked(premium.id);
    expect(ids.every((q) => withFlag.has(q))).toBe(true); // all six priority questions are in the premium student's 10

    // For a free account the flag is ignored, so the draw is random: all six of 60 landing in a random 10 has odds of
    // about 1 in 240,000. Two tries, and at least one must miss some.
    const tries = [await picked(free.id), await picked(free.id)];
    expect(tries.some((set) => !ids.every((q) => set.has(q)))).toBe(true);
  });

  it("withPriorityFor leaves the pool alone for premium and clears the flag for everyone else", () => {
    const pool = [{ id: "a", highPriority: true }, { id: "b", highPriority: false }, { id: "c" }];
    expect(withPriorityFor(pool, true)).toEqual(pool);
    expect(withPriorityFor(pool, false).map((q) => q.highPriority ?? false)).toEqual([false, false, false]);
    expect(pool[0].highPriority).toBe(true); // the original is not changed
  });
});
