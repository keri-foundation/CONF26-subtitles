# KERI Conference 2026 Subtitles

## General info

This repository contains automatically generated subtitle files for the video recordings of the KERI Conference 2026.

These subtitles are being manually edited here.

## Tools

Subtitle Edit is a good tool for creating or editing subtitles.

https://subtitleedit.github.io/subtitleedit/

https://github.com/SubtitleEdit

## Scripts

- `scripts/remove-rolling-subtitles.js` — cleans YouTube rolling-caption artefacts from the `.srt` files in `subtitles/`.
- `scripts/build-transcript-pdf.js` — assembles every `*.fixed.srt` file into a beautifully designed PDF book of transcripts.
- `scripts/generate-transcript-pages.js` — builds static, crawlable HTML transcript pages for the keri.foundation video galleries (relative links back to the player).
- `scripts/deploy-subtitles.sh` — copies `.srt` files to the local kerifoundation mirror and the live server, then regenerates and rsyncs transcript HTML.
- `scripts/upload-youtube-subs.sh` / `src/youtube-uploader.js` — uploads `.fixed.srt` files from `subtitles/` back to a YouTube playlist.

### Building the transcripts PDF

```bash
npm install
npm run build:pdf        # writes KERI-Conference-2026-Transcripts.pdf to the repo root
npm run build:pdf -- --open   # build and open in the default viewer
```

### Static HTML transcript pages (SEO)

```bash
npm run build:transcript-pages   # write HTML into the local kerifoundation videos tree
npm run deploy:subtitles         # .srt + transcript HTML → local mirror + live server
```

Output (relative links inside each page):

- `…/videos/KERICONF26/transcripts/`
- `…/videos/KERICONF26-interviews/transcripts/`
- `…/videos/SEDI/2025-11-SEDI/transcripts/`

The PDF is rendered by the locally installed Google Chrome via `puppeteer-core`
(no Chromium download required). On macOS it auto-detects Chrome at
`/Applications/Google Chrome.app`; on Linux set the path in
`CHROME_CANDIDATES` inside the script.

The generated PDF includes:

- A full-bleed cover page
- A table of contents listing all talks with runtimes
- One chapter per talk with a dark opener page and a flowing, timestamped transcript body

### Uploading subtitles to YouTube

> First-time setup required. See [YOUTUBE_UPLOADER_SETUP.md](YOUTUBE_UPLOADER_SETUP.md) for OAuth2 credentials configuration.

Upload edited subtitles from `subtitles/` to a YouTube playlist:

```bash
npm install
npm run upload -- 'https://www.youtube.com/playlist?list=XYZ'
```

Upload only one subtitle file (quota-friendly):

```bash
npm run upload -- 'https://www.youtube.com/playlist?list=XYZ' --file 'Ari Argoud ｜ KRAM IT! with Ari ｜ KERI Conference 2026.fixed.srt'
```

You can also pass a custom subtitles directory plus one file:

```bash
npm run upload -- 'https://www.youtube.com/playlist?list=XYZ' subtitles --file 'Ari Argoud ｜ KRAM IT! with Ari ｜ KERI Conference 2026.fixed.srt'
```

The uploader:

- Fetches all videos in the playlist
- Matches each `.fixed.srt` file in `subtitles/` to a video by title
- Uploads or updates the subtitle on each video
- Supports uploading exactly one selected `.fixed.srt` file with `--file`
- Skips unchanged subtitle files automatically using local hash history in `.youtube-upload-state.json`
- Supports forcing upload of unchanged files with `--force`
- Automatically retries authentication when a saved OAuth token is invalid (`invalid_grant`)
- Supports forcing manual re-authentication with `--reauth`
- Supports 2FA authentication on first run
- Saves credentials locally for future uploads

Force upload even if file hash is unchanged:

```bash
npm run upload -- 'https://www.youtube.com/playlist?list=XYZ' --force
```

Force OAuth re-consent:

```bash
npm run upload -- 'https://www.youtube.com/playlist?list=XYZ' --reauth
```
