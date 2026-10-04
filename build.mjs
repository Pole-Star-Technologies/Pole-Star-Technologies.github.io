#!/usr/bin/env node
/**
 * Builds the MeetingAI public site from src/ + site.config.json into dist/.
 *
 * There is no framework here on purpose: the output is three HTML pages, a
 * stylesheet and two marker files, and a policy page that a regulator or a
 * Play reviewer may read should be inspectable in the view-source of one
 * request, not assembled at runtime by a bundler they cannot audit.
 *
 * The build is strict because this site carries legal statements about what the
 * app collects. A page that ships with `{{org.supportEmail}}` in it, or with a
 * `TODO` address, is worse than no page: it reads as a real policy to a
 * reviewer and gets approved. So:
 *
 *   - `site.config.json` must exist and hold no TODO.
 *   - every `{{token}}` must resolve before anything is written.
 *   - every internal link must point at a page that exists in the output.
 *   - the `dist/` tree is written only after all of the above pass.
 *
 * Usage:
 *   node build.mjs           validate and write dist/
 *   node build.mjs --check   validate only (what CI runs before deploying)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "dist");
const CONFIG_PATH = join(ROOT, "site.config.json");

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes("--check");

const errors = [];
const notes = [];

// ---------------------------------------------------------------- config ---
let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
} catch (e) {
  fail(`cannot read site.config.json: ${e.message}\n     Copy site.config.example.json to site.config.json and fill it in.`);
}

// Walk the config and refuse anything that still reads like a hole in a draft.
function findUnfilled(obj, path = "") {
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (k.startsWith("$")) continue;
    if (typeof v === "string") {
      if (!v.trim()) errors.push(`config value ${p} is empty`);
      if (/\bTODO\b|\bFIXME\b/i.test(v)) errors.push(`config value ${p} is still a placeholder: "${v}"`);
    } else if (v && typeof v === "object") {
      findUnfilled(v, p);
    }
  }
}
findUnfilled(config);

const FLAT = new Map();
(function flatten(obj, path = "") {
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("$")) continue;
    const p = path ? `${path}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, p);
    else FLAT.set(p, String(v));
  }
})(config);

// ------------------------------------------------------- the store link ---
// A details?id=… URL for an app that is not published yet resolves to a 404, and
// on the page a Play reviewer is reading that reads as a broken site. So the
// store link is not a config value a page uses directly: it is computed from
// app.playUrl and app.listingLive, and until the listing is live the pages say
// so in words instead of pointing at a page that does not exist.
//
// Publishing the listing is then one config value (`listingLive`: "yes"), and
// every page picks the link up at once.
const LISTING_VALUES = ["yes", "no"];
function storeLinks(app) {
  const live = String(app.listingLive ?? "").trim().toLowerCase();
  if (!LISTING_VALUES.includes(live)) {
    errors.push(`config value app.listingLive must be "yes" or "no", not "${app.listingLive}"`);
  }
  const url = String(app.playUrl || "").trim();
  const name = String(app.name || "the app").trim();
  if (live !== "yes" || !url) {
    return {
      button: `<span class="cta cta--pending" role="note">Not on Google Play yet — ${name} is in Google’s review. The store listing opens with this release.</span>`,
      link: `<span role="note">Google Play (listing not live yet)</span>`,
    };
  }
  return {
    button: `<a class="cta" href="${url}"><strong>${name} on Google Play →</strong></a>`,
    link: `<a href="${url}">Google Play</a>`,
  };
}
const store = storeLinks(config.app);

// Computed tokens, so pages never hardcode a date they forget to bump.
const now = new Date();
FLAT.set("generated.date", now.toISOString().slice(0, 10));
FLAT.set("generated.iso", now.toISOString());
FLAT.set("generated.year", String(now.getUTCFullYear()));
FLAT.set("store.button", store.button);
FLAT.set("store.link", store.link);

// --------------------------------------------------------------- tokens ---
function substitute(html, file) {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key) => {
    if (!FLAT.has(key)) {
      errors.push(`${file}: unresolved token ${whole}`);
      return whole;
    }
    return FLAT.get(key);
  });
}

// -------------------------------------------------------------- outputs ---
const PAGES = ["index.html", "privacy.html", "support.html", "terms.html", "404.html"];
// robots.txt is templated too: it points at the canonical site, and a stale
// host in a robots file is how a policy page stops being findable.
const TEMPLATES = [...PAGES, "robots.txt"];
const rendered = new Map();

for (const page of TEMPLATES) {
  const src = join(SRC, page);
  if (!statSync(src, { throwIfNoEntry: false })) {
    errors.push(`missing src/${page}`);
    continue;
  }
  const html = substitute(readFileSync(src, "utf8"), page);
  rendered.set(page, html);

  if (!page.endsWith(".html")) continue;
  // Each page must state what version of the app it describes: a privacy
  // policy that has drifted from the shipped build is the finding that gets an
  // app pulled, not the one that gets a note.
  if (!/data-app-version=/.test(html)) errors.push(`${page}: no data-app-version marker`);
  if (!/<title>/.test(html)) errors.push(`${page}: no <title>`);
}

// ------------------------------------------------------------ links ---
for (const [page, html] of rendered) {
  for (const m of html.matchAll(/href\s*=\s*"([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|#)/.test(href)) continue;
    const target = href.replace(/^\.\//, "").split("#")[0];
    if (!target) continue;
    const exists =
      rendered.has(target) ||
      statSync(join(SRC, target), { throwIfNoEntry: false }) ||
      statSync(join(SRC, "assets", target.replace(/^assets\//, "")), { throwIfNoEntry: false });
    if (!exists) errors.push(`${page}: link to missing file "${href}"`);
  }
}

// Absolute links back to this site must use the configured base, or the page
// works on localhost and nowhere else.
for (const [page, html] of rendered) {
  const wrongHost = html.match(/https:\/\/(localhost|127\.0\.0\.1)[^"]*/g);
  if (wrongHost) errors.push(`${page}: hardcoded local URL(s): ${wrongHost.join(", ")}`);
}

// The pages that Google is allowed to index must be reachable from the base URL.
for (const page of PAGES.filter((p) => p !== "404.html")) {
  const m = rendered.get(page)?.match(/<link rel="canonical" href="([^"]+)">/);
  if (!m) {
    errors.push(`${page}: no canonical link to this site`);
    continue;
  }
  const want = page === "index.html" ? `${FLAT.get("site.base")}/` : FLAT.get("site.base") + "/" + page;
  if (m[1] !== want) errors.push(`${page}: canonical is "${m[1]}" but site.base says "${want}"`);
}

if (errors.length) {
  console.error("BUILD REFUSED\n");
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`\n${errors.length} problem(s). Nothing was written to dist/.`);
  process.exit(1);
}

if (CHECK_ONLY) {
  console.log(`OK  ${PAGES.length} pages validated, ${FLAT.size} config values, no unresolved tokens.`);
  process.exit(0);
}

// ------------------------------------------------------------------ write ---
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "assets"), { recursive: true });

for (const [page, html] of rendered) {
  writeFileSync(join(OUT, page), html);
  notes.push(`${page} (${html.length} B)`);
}

for (const f of readdirSync(join(SRC, "assets"))) {
  copyFileSync(join(SRC, "assets", f), join(OUT, "assets", f));
  notes.push(`assets/${f}`);
}

// (robots.txt is already written above: it is in the same render map as the pages.)

// sitemap.xml so the policy page is not only indexed but re-crawled when its
// `site.updated` date moves.
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...PAGES.filter((p) => p !== "404.html").map((p) => {
    const loc = p === "index.html" ? `${FLAT.get("site.base")}/` : `${FLAT.get("site.base")}/${p}`;
    return `  <url><loc>${loc}</loc><lastmod>${FLAT.get("site.updated")}</lastmod></url>`;
  }),
  "</urlset>",
  "",
].join("\n");
writeFileSync(join(OUT, "sitemap.xml"), sitemap);
notes.push("sitemap.xml");

for (const f of [".nojekyll", "favicon.png"]) {
  const p = join(SRC, f);
  if (statSync(p, { throwIfNoEntry: false })) {
    copyFileSync(p, join(OUT, f));
    notes.push(f);
  } else if (f === ".nojekyll") {
    console.error(`BUILD REFUSED\n  ✗ missing src/${f}`);
    process.exit(1);
  }
}

console.log(`built dist/\n  ${notes.join("\n  ")}\n`);
console.log(`privacy policy URL: ${FLAT.get("site.base")}${FLAT.get("site.policyPath")}`);
console.log(`support URL:        ${FLAT.get("site.base")}${FLAT.get("site.supportPath")}`);
