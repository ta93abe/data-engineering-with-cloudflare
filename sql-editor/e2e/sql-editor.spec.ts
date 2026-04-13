import { expect, test } from "@playwright/test";

test.describe("SQL Editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // CodeMirror がマウントされるのを待つ
    await page.waitForSelector(".cm-editor");
  });

  test("エディターが表示され SQL を入力できる", async ({ page }) => {
    const editor = page.locator(".cm-editor");
    await expect(editor).toBeVisible();
    // CodeMirror のコンテンツ領域にテキストが存在する
    const content = page.locator(".cm-content");
    await expect(content).toContainText("R2 Data Catalog");
  });

  test("Run ボタンクリックでクエリが実行される", async ({ page }) => {
    // デフォルトのプレースホルダーを消して SQL を入力
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("SELECT action, type FROM streaming.linear_events LIMIT 2");

    // Run ボタンをクリック
    await page.click("button:has-text('Run')");

    // 結果が表示されるのを待つ
    await expect(page.locator("table")).toBeVisible({ timeout: 15000 });
    // 行数表示を確認
    await expect(page.locator("text=2 rows")).toBeVisible();
  });

  test("Cmd+Enter でクエリが実行される", async ({ page }) => {
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("SELECT action FROM streaming.linear_events LIMIT 1");

    // Dispatch a synthetic Cmd+Enter KeyboardEvent directly to the CodeMirror content.
    // Playwright's keyboard API doesn't reliably trigger CodeMirror's Mod-Enter binding
    // in headless chromium, so we dispatch the event manually.
    // Note: navigator.platform is "MacIntel" in headless Chromium on macOS, so
    // CodeMirror's browser.mac=true and Mod-Enter maps to metaKey (not ctrlKey).
    // We also use Prec.highest on the keymap in Editor.tsx to ensure our handler
    // takes priority over basicSetup's defaultKeymap (which also binds Mod-Enter).
    await content.evaluate((el) => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });

    await expect(page.locator("table")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=1 rows")).toBeVisible();
  });

  test("サイドバーにテーブル一覧が表示される", async ({ page }) => {
    // namespace ヘッダー
    await expect(page.locator("text=STREAMING").first()).toBeVisible({ timeout: 10000 });
    // テーブル名
    await expect(page.locator("button:has-text('linear_events')")).toBeVisible();
  });

  test("クエリ結果表示後もサイドバーが消えない", async ({ page }) => {
    const sidebar = page.locator("text=Tables").first();
    await expect(sidebar).toBeVisible();

    // クエリ実行
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("SELECT action FROM streaming.linear_events LIMIT 1");
    await page.click("button:has-text('Run')");

    // 結果が表示されるのを待つ
    await expect(page.locator("table")).toBeVisible({ timeout: 15000 });

    // サイドバーがまだ表示されている
    await expect(sidebar).toBeVisible();
    await expect(page.locator("button:has-text('linear_events')")).toBeVisible();
  });

  test("エラー時にエラーパネルが表示される", async ({ page }) => {
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("INVALID SQL QUERY");
    await page.click("button:has-text('Run')");

    // エラー表示を待つ
    await expect(page.locator("text=Query Error")).toBeVisible({ timeout: 15000 });
    // サイドバーはそのまま
    await expect(page.locator("text=Tables").first()).toBeVisible();
  });

  test("テーブル名クリックでエディターに挿入される", async ({ page }) => {
    // テーブルボタンが表示されるのを待つ
    const tableButton = page.locator("button:has-text('linear_events')");
    await expect(tableButton).toBeVisible({ timeout: 10000 });

    // クリック
    await tableButton.click();

    // エディターに挿入されたことを確認
    const content = page.locator(".cm-content");
    await expect(content).toContainText("streaming.linear_events");
  });

  test("空結果時に適切なメッセージが表示される", async ({ page }) => {
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type(
      "SELECT action FROM streaming.linear_events WHERE action = 'nonexistent_action_xyz' LIMIT 1"
    );
    await page.click("button:has-text('Run')");

    await expect(page.locator("text=0 rows")).toBeVisible({ timeout: 15000 });
  });
});
