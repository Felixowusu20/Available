import { expect, test } from "@playwright/test";
import { createUser, logIn } from "./support";

// The shared database connection in ./support is used by every spec file in this worker, so it is not
// closed here; it goes away when the worker exits.

test.describe("high-priority questions (admin)", () => {
  test("mark one question from its edit page, find it with the filter, then clear it in bulk", async ({ page }) => {
    await logIn(page, await createUser("ADMIN"));

    // Nothing is high priority to begin with.
    await page.goto("/admin/questions?priority=1");
    await expect(page.getByText("No questions match.")).toBeVisible();

    // Open the first published question and tick the box.
    await page.goto("/admin/questions?status=PUBLISHED");
    await page.locator('ul a[href^="/admin/questions/"]').first().click();
    await expect(page.getByRole("heading", { name: "Edit question" })).toBeVisible();
    const box = page.getByRole("checkbox", { name: /High priority/ });
    await expect(box).not.toBeChecked();
    await box.check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    // It shows up in the filtered list with a badge, and on the dashboard tile.
    await page.goto("/admin/questions?priority=1");
    await expect(page.getByText("1 question", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("high priority", { exact: true })).toHaveCount(1);
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: /High priority \(published\)/ })).toContainText("1");

    // Bulk-mark another page of questions, then clear everything again.
    await page.goto("/admin/questions?status=PUBLISHED");
    await page.getByLabel("Select all on this page").check();
    await page.getByRole("button", { name: "Mark high priority" }).click();
    await expect(page.getByRole("status").filter({ hasText: "updated" })).toBeVisible();
    await page.goto("/admin/questions?priority=1");
    await page.getByLabel("Select all on this page").check();
    await page.getByRole("button", { name: "Remove priority" }).click();
    await expect(page.getByRole("status").filter({ hasText: "updated" })).toBeVisible();
    await page.goto("/admin/questions?priority=1");
    await expect(page.getByText("No questions match.")).toBeVisible();
  });

  test("students never see the flag, and cannot set it", async ({ page }) => {
    await logIn(page, await createUser("STUDENT"));
    const res = await page.request.post("/api/admin/questions/bulk", { data: { ids: ["x"], highPriority: true } });
    expect(res.status()).toBe(403);
  });
});
