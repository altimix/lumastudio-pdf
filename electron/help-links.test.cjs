"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getHelpUrl } = require("./help-links.cjs");

test("certificate help links resolve only fixed official identifiers", () => {
  assert.equal(
    getHelpUrl("secom-gid"),
    "https://www.secomtrust.net/service/ninsyo/forgid.html",
  );
  assert.equal(
    getHelpUrl("moj-file-certificate"),
    "https://www.moj.go.jp/MINJI/minji06_00256.html",
  );
  assert.equal(
    getHelpUrl("moj-certificate-process"),
    "https://www.moj.go.jp/MINJI/minji06_00086",
  );
  assert.equal(
    getHelpUrl("adobe-validate"),
    "https://helpx.adobe.com/acrobat/desktop/e-sign-documents/manage-digital-signatures/validate-digital-sign.html",
  );
});

test("renderer input cannot select arbitrary URLs, schemes, or prototype properties", () => {
  for (const input of [
    "https://example.com",
    "javascript:alert(1)",
    "file:///C:/Windows",
    "secom-gid?redirect=evil",
    "constructor",
    "__proto__",
    "toString",
    "",
    null,
    undefined,
    {},
    ["secom-gid"],
    1,
  ]) {
    assert.equal(getHelpUrl(input), null);
  }
});
