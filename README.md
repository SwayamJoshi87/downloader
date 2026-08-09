# FitGirl Downloader

A Windows app that decrypts FitGirl/PrivateBin pastes, downloads the listed files with aria2c, and auto-extracts RAR archives.

It's a small local web app: a Node HTTP server (`server/`) serves the built React UI (`src/`) and does the actual work (decrypting the paste, resolving links, running aria2c/7za), streaming progress back to the browser over Server-Sent Events. The packaged `.exe` just bundles a Node runtime and launches that server for you — there's no Electron/browser shell involved.

## Features

- Paste a `paste.fitgirl-repacks.site` URL and decrypt it locally.
- Choose a download folder and a separate output/extract folder.
- Lists every file found; non-optional files are selected by default.
- Select All / Deselect All controls.
- Downloads selected files with **aria2c** using 16 segments per file and up to 5 concurrent files.
- Automatically extracts RAR archive sets into the output folder.
- Moves non-RAR files into the output folder.

## Usage

1. Run one of the built executables (see [Building the Windows app](#building-the-windows-app)):
   - `release/FitGirl Downloader Single.exe` — single portable file, extracts itself to a temp folder on first run.
   - `release/win/FitGirl Downloader.exe` — same app as a folder (`app/`, `runtime/`) you can copy around.
2. Paste the PrivateBin URL.
3. Choose the **download folder** and the **output folder**.
4. Click **Decrypt**, review the file list, then click **Download**.
5. Downloads and extraction run automatically.

## Development

```bash
npm install
npm run dev    # Start the API server + Vite dev server, opens the browser
npm run build  # Build the renderer only (outputs to dist/)
npm run start  # Build, then run the server directly (serves dist/ on http://127.0.0.1:<port>)
```

## Building the Windows app

```bash
npm run package:win
```

This runs `scripts/package-win.js`, which builds the renderer, compiles `server/` with `tsc`, and produces:

- `release/win/FitGirl Downloader.exe` (+ `app/` and `runtime/` alongside it) — a folder-based portable build.
- `release/FitGirl Downloader Single.exe` — the same build packed into one self-extracting exe.

Both launch a bundled `node.exe` running the compiled server; no separate Node install is required on the target machine. Building the single-file exe requires `csc.exe` (.NET Framework, included with Windows) to be present.

## Project structure

- `src/` — React UI (Vite). `http-api.ts` is the client for the server's HTTP/SSE endpoints.
- `server/` — Node HTTP server: paste decryption (`lib/pastebin.ts`), link extraction (`lib/links.ts`), aria2c orchestration (`lib/aria2.ts`), RAR extraction (`lib/extractor.ts`).
- `scripts/dev-server.js` — runs the API server and Vite together for `npm run dev`.
- `scripts/package-win.js` — builds the portable Windows executables described above.
- `resources/tools/` — bundled `aria2c.exe` and `7za.exe`.

## Bundled tools

- `resources/tools/aria2c.exe` — multi-threaded downloader
- `resources/tools/7za.exe` — 7-Zip console extractor

## Notes

- fuckingfast.co is Cloudflare-protected, so the server resolves its direct download links via a small hosted resolver service (`FF_RESOLVER_URL`, defaults to `https://downloader.swayamjoshi.dev`) instead of driving a local browser.
- The app is Windows-only.
