"use strict";

// Renderers pass an identifier, never an arbitrary URL or OS command.
const HELP_URLS = Object.freeze({
  "moj-file-certificate": "https://www.moj.go.jp/MINJI/minji06_00256.html",
  "moj-certificate-process": "https://www.moj.go.jp/MINJI/minji06_00086",
  "secom-gid": "https://www.secomtrust.net/service/ninsyo/forgid.html",
  "adobe-validate":
    "https://helpx.adobe.com/acrobat/desktop/e-sign-documents/manage-digital-signatures/validate-digital-sign.html",
});

function getHelpUrl(id) {
  return typeof id === "string" && Object.hasOwn(HELP_URLS, id)
    ? HELP_URLS[id]
    : null;
}

module.exports = { getHelpUrl };
