import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { _electron } from "playwright";
import { expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Synthetic documents only. Native picker destinations are mocked; filesystem
// reads, multi-file IPC, merge, page deletion, native save, and project save/load
// are real. No production application behavior or unsaved guard is replaced.
const root = process.cwd();
await fs.mkdir("tmp", { recursive: true });
const output = await fs.mkdtemp(path.join(root, "tmp", "merge-desktop-"));
await fs.mkdir(path.join(output, "documents"));
await fs.mkdir(path.join(output, "profile"));
const paths = [];
for (const [name, widths] of [
  ["A.pdf", [400, 410]],
  ["B.pdf", [500, 510]],
]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const width of widths)
    pdf
      .addPage([width, 600])
      .drawText(`${name} / ${width}`, { x: 40, y: 540, size: 20, font });
  const location = path.join(output, name);
  await fs.writeFile(location, await pdf.save());
  paths.push(location);
}
const saved = path.join(output, "merged-deleted.pdf");
const savedProject = path.join(output, "editable-project.lumapdf");
const bootstrap = path.join(output, "bootstrap.cjs");
await fs.writeFile(
  bootstrap,
  `
const {app,dialog}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(output, "profile"))});
app.setPath('documents',${JSON.stringify(path.join(output, "documents"))});
global.__lumaSmokeDialogs=[];
dialog.showOpenDialog=async(_window,options)=>{
  const extensions=options.filters.flatMap(filter=>filter.extensions);
  const project=extensions.includes('lumapdf');
  const multiple=options.properties.includes('multiSelections');
  global.__lumaSmokeDialogs.push({kind:'open',extensions,multiple});
  return {canceled:false,filePaths:project?[${JSON.stringify(savedProject)}]:multiple?${JSON.stringify(paths)}:[${JSON.stringify(paths[0])}]};
};
dialog.showSaveDialog=async(_window,options)=>{
  const extensions=options.filters.flatMap(filter=>filter.extensions);
  global.__lumaSmokeDialogs.push({kind:'save',extensions});
  return {canceled:false,filePath:extensions.includes('lumapdf')?${JSON.stringify(savedProject)}:${JSON.stringify(saved)}};
};
dialog.showMessageBoxSync=()=>1;
require(${JSON.stringify(path.join(root, "electron/main.cjs"))});
`,
);
const env = { ...process.env, LUMA_ENV_PATH: path.join(output, "no-key.env") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
delete env.OPENAI_API_KEY;
let app;
let page;
let stage = "launch";
const errors = [];
try {
  app = await _electron.launch({
    args: [bootstrap],
    cwd: root,
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  stage = "native multi-select";
  await page.getByRole("button", { name: "PDFを結合", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "PDFを結合", exact: true });
  await expect(dialog.getByText("A.pdf", { exact: true })).toBeVisible();
  await expect(dialog.getByText("B.pdf", { exact: true })).toBeVisible();
  stage = "reorder and merge";
  await dialog
    .getByRole("button", { name: "1番目の「A.pdf」を下へ移動", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "この順序で結合", exact: true })
    .click();
  await expect(page.locator(".thumbnail-button")).toHaveCount(4);
  stage = "delete page and preserve focus";
  const thirdPage = page.getByRole("button", { name: "3ページ目", exact: true });
  await thirdPage.scrollIntoViewIfNeeded();
  // Allow the scroll initiated by Playwright to finish before opening a menu
  // that intentionally closes when its surrounding page is scrolled.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await thirdPage.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "このページを削除", exact: true })
    .click();
  await expect(page.locator(".thumbnail-button")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "3ページ目", exact: true }),
  ).toBeFocused();
  stage = "native save";
  await page.getByRole("button", { name: "PDFを保存", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "書き出しました" }),
  ).toBeVisible();
  const pdf = await PDFDocument.load(await fs.readFile(saved));
  stage = "validate saved page order";
  assert.deepEqual(
    pdf.getPages().map((p) => p.getWidth()),
    [500, 510, 410],
  );
  assert.deepEqual(errors, []);
  await page
    .getByRole("button", { name: "2ページ目", exact: true })
    .click({ button: "right" });
  await page.screenshot({
    path: path.join(output, "right-click-delete.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");

  stage = "add editable text before native project save";
  await page.getByRole("button", { name: "1ページ目", exact: true }).click();
  await page.getByRole("button", { name: "文字を記入", exact: true }).click();
  const originalText = "保存してから再編集する文字";
  await page.getByLabel("記入する文字").fill(originalText);
  await page.getByTestId("pdf-surface").click({ position: { x: 85, y: 140 } });
  await expect(page.getByRole("button", { name: `文字: ${originalText}`, exact: true })).toBeVisible();
  const saveProject = async () => {
    await page.getByRole("button", { name: "作業データ", exact: true }).click();
    const projectDialog = page.getByRole("dialog", { name: "編集の続きを保存・再開", exact: true });
    await projectDialog.getByRole("button", { name: "作業データを保存", exact: true }).click();
    await expect(projectDialog).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "編集を再開できる作業データを保存しました" })).toBeVisible();
    return JSON.parse(await fs.readFile(savedProject, "utf8"));
  };
  stage = "native project write and inspect";
  const projectBefore = await saveProject();
  assert.deepEqual(Object.keys(projectBefore).sort(), ["app", "version", "filename", "original", "pages", "annotations"].sort());
  assert.equal(projectBefore.app, "LumaStudio PDF");
  assert.equal(projectBefore.version, 1);
  assert.deepEqual(projectBefore.pages.map((entry) => entry.sourceIndex), [0, 1, 3]);
  assert.equal((await PDFDocument.load(Buffer.from(projectBefore.original, "base64"))).getPageCount(), 4);
  assert.equal(projectBefore.annotations.length, 1);
  assert.equal(projectBefore.annotations[0].type, "text");
  assert.equal(projectBefore.annotations[0].text, originalText);
  const inspectKeys = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!/password|privateKey|apiKey|certificate|credential|profile|stampLibrary/i.test(key), `Unexpected settings/credential key: ${key}`);
      inspectKeys(child);
    }
  };
  inspectKeys(projectBefore);

  stage = "replace document then reopen saved project through native picker";
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await expect(page.locator(".thumbnail-button")).toHaveCount(2);
  await expect(page.locator(".annotation")).toHaveCount(0);
  await page.getByRole("button", { name: "作業データ", exact: true }).click();
  await page.getByRole("dialog", { name: "編集の続きを保存・再開", exact: true })
    .getByRole("button", { name: "保存した作業データを開く", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "作業データを開きました" })).toBeVisible();
  await expect(page.locator(".thumbnail-button")).toHaveCount(3);
  await expect(page.locator(".annotation")).toHaveCount(1);
  await page.getByRole("button", { name: `文字: ${originalText}`, exact: true }).click();
  await expect(page.getByLabel("内容")).toHaveValue(originalText);
  const editedText = "再開後に修正した文字";
  await page.getByLabel("内容").fill(editedText);
  await expect(page.getByRole("button", { name: `文字: ${editedText}`, exact: true })).toBeVisible();
  stage = "save original annotation after editing reopened project";
  const projectAfter = await saveProject();
  assert.equal(projectAfter.annotations.length, 1);
  assert.equal(projectAfter.annotations[0].text, editedText);
  assert.notEqual(projectAfter.annotations[0].id, projectBefore.annotations[0].id);
  assert.equal(projectAfter.annotations[0].x, projectBefore.annotations[0].x);
  assert.equal(projectAfter.annotations[0].y, projectBefore.annotations[0].y);
  assert.deepEqual(projectAfter.pages.map((entry) => entry.sourceIndex), [0, 1, 3]);
  inspectKeys(projectAfter);
  const nativeDialogs = await app.evaluate(() => global.__lumaSmokeDialogs);
  assert.equal(nativeDialogs.filter((entry) => entry.kind === "open" && entry.multiple).length, 1);
  assert.equal(nativeDialogs.filter((entry) => entry.kind === "open" && entry.extensions.includes("lumapdf")).length, 1);
  assert.equal(nativeDialogs.filter((entry) => entry.kind === "save" && entry.extensions.includes("lumapdf")).length, 2);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "reopened-project-edited.png"), fullPage: true });
  const summary = {
    passed: true,
    nativeMultiSelect: true,
    pageWidths: pdf.getPages().map((p) => p.getWidth()),
    keyboardFocusPreserved: true,
    nativeProjectWriteRead: true,
    projectAnnotationEditable: true,
    projectContainsOnlyDocumentData: true,
    projectPageIndexes: projectAfter.pages.map((entry) => entry.sourceIndex),
    nativeDialogs,
    externalApiCalls: 0,
    errors,
    output,
  };
  await fs.writeFile(
    path.join(output, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  const failure = {
    passed: false,
    stage,
    error: error instanceof Error ? error.stack : String(error),
    errors,
    output,
  };
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch((captureError) => { failure.screenshotError = String(captureError); });
    await fs.writeFile(path.join(output, "failure.html"), await page.content())
      .catch(() => undefined);
  }
  await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(failure, null, 2));
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  // End only this disposable test process after evidence has been saved. A normal
  // window close invokes the real unsaved-change guard and can mask a test failure.
  if (app) await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
}
