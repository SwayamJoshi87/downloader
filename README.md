# FitGirl Downloader

A Windows desktop app that decrypts FitGirl/PrivateBin pastes, downloads the listed files with aria2c, and auto-extracts RAR archives.

## Features

- Paste a `paste.fitgirl-repacks.site` URL and decrypt it locally.
- Choose a download folder and a separate output/extract folder.
- Lists every file found; non-optional files are selected by default.
- Select All / Deselect All controls.
- Downloads selected files with **aria2c** using 16 segments per file and up to 5 concurrent files.
- Automatically extracts RAR archive sets into the output folder.
- Moves non-RAR files into the output folder.

## Usage

1. Run the portable executable: `release/FitGirl Downloader 1.0.0.exe`
2. Paste the PrivateBin URL.
3. Choose the **download folder** and the **output folder**.
4. Click **Decrypt**, review the file list, then click **Download**.
5. Downloads and extraction run automatically.

## Development

```bash
npm install
npm run dev          # Start Vite + Electron in dev mode
npm run build        # Build renderer + main process
npm run dist:portable # Build the Windows portable .exe
```

## Bundled tools

- `resources/tools/aria2c.exe` — multi-threaded downloader
- `resources/tools/7za.exe` — 7-Zip console extractor

## Notes

- fuckingfast.co is Cloudflare-protected; the app uses Electron's built-in Chromium to load the page and resolve the direct download link when plain HTTP is blocked.
- The app is Windows-only.
