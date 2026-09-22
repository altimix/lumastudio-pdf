import { expect, test } from "@playwright/test";

test("PDFやAI設定がなくても証明書ガイドを開けて、問い合わせ文を取り出せる", async ({
  page,
  context,
}) => {
  const apiPosts: string[] = [];
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/"))
      apiPosts.push(request.url());
  });
  await page.route("**/api/**", (route) => route.abort());
  await context.route("https://**/*", (route) => {
    externalRequests.push(route.request().url());
    return route.fulfill({
      contentType: "text/html",
      body: "<title>Official certificate guide</title><p>Official help link navigation test</p>",
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Clipboard permission denied for test");
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("pdf-surface")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "AI自動記入", exact: true }),
  ).toBeDisabled();
  const entry = page.getByRole("button", { name: "証明書ガイド", exact: true });
  await entry.click();
  const guide = page.getByRole("dialog", {
    name: "はじめての署名用証明書",
    exact: true,
  });
  await expect(guide).toBeVisible();
  await expect(guide.locator(".certificate-guide-steps > li")).toHaveCount(5);
  await expect(
    guide.getByRole("button", { name: "取得済みの証明書を選ぶ", exact: true }),
  ).toHaveCount(0);
  await expect(guide).toContainText(
    "取得後はデスクトップ版の「署名して保存」へ",
  );
  if (!process.env.CI)
    await page.screenshot({ path: "tmp/certificate-guide.png" });
  const official = guide.getByRole("link", {
    name: "セコム：個人向け電子証明書の例",
    exact: true,
  });
  await expect(official).toHaveAttribute("target", "_blank");
  await expect(official).toHaveAttribute("rel", "noopener noreferrer");
  const popupPromise = page.waitForEvent("popup");
  await official.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(
    "https://www.secomtrust.net/service/ninsyo/forgid.html",
  );
  await popup.close();
  await expect(guide).toBeVisible();
  await guide
    .locator("summary", { hasText: "取得先への問い合わせ文を使う" })
    .click();
  await guide
    .getByRole("button", { name: "問い合わせ文をコピー", exact: true })
    .click();
  await expect(guide.getByRole("status")).toContainText("Ctrl+C（Macは⌘C）");
  await expect(guide.getByLabel("コピーして使える問い合わせ文")).toBeFocused();
  await expect(guide.getByLabel("コピーして使える問い合わせ文")).toHaveValue(
    /RSA 2048ビット以上/,
  );
  expect(apiPosts).toEqual([]);
  expect(externalRequests).toEqual([
    "https://www.secomtrust.net/service/ninsyo/forgid.html",
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    guide.getByRole("button", { name: "ガイドを閉じる", exact: true }),
  ).toBeInViewport();
  if (!process.env.CI)
    await page.screenshot({ path: "tmp/certificate-guide-mobile.png" });
  await guide
    .getByRole("button", { name: "ガイドを閉じる", exact: true })
    .click();
  await expect(guide).toHaveCount(0);
  await expect(entry).toBeFocused();
});

test("証明書がなくても取得手順を読み、取得後はファイル選択へ戻れる", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.addInitScript(() => {
    const state = { chosen: 0, links: [] as string[] };
    Object.defineProperty(window, "guideTest", { value: state });
    Object.defineProperty(window, "lumaDesktop", {
      value: {
        onOpenPdf: () => () => {},
        getAiStatus: async () => ({ available: false, model: "test" }),
        chooseCertificate: async () => {
          state.chosen++;
          return { name: "example-signer.p12" };
        },
        inspectCertificate: async () => {
          throw new Error("not needed by guide");
        },
        openHelpLink: async (id: string) => {
          state.links.push(id);
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "サンプルの書類で試す" }).click();
  await page.getByTestId("pdf-surface").waitFor();
  await page.getByRole("button", { name: "署名して保存", exact: true }).click();
  const signature = page.getByRole("dialog", {
    name: "電子署名して保存",
    exact: true,
  });
  await signature
    .getByRole("button", { name: "証明書を持っていない方へ", exact: true })
    .click();
  const guide = page.getByRole("dialog", {
    name: "はじめての署名用証明書",
    exact: true,
  });
  await expect(guide).toBeVisible();
  await expect(signature).toHaveCount(0);
  if (!process.env.CI)
    await page.screenshot({ path: "tmp/certificate-guide-from-signature.png" });
  await expect(
    guide.getByRole("radio", { name: "個人・個人事業主", exact: true }),
  ).toBeChecked();
  await expect(guide).toContainText("秘密鍵を含む .p12 ／ .pfx");
  await expect(guide).toContainText(".cer／.crtだけでは署名できません");
  await expect(guide).toContainText(
    "メールの返送時に添付するのは完成したPDFだけ",
  );
  await expect(guide).toContainText(
    "第三者による本人確認を受けた証明書とは異なります",
  );
  await guide
    .getByRole("link", { name: "セコム：個人向け電子証明書の例", exact: true })
    .click();
  await guide
    .getByRole("radio", { name: "会社・法人の代表者", exact: true })
    .check();
  await guide
    .getByRole("link", {
      name: "法務省：ファイル形式の電子証明書",
      exact: true,
    })
    .click();
  await expect(guide).toContainText("商業登記リモート署名には対応していません");
  await guide
    .locator("summary", { hasText: "取得先への問い合わせ文を使う" })
    .click();
  await expect(guide.getByLabel("コピーして使える問い合わせ文")).toHaveValue(
    /PDF文書への電子署名[\s\S]*RSA 2048ビット以上[\s\S]*秘密鍵を含むP12／PFX/,
  );
  // The guide only sends official identifiers to the desktop bridge.
  expect(
    await page.evaluate(
      () => (window as unknown as { guideTest: unknown }).guideTest,
    ),
  ).toEqual({ chosen: 0, links: ["secom-gid", "moj-file-certificate"] });
  await guide
    .getByRole("button", { name: "取得済みの証明書を選ぶ", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    guide.getByRole("button", { name: "証明書ガイドを閉じる", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(signature).toBeVisible();
  await expect(
    signature.getByRole("button", {
      name: "証明書を持っていない方へ",
      exact: true,
    }),
  ).toBeFocused();
  await signature
    .getByRole("button", { name: "証明書を持っていない方へ", exact: true })
    .click();
  await guide
    .getByRole("button", { name: "取得済みの証明書を選ぶ", exact: true })
    .click();
  await expect(guide).toHaveCount(0);
  await expect(signature).toContainText("example-signer.p12");
  await expect(
    signature.getByLabel("証明書のパスワード", { exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { guideTest: { chosen: number } }).guideTest
          .chosen,
    ),
  ).toBe(1);
});
