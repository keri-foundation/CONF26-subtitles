#!/usr/bin/env node
/**
 * Generate static, crawlable HTML transcript pages from gallery index.json + .srt files.
 *
 * Each talk with a subtitle becomes a page under a transcripts/ folder. Paths inside
 * those pages are relative to the gallery index.html so the tree can be moved later.
 *
 * Usage:
 *   node scripts/generate-transcript-pages.js \
 *     --config /path/to/videos/index.json
 *
 * Options:
 *   --config <path>   Gallery index.json (required). Media root = its directory.
 *   --dry-run         Print planned outputs without writing.
 *
 * Output layout:
 *   - subtitle "KERICONF26/subtitles/foo.srt" → KERICONF26/transcripts/<id>.html
 *   - subtitle "speakers/foo.srt" (no /subtitles/) → transcripts/<id>.html
 *   Plus transcripts/index.html listing pages written in each transcripts/ dir.
 */

import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BOM = "\uFEFF";
const TIME_PAT =
  /(\d{2}:\d{2}:\d{2})[.,](\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2})[.,](\d{3})/;

function parseArgs(argv) {
  const opts = { config: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") opts.config = argv[++i];
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function usage() {
  console.log(`Usage: node scripts/generate-transcript-pages.js --config <index.json> [--dry-run]`);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateVideoId(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function srtTimeToSeconds(hms, ms) {
  const [h, m, s] = hms.split(":").map(Number);
  return h * 3600 + m * 60 + s + Number(ms) / 1000;
}

function formatTime(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function parseSrt(raw) {
  const cues = [];
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const stripped = normalized.startsWith(BOM) ? normalized.slice(1) : normalized;
  const blocks = stripped.split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    let timeLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (TIME_PAT.test(lines[i])) {
        timeLine = i;
        break;
      }
    }
    if (timeLine === -1) continue;
    const m = lines[timeLine].match(TIME_PAT);
    if (!m) continue;
    const startSec = srtTimeToSeconds(m[1], m[2]);
    const cueText = lines
      .slice(timeLine + 1)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cueText) continue;
    cues.push({
      start: startSec,
      end: srtTimeToSeconds(m[3], m[4]),
      startLabel: formatTime(startSec),
      text: cueText,
    });
  }
  return cues;
}

/** Normalize path separators; return posix-style relative path. */
function toPosix(p) {
  return p.split(sep).join("/");
}

/**
 * Where the transcript HTML should live, relative to the gallery (config) directory.
 * Mirrors the earlier design: replace .../subtitles/ with .../transcripts/, else
 * use gallery-local transcripts/.
 */
function transcriptRelDir(subtitleRel) {
  const sub = toPosix(subtitleRel);
  if (sub.includes("/subtitles/")) {
    return sub.split("/subtitles/")[0] + "/transcripts";
  }
  return "transcripts";
}

function relativeHref(fromFile, toFile) {
  let rel = toPosix(relative(dirname(fromFile), toFile));
  if (!rel || rel === ".") rel = "./";
  else if (!rel.startsWith(".") && !rel.startsWith("/")) rel = "./" + rel;
  return rel;
}

function watchHref(fromFile, galleryIndexFile, videoId, startSec) {
  const galleryRel = relativeHref(fromFile, galleryIndexFile);
  // Point at the gallery directory (or index.html); hash opens the modal.
  const base = galleryRel.endsWith("index.html")
    ? galleryRel.replace(/index\.html$/, "") || "./"
    : galleryRel.endsWith("/")
      ? galleryRel
      : galleryRel + "/";
  const t = Math.floor(Math.max(0, startSec || 0));
  return t > 0 ? `${base}#${videoId}&t=${t}` : `${base}#${videoId}`;
}

function pageChrome(page) {
  return {
    siteTitle: page?.title || "Videos",
    heading: page?.heading || page?.title || "Videos",
    footer: page?.footer || "KERI Foundation",
  };
}

function renderTalkPage({
  video,
  videoId,
  cues,
  chrome,
  galleryHref,
  listingHref,
  watchTopHref,
}) {
  const title = video.title || videoId;
  const day = video.day || "";
  const duration = video.duration || "";
  const metaBits = [day, duration].filter(Boolean).join(" · ");

  const cueHtml = cues
    .map((cue) => {
      const t = Math.floor(cue.start);
      const href = t > 0 ? `${galleryHref}#${videoId}&t=${t}` : `${galleryHref}#${videoId}`;
      return `    <p class="cue" id="t${t}">
      <a class="cue-time" href="${escHtml(href)}">${escHtml(cue.startLabel)}</a>
      <span class="cue-text">${escHtml(cue.text)}</span>
    </p>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} — Transcript</title>
  <meta name="description" content="${escHtml(`Transcript: ${title}${metaBits ? ` (${metaBits})` : ""}`)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink: #060b6f;
      --muted: #2e3a7a;
      --bg: #b1d1cf;
      --panel: rgba(255, 255, 255, 0.55);
      --accent: #986c32;
      --link: #0450a8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Source Serif 4", Georgia, serif;
      background:
        radial-gradient(ellipse 80% 50% at 10% -10%, rgba(255,255,255,0.45), transparent),
        radial-gradient(ellipse 60% 40% at 100% 0%, rgba(152,108,50,0.12), transparent),
        var(--bg);
      color: var(--ink);
      padding: 24px 16px 48px;
      line-height: 1.55;
    }
    .wrap { max-width: 44rem; margin: 0 auto; }
    nav {
      font-family: "Plus Jakarta Sans", "Segoe UI", sans-serif;
      font-size: 0.9rem;
      margin-bottom: 1.25rem;
    }
    nav a { color: var(--link); }
    nav a:hover { color: var(--ink); }
    header {
      background: var(--panel);
      border: 1px solid rgba(6, 11, 111, 0.12);
      border-radius: 10px;
      padding: 1.25rem 1.4rem;
      margin-bottom: 1.5rem;
    }
    h1 {
      font-family: "Plus Jakarta Sans", "Segoe UI", sans-serif;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.15;
      font-size: clamp(1.45rem, 3vw, 2rem);
      margin: 0 0 0.4rem;
    }
    .meta {
      font-family: "Plus Jakarta Sans", "Segoe UI", sans-serif;
      color: var(--muted);
      font-size: 0.95rem;
      margin: 0 0 1rem;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
    }
    .actions a {
      font-family: "Plus Jakarta Sans", "Segoe UI", sans-serif;
      font-weight: 600;
      font-size: 0.9rem;
      text-decoration: none;
      color: var(--ink);
      background: rgba(152, 108, 50, 0.18);
      border: 1px solid rgba(152, 108, 50, 0.35);
      border-radius: 8px;
      padding: 0.55rem 0.9rem;
    }
    .actions a:hover { background: rgba(152, 108, 50, 0.28); }
    .actions a.primary {
      background: var(--ink);
      color: #fff;
      border-color: var(--ink);
    }
    .actions a.primary:hover { background: #0a1270; }
    article {
      background: var(--panel);
      border: 1px solid rgba(6, 11, 111, 0.12);
      border-radius: 10px;
      padding: 1rem 1.25rem 1.5rem;
    }
    .cue {
      display: grid;
      grid-template-columns: 4.5rem 1fr;
      gap: 0.65rem 0.85rem;
      margin: 0;
      padding: 0.45rem 0;
      border-bottom: 1px solid rgba(6, 11, 111, 0.08);
    }
    .cue:last-child { border-bottom: none; }
    .cue-time {
      font-family: "Plus Jakarta Sans", "Segoe UI", sans-serif;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--accent);
      text-decoration: none;
      padding-top: 0.15rem;
    }
    .cue-time:hover { color: var(--ink); text-decoration: underline; }
    .cue-text { font-size: 1.05rem; }
    footer {
      font-family: "Plus Jakarta Sans", "Segoe UI", sans-serif;
      margin-top: 2rem;
      font-size: 0.85rem;
      color: var(--muted);
      text-align: center;
    }
    @media (max-width: 520px) {
      .cue { grid-template-columns: 1fr; gap: 0.2rem; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <nav>
      <a href="${escHtml(galleryHref)}">${escHtml(chrome.heading)}</a>
      · <a href="${escHtml(listingHref)}">All transcripts</a>
    </nav>
    <header>
      <h1>${escHtml(title)}</h1>
      ${metaBits ? `<p class="meta">${escHtml(metaBits)}</p>` : ""}
      <div class="actions">
        <a class="primary" href="${escHtml(watchTopHref)}">Watch video</a>
        <a href="${escHtml(listingHref)}">All transcripts</a>
        <a href="${escHtml(galleryHref)}">Video gallery</a>
      </div>
    </header>
    <article>
${cueHtml || "      <p>No subtitle cues found.</p>"}
    </article>
    <footer>${escHtml(chrome.footer)}</footer>
  </div>
</body>
</html>
`;
}

function renderListingPage({ chrome, galleryHref, entries, dayOrder }) {
  const byDay = new Map();
  for (const e of entries) {
    const day = e.day || "Talks";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }

  const orderedDays =
    dayOrder && dayOrder.length
      ? [...dayOrder.filter((d) => byDay.has(d)), ...[...byDay.keys()].filter((d) => !dayOrder.includes(d))]
      : [...byDay.keys()];

  const sections = orderedDays
    .map((day) => {
      const items = byDay
        .get(day)
        .map(
          (e) =>
            `        <li><a href="${escHtml(e.fileName)}">${escHtml(e.title)}</a>${
              e.duration ? ` <span class="dur">${escHtml(e.duration)}</span>` : ""
            }</li>`
        )
        .join("\n");
      return `      <section>
        <h2>${escHtml(day)}</h2>
        <ul>
${items}
        </ul>
      </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transcripts — ${escHtml(chrome.heading)}</title>
  <meta name="description" content="${escHtml(`Searchable transcripts for ${chrome.heading}`)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink: #060b6f;
      --muted: #2e3a7a;
      --bg: #b1d1cf;
      --panel: rgba(255, 255, 255, 0.55);
      --link: #0450a8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Source Serif 4", Georgia, serif;
      background:
        radial-gradient(ellipse 80% 50% at 10% -10%, rgba(255,255,255,0.45), transparent),
        var(--bg);
      color: var(--ink);
      padding: 24px 16px 48px;
      line-height: 1.5;
    }
    .wrap { max-width: 40rem; margin: 0 auto; }
    nav, h1, h2, .dur {
      font-family: "Plus Jakarta Sans", "Segoe UI", sans-serif;
    }
    nav { font-size: 0.9rem; margin-bottom: 1rem; }
    nav a, a { color: var(--link); }
    h1 {
      font-weight: 800;
      letter-spacing: -0.03em;
      font-size: clamp(1.5rem, 3vw, 2rem);
      margin: 0 0 0.35rem;
    }
    .lead { color: var(--muted); margin: 0 0 1.5rem; }
    section {
      background: var(--panel);
      border: 1px solid rgba(6, 11, 111, 0.12);
      border-radius: 10px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
    }
    h2 { font-size: 1.05rem; margin: 0 0 0.6rem; }
    ul { margin: 0; padding-left: 1.15rem; }
    li { margin: 0.35rem 0; }
    .dur { color: var(--muted); font-size: 0.85rem; font-weight: 600; }
    footer {
      font-family: "Plus Jakarta Sans", "Segoe UI", sans-serif;
      margin-top: 2rem;
      font-size: 0.85rem;
      color: var(--muted);
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <nav><a href="${escHtml(galleryHref)}">${escHtml(chrome.heading)}</a></nav>
    <h1>Transcripts</h1>
    <p class="lead">Full text of each talk. Open a transcript, then jump to the matching moment in the video.</p>
${sections}
    <footer>${escHtml(chrome.footer)}</footer>
  </div>
</body>
</html>
`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.config) {
    usage();
    process.exit(opts.help ? 0 : 1);
  }

  const configPath = resolve(opts.config);
  if (!existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  const galleryDir = dirname(configPath);
  const galleryIndexFile = join(galleryDir, "index.html");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const chrome = pageChrome(config.page);
  const videos = Array.isArray(config.videos) ? config.videos : [];
  const dayOrder = Array.isArray(config.days) ? config.days : [];

  /** @type {Map<string, { absDir: string, entries: object[] }>} */
  const listings = new Map();
  let written = 0;
  let skipped = 0;

  for (const video of videos) {
    if (!video.subtitle) {
      skipped++;
      continue;
    }

    const videoId = generateVideoId(video.title);
    if (!videoId) {
      console.warn(`Skip (empty id): ${video.title}`);
      skipped++;
      continue;
    }

    const subtitleRel = toPosix(video.subtitle);
    const srtAbs = join(galleryDir, ...subtitleRel.split("/"));
    if (!existsSync(srtAbs)) {
      console.warn(`Missing SRT, skip: ${srtAbs}`);
      skipped++;
      continue;
    }

    const outDirRel = transcriptRelDir(subtitleRel);
    const outDirAbs = join(galleryDir, ...outDirRel.split("/"));
    const fileName = `${videoId}.html`;
    const outFileAbs = join(outDirAbs, fileName);

    const raw = await readFile(srtAbs, "utf8");
    const cues = parseSrt(raw);

    const galleryHref = relativeHref(outFileAbs, galleryIndexFile).replace(/index\.html$/, "") || "./";
    const listingHref = "./";
    const watchTopHref = watchHref(outFileAbs, galleryIndexFile, videoId, 0);

    const html = renderTalkPage({
      video,
      videoId,
      cues,
      chrome,
      galleryHref,
      listingHref,
      watchTopHref,
    });

    if (!listings.has(outDirRel)) {
      listings.set(outDirRel, { absDir: outDirAbs, entries: [] });
    }
    listings.get(outDirRel).entries.push({
      title: video.title,
      day: video.day,
      duration: video.duration,
      fileName,
      videoId,
      order: video.order || 0,
    });

    console.log(`${opts.dryRun ? "[dry-run] " : ""}write ${toPosix(relative(galleryDir, outFileAbs))} (${cues.length} cues)`);

    if (!opts.dryRun) {
      await mkdir(outDirAbs, { recursive: true });
      await writeFile(outFileAbs, html, "utf8");
    }
    written++;
  }

  for (const [outDirRel, { absDir, entries }] of listings) {
    entries.sort((a, b) => {
      if (a.day !== b.day) return String(a.day).localeCompare(String(b.day));
      return (a.order || 0) - (b.order || 0);
    });

    // Remove stale HTML pages not in this generation (keep only current set + index)
    if (!opts.dryRun && existsSync(absDir)) {
      const keep = new Set(entries.map((e) => e.fileName));
      keep.add("index.html");
      for (const name of await readdir(absDir)) {
        if (!name.endsWith(".html")) continue;
        if (!keep.has(name)) {
          await rm(join(absDir, name));
          console.log(`removed stale ${toPosix(join(outDirRel, name))}`);
        }
      }
    }

    const indexAbs = join(absDir, "index.html");
    const galleryHref = relativeHref(indexAbs, galleryIndexFile).replace(/index\.html$/, "") || "./";
    const listingHtml = renderListingPage({
      chrome,
      galleryHref,
      entries,
      dayOrder,
    });
    console.log(`${opts.dryRun ? "[dry-run] " : ""}write ${toPosix(join(outDirRel, "index.html"))} (${entries.length} talks)`);
    if (!opts.dryRun) {
      await mkdir(absDir, { recursive: true });
      await writeFile(indexAbs, listingHtml, "utf8");
    }
  }

  console.log(`Done. ${written} transcript page(s), ${skipped} skipped, ${listings.size} listing(s).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
