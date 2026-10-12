import { expect, test } from "@playwright/test";
import { appAlert, createUser, finishFromRunner, logIn, PASSWORD, runnerReady, verificationTokenFor } from "./support";

test.describe("accounts", () => {
  test("sign up, verify the email, then sign in; unverified accounts are told to verify first", async ({ page }) => {
    const email = `e2e-signup-${Date.now()}@test.local`;
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("New Student");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/Check your email for a verification link/)).toBeVisible();

    // Not verified yet: sign-in is refused with an actionable message.
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(appAlert(page)).toContainText("verify your email");
    await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();

    // The emailed link (the real token is only in the email; here we mint an equivalent one).
    const token = await verificationTokenFor(email);
    await page.goto(`/verify-email?token=${token}`);
    await page.getByRole("button", { name: "Verify my email" }).click();
    await expect(page.getByText("Email verified.")).toBeVisible();

    await logIn(page, { email, password: PASSWORD });
    await expect(page.getByRole("heading", { name: /Hello, New/ })).toBeVisible();
  });

  test("a wrong password is rejected, the right one works, and signing out ends the session", async ({ page }) => {
    const u = await createUser();
    await page.goto("/login");
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(appAlert(page)).toContainText("Incorrect email or password");

    await logIn(page, u);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/localhost:3100\/$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/); // signed-out users are sent to sign in
  });

  test("a verification link can only be used once", async ({ page }) => {
    const u = await createUser();
    const token = await verificationTokenFor(u.email);
    await page.goto(`/verify-email?token=${token}`);
    await page.getByRole("button", { name: "Verify my email" }).click();
    await expect(page.getByText("Email verified.")).toBeVisible();
    await page.goto(`/verify-email?token=${token}`);
    await page.getByRole("button", { name: "Verify my email" }).click();
    await expect(appAlert(page)).toContainText("invalid or has expired");
  });
});

test.describe("practice", () => {
  test("learn mode: answer with the keyboard, see the explanation, finish and read the results", async ({ page }) => {
    await logIn(page, await createUser());
    await page.goto("/practice");
    await page.getByText("Preclinical", { exact: true }).click(); // open the section
    await page.getByLabel("All of Anatomy").check();
    await page.getByLabel("Questions", { exact: true }).fill("5");
    await page.getByRole("button", { name: /Start 5 questions/ }).click();
    await expect(page).toHaveURL(/\/practice\/[a-z0-9]+$/);
    await runnerReady(page);

    for (let i = 0; i < 5; i++) {
      await expect(page.getByText(`Q ${i + 1}/5`)).toBeVisible();
      await page.keyboard.press("a");
      await expect(page.getByText(/^(Correct|Incorrect)/)).toBeVisible(); // feedback appears at once
      await expect(page.getByText(/^Explanation \d+$/)).toBeVisible();
      if (i < 4) await page.keyboard.press("Enter"); // Enter goes to the next question
    }
    await finishFromRunner(page);

    await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
    await expect(page.getByText(/\/ 5/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Preclinical vs clinical" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Guesses" })).toBeVisible();
    await expect(page.getByText("Topics, weakest first")).toBeVisible();
  });

  test("a student reports a question, an admin reads it and closes it", async ({ page, browser }) => {
    const student = await createUser();
    await logIn(page, student);
    await page.goto("/practice");
    await page.getByText("Preclinical", { exact: true }).click();
    await page.getByLabel("All of Anatomy").check();
    await page.getByLabel("Questions", { exact: true }).fill("5");
    await page.getByRole("button", { name: /Start 5 questions/ }).click();
    await runnerReady(page);

    // Before the answer is shown, the student cannot judge the answer key, so that reason is not offered.
    await page.getByRole("button", { name: "Report a problem" }).click();
    const dialog = page.getByRole("dialog"); // its name changes to "Thank you" once the report is sent
    await expect(dialog.getByRole("heading", { name: "Report a problem with this question" })).toBeVisible();
    await expect(dialog.getByLabel("The correct answer looks wrong")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(appAlert(page)).toContainText("Choose what is wrong");
    await dialog.getByLabel("Typo or wording error").check();
    await dialog.getByRole("textbox", { name: /Details/ }).fill("e2e: a word is misspelled");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByText("Your report was sent.")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("button", { name: "Reported", exact: true })).toBeVisible();

    // After answering, the key and explanation are shown, so "the answer looks wrong" is offered, and a second report replaces the first.
    await page.keyboard.press("a");
    await expect(page.getByText(/^(Correct|Incorrect)/)).toBeVisible();
    await page.getByRole("button", { name: "Reported", exact: true }).click();
    await expect(dialog.getByText(/already reported this question/)).toBeVisible();
    await dialog.getByLabel("The correct answer looks wrong").check();
    await dialog.getByRole("textbox", { name: /Details/ }).fill("e2e: the key should be C");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await dialog.getByRole("button", { name: "Close" }).click();

    // The admin sees one question with one (replaced) report from this student.
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await logIn(admin, await createUser("ADMIN"));
    await admin.goto("/admin/reports");
    await expect(admin.getByRole("link", { name: "Reports (1)" })).toBeVisible();
    const card = admin.getByRole("article", { name: "Reported question" });
    await expect(card).toHaveCount(1);
    await expect(card.getByText("e2e: the key should be C")).toBeVisible();
    await expect(card.getByText("e2e: a word is misspelled")).toHaveCount(0);
    await expect(card.getByText(student.email)).toBeVisible();

    await card.getByPlaceholder(/What you changed/).fill("Corrected the key");
    await card.getByRole("button", { name: "Mark fixed" }).click();
    await expect(admin.getByText("Nothing is waiting. No open reports.")).toBeVisible();
    await admin.getByRole("link", { name: "Closed" }).click();
    await expect(admin.getByText("Admin note: Corrected the key")).toBeVisible();
    await ctx.close();
  });

  test("the practice screen shows how many questions are left in each topic and the number drops as you answer", async ({ page }) => {
    await logIn(page, await createUser());
    await page.goto("/practice");
    await page.getByText("Preclinical", { exact: true }).click();
    const anatomy = page.locator("summary").filter({ hasText: "Anatomy" });
    const physiology = page.locator("summary").filter({ hasText: "Physiology" });
    await expect(anatomy).toContainText("30 left");
    await expect(physiology).toContainText("30 left");
    await expect(page.locator("summary").filter({ hasText: "Preclinical" })).toContainText("60 left");

    await page.getByLabel("All of Anatomy").check();
    await page.getByLabel("Questions", { exact: true }).fill("5");
    await expect(page.getByText(/30 questions you have not answered yet in your selection/)).toBeVisible();
    await page.getByRole("button", { name: /Start 5 questions/ }).click();
    await runnerReady(page);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("a");
      await expect(page.getByText(/^(Correct|Incorrect)/)).toBeVisible();
      if (i < 4) await page.keyboard.press("Enter");
    }
    await finishFromRunner(page);

    await page.goto("/practice");
    await page.getByText("Preclinical", { exact: true }).click();
    await expect(anatomy).toContainText("25 left"); // 5 answered
    await expect(physiology).toContainText("30 left"); // untouched
    await expect(page.locator("summary").filter({ hasText: "Preclinical" })).toContainText("55 left");
  });

  test("a learn-mode answer cannot be changed once given", async ({ page }) => {
    await logIn(page, await createUser());
    await page.goto("/practice");
    await page.getByText("Preclinical", { exact: true }).click();
    await page.getByLabel("All of Physiology").check();
    await page.getByRole("button", { name: /Start 20 questions/ }).click();
    await runnerReady(page);
    await page.keyboard.press("a");
    await expect(page.getByText(/^(Correct|Incorrect)/)).toBeVisible();
    const verdict = await page.getByText(/^(Correct|Incorrect)/).first().innerText();
    await page.keyboard.press("b"); // try to change it
    await expect(page.getByText(/^(Correct|Incorrect)/).first()).toHaveText(verdict);
    await expect(page.getByRole("button", { name: /^A / })).toHaveAttribute("aria-pressed", "true");
  });

  test("exam mock: timer, flag, question map, switch to learn mode keeps answers, results split 25/25", async ({ page }) => {
    await logIn(page, await createUser());
    await page.goto("/practice");
    await page.getByRole("button", { name: /^50 questions/ }).click();
    await expect(page).toHaveURL(/\/practice\/[a-z0-9]+$/);
    await runnerReady(page);

    await expect(page.getByRole("timer")).toBeVisible();
    await expect(page.getByText("Exam", { exact: true })).toBeVisible();
    await page.keyboard.press("b"); // answer B on Q1
    await expect(page.getByText(/^(Correct|Incorrect)/)).toHaveCount(0); // exam mode shows no feedback
    await page.keyboard.press("Enter");
    await expect(page.getByText("Q 2/50")).toBeVisible();
    await page.keyboard.press("f"); // flag Q2
    await page.keyboard.press("3"); // answer C on Q2 (number keys work too)

    await page.getByRole("button", { name: "Map" }).click();
    const map = page.getByRole("region", { name: "Question map" });
    await expect(map).toContainText("Answered 2");
    await expect(map).toContainText("Flagged 1");
    await expect(map).toContainText("Unanswered 48");
    await page.getByRole("button", { name: "Map" }).click();

    // Switch to learn mode without losing answers.
    await page.getByRole("button", { name: /Switch to learn mode/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Switch" }).click();
    await expect(page.getByText("Learn", { exact: true })).toBeVisible();
    await expect(page.getByRole("timer")).toHaveCount(0);
    await expect(page.getByText(/^(Correct|Incorrect)/)).toBeVisible(); // Q2 was already answered, so it is now explained
    await page.getByRole("button", { name: "Map" }).click();
    await expect(page.getByRole("region", { name: "Question map" })).toContainText("Answered 2");
    await page.getByRole("button", { name: "Map" }).click();

    await finishFromRunner(page);
    await expect(page.getByText(/switched from exam/)).toBeVisible();
    await expect(page.getByText("2 answered, 48 unanswered")).toBeVisible();
    const split = page.getByRole("region", { name: "Preclinical and clinical" });
    await expect(split).toContainText("/25");
    await expect(split.getByText(/\/25/)).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Missed questions" })).toContainText(/Missed questions \(\d+\)/);
  });

  test("the dashboard shows finished sessions and what is left to see", async ({ page }) => {
    await logIn(page, await createUser());
    await page.goto("/practice");
    await page.getByText("Clinical", { exact: true }).click();
    await page.getByLabel("All of Surgery").check();
    await page.getByRole("button", { name: /Start 20 questions/ }).click();
    await runnerReady(page);
    await page.keyboard.press("a");
    await expect(page.getByText(/^(Correct|Incorrect)/)).toBeVisible();
    await finishFromRunner(page);

    await page.goto("/dashboard");
    await expect(page.getByText("Sessions finished").locator("..")).toContainText("1");
    await expect(page.getByText("Questions seen").locator("..")).toContainText("1");
    await expect(page.getByRole("region", { name: "Seen and remaining" })).toContainText("1/60 seen"); // the one clinical question answered
    await expect(page.getByRole("region", { name: "History" })).toContainText("Topic");
  });

  test("progress is saved on the server: resume the same session from a different device", async ({ page, browser }) => {
    const u = await createUser();
    await logIn(page, u);
    await page.goto("/practice");
    await page.getByRole("button", { name: /^50 questions/ }).click();
    await runnerReady(page);
    await page.keyboard.press("c");
    await expect(page.getByRole("button", { name: /^C / })).toHaveAttribute("aria-pressed", "true");
    await page.waitForResponse((r) => r.url().includes("/answer") && r.request().method() === "PUT");

    // A brand-new browser context shares no cookies or storage with the first one.
    const other = await browser.newContext();
    const phone = await other.newPage();
    await logIn(phone, u);
    await expect(phone.getByRole("region", { name: "Sessions in progress" })).toBeVisible();
    await phone.getByRole("link", { name: "Resume" }).first().click();
    await runnerReady(phone);
    await expect(phone.getByText("Q 2/50")).toBeVisible(); // resumes at the first unanswered question
    await phone.keyboard.press("ArrowLeft");
    await expect(phone.getByText("Q 1/50")).toBeVisible();
    await expect(phone.getByRole("button", { name: /^C / })).toHaveAttribute("aria-pressed", "true");
    await other.close();
  });
});

test.describe("access control and presentation", () => {
  test("students cannot open the admin area; admins can", async ({ page, browser }) => {
    await logIn(page, await createUser("STUDENT"));
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/);
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
    const res = await page.request.post("/api/admin/questions", { data: {} });
    expect(res.status()).toBe(403);

    const ctx = await browser.newContext();
    const adminPage = await ctx.newPage();
    await logIn(adminPage, await createUser("ADMIN"));
    await adminPage.goto("/admin");
    await expect(adminPage.getByRole("heading", { name: "Admin" })).toBeVisible();
    await adminPage.goto("/admin/questions");
    await expect(adminPage.getByRole("heading", { name: "Questions" })).toBeVisible();
    await ctx.close();
  });

  test("the theme choice sticks after a reload", async ({ page }) => {
    await logIn(page, await createUser());
    const html = page.locator("html");
    await page.getByRole("button", { name: /Switch between light and dark/ }).click();
    const chosen = await html.getAttribute("data-theme");
    expect(["light", "dark"]).toContain(chosen);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", chosen!);
    await page.getByRole("button", { name: /Switch between light and dark/ }).click();
    expect(await html.getAttribute("data-theme")).not.toBe(chosen);
  });

  test("pages fit a 375px phone screen with no sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await logIn(page, await createUser());
    for (const path of ["/dashboard", "/practice"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    }
    await page.goto("/practice");
    await page.getByRole("button", { name: /^50 questions/ }).click();
    await runnerReady(page);
    await page.getByRole("button", { name: "Map" }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "runner scrolls sideways").toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: "Map" }).click(); // close the map
    await page.getByRole("button", { name: "Report a problem" }).click();
    await expect(page.getByRole("button", { name: "Send report" })).toBeInViewport();
    const dialogOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(dialogOverflow, "report dialog scrolls sideways").toBeLessThanOrEqual(0);
  });
});
