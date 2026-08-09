# FitGirl Downloader — Help

## What this app does

1. Decrypts a FitGirl/PrivateBin paste URL.
2. Lists all `fuckingfast.co` download links found in the paste.
3. Resolves each shortened link to a direct download URL.
4. Downloads the files with aria2c.
5. Automatically extracts RAR archives and moves non-RAR files to the output folder.

## Getting started

1. Paste the FitGirl repack link (e.g. `https://paste.fitgirl-repacks.site/?...#...`) into the **Paste URL** field.
2. Click **Decrypt**.
3. Choose a **Download folder** (where raw `.rar` parts are saved).
4. Choose an **Output/Extract folder** (where the final game files go).
5. Select the files you want and click **Download**.

## File selection

- **Optional** and **Selective** files are unchecked by default.
- Use the bulk buttons to quickly select groups:
  - **Select All**
  - **Deselect All**
  - **Check All 4K** — selects files whose names contain `4K`
  - **Check All Selective** — selects files whose names contain `selective`
  - **Check All Optional** — selects files whose names contain `optional`

You can still toggle individual files after using a bulk button.

## Downloads

- The app downloads up to **10 files at once**.
- Each file uses a **single connection** because fuckingfast.co's server rejects multi-range requests.
- If a download fails, the error appears in the status area.

## Extraction

- After all downloads finish, 7-Zip extracts RAR archive sets into the output folder.
- Non-RAR files (e.g. `.txt`, `.nfo`, optional extras) are copied to the output folder.
- If extraction fails, check the error message and make sure the output folder is writable.

## Tips

- Put the download folder and output folder on the **same drive** for faster file moves.
- Keep the app window open until extraction finishes.
- Use the dark-mode toggle in the top-right if you prefer a darker UI.

## Troubleshooting

| Problem | Likely cause |
|---|---|
| Downloads show "Error" | fuckingfast.co link expired or rate-limited |
| Extraction does nothing | No `.rar` files in download folder, or 7za could not be found |
| UI stays on "Resolving" | Browser-based link resolution is still running |
| Output folder is empty | Extraction failed; check the error message |
