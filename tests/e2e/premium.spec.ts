import { expect, test } from "@playwright/test";
import { createUser, isPremium, logIn, paystackWebhook, runnerReady, startPayment } from "./support";

test.describe("premium unlock", () => {
  test("a free student sees the locked features and an invitation, and the server refuses section practice", async ({ page }) => {
    await logIn(page, await createUser("STUDENT", { premium: false }));
    await page.goto("/practice");
    await expect(page.getByLabel("Premium")).toContainText("Unlock premium once for GHS 10");

    // No "questions left" numbers for a free account
    await expect(page.getByText(/\d+ left/)).toHaveCount(0);
    // The section card is there but its button is an invitation
    await expect(page.getByRole("heading", { name: "Practise one section" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Start \d+ preclinical questions/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Premium: unlock for GHS 10" })).toBeVisible();

    // Sending the request by hand does not get round it
    const res = await page.request.post("/api/sessions", { data: { kind: "TOPIC", sections: ["PRECLINICAL"], count: 20, mode: "LEARN" } });
    expect(res.status()).toBe(402);

    // What was free is still free: a mock exam starts
    await page.getByRole("button", { name: "50 questions" }).click();
    await expect(page).toHaveURL(/\/practice\//);
  });

  test("premium is unlocked only by the signed webhook, never by visiting a page", async ({ page, request }) => {
    const u = await createUser("STUDENT", { premium: false });
    await logIn(page, u);
    await page.goto("/unlock");
    await expect(page.getByRole("heading", { name: "Premium" })).toBeVisible();
    await expect(page.getByText("One payment of GHS 10.00, for life.")).toBeVisible();
    await expect(page.getByText("Test mode:")).toBeVisible();
    await expect(page.getByRole("button", { name: "Unlock premium for GHS 10.00" })).toBeVisible();

    const reference = await startPayment(u.id);
    await page.goto(`/unlock/callback?reference=${reference}`);
    await expect(page.getByText("Waiting for Paystack to confirm your payment")).toBeVisible();
    expect(await isPremium(u.id)).toBe(false); // visiting the page unlocked nothing

    const hook = paystackWebhook(reference);
    expect((await request.post("/api/paystack/webhook", { data: hook.body, headers: { "x-paystack-signature": "0".repeat(128) } })).status()).toBe(401);
    expect((await request.post("/api/paystack/webhook", { data: hook.body })).status()).toBe(401);
    const cheap = paystackWebhook(reference, { amount: 100 }); // correctly signed, wrong amount
    expect(((await (await request.post("/api/paystack/webhook", { data: cheap.body, headers: { "x-paystack-signature": cheap.signature } })).json()) as { outcome: string }).outcome).toBe("flagged");
    expect(await isPremium(u.id)).toBe(false);

    // A genuine confirmation arrives while the student looks at the waiting page.
    const fresh = await startPayment(u.id);
    await page.goto(`/unlock/callback?reference=${fresh}`);
    const ok = paystackWebhook(fresh);
    const res = await request.post("/api/paystack/webhook", { data: ok.body, headers: { "x-paystack-signature": ok.signature } });
    expect(((await res.json()) as { outcome: string }).outcome).toBe("granted");
    await expect(page.getByText("Premium is unlocked")).toBeVisible({ timeout: 15_000 });
    const again = await request.post("/api/paystack/webhook", { data: ok.body, headers: { "x-paystack-signature": ok.signature } });
    expect(((await again.json()) as { outcome: string }).outcome).toBe("already-processed");

    // Now the practice screen shows the counters and the section button works
    await page.goto("/practice");
    await expect(page.getByLabel("Premium")).toHaveCount(0);
    await expect(page.getByText(/\d+ left/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Premium", exact: true })).toHaveCount(0); // the nav invitation is gone
  });

  test("a premium student practises one section, either one, with the number of questions they choose", async ({ page }) => {
    await logIn(page, await createUser("STUDENT"));
    await page.goto("/practice");
    await expect(page.getByRole("button", { name: "Start 50 preclinical questions" })).toBeVisible();
    await page.getByRole("radio", { name: /^Clinical/ }).check();
    await page.getByRole("button", { name: "20", exact: true }).click();
    await page.getByRole("button", { name: "Start 20 clinical questions" }).click();
    await expect(page).toHaveURL(/\/practice\//);
    await runnerReady(page);
    await expect(page.getByText(/Q 1\/20/)).toBeVisible();
  });

  test("an admin gives premium for free, and takes it away again", async ({ page, browser }) => {
    const student = await createUser("STUDENT", { premium: false });
    await logIn(page, await createUser("ADMIN"));
    await page.goto("/admin/premium");
    await expect(page.getByRole("heading", { name: "Premium", level: 1 })).toBeVisible();
    await page.getByLabel("Their account email").fill(student.email);
    await page.getByRole("button", { name: "Grant premium" }).click();
    await expect(page.getByText("Premium granted.")).toBeVisible();
    expect(await isPremium(student.id)).toBe(true);
    await expect(page.locator("li", { hasText: student.email })).toContainText("given by an admin");

    // The student's next page already shows the unlocked screen
    const context = await browser.newContext();
    const studentPage = await context.newPage();
    await logIn(studentPage, student);
    await studentPage.goto("/practice");
    await expect(studentPage.getByLabel("Premium")).toHaveCount(0);
    await context.close();

    page.once("dialog", (d) => void d.accept());
    await page.locator("li", { hasText: student.email }).getByRole("button", { name: "Remove premium" }).click();
    await expect(page.locator("li", { hasText: student.email })).toHaveCount(0);
    expect(await isPremium(student.id)).toBe(false);
  });

  test("students cannot reach the premium admin screen or its tools", async ({ page }) => {
    await logIn(page, await createUser("STUDENT", { premium: false }));
    await page.goto("/admin/premium");
    await expect(page).not.toHaveURL(/\/admin/);
    expect((await page.request.post("/api/admin/premium/grant", { data: { email: "someone@test.local" } })).status()).toBe(403);
  });
});
