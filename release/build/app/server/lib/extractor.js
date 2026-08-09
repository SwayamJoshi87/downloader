import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getToolPath } from './paths.js';
function isRarPart(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.rar')
        return true;
    // .r00 through .r99
    return /^\.r\d{2}$/i.test(ext);
}
function getPartNumber(fileName) {
    const lower = fileName.toLowerCase();
    const partMatch = lower.match(/\.part(\d+)\.rar$/);
    if (partMatch)
        return parseInt(partMatch[1], 10);
    // Old style .r00 -> 1, .r01 -> 2, etc.
    const oldMatch = lower.match(/\.r(\d{2})$/);
    if (oldMatch) {
        const n = parseInt(oldMatch[1], 10);
        return n === 0 ? 1 : n + 1;
    }
    // Plain .rar
    if (lower.endsWith('.rar') && !/\.part\d+\.rar$/.test(lower))
        return 1;
    return null;
}
function isFirstRarPart(fileName) {
    return getPartNumber(fileName) === 1;
}
function getRarSetBaseName(fileName) {
    // name.part01.rar -> name
    const partMatch = fileName.match(/^(.*)\.part\d+\.rar$/i);
    if (partMatch)
        return partMatch[1];
    // name.rar -> name
    if (/\.rar$/i.test(fileName)) {
        return path.basename(fileName, '.rar');
    }
    // name.r00 -> name
    const oldMatch = fileName.match(/^(.*)\.r\d{2}$/i);
    if (oldMatch)
        return oldMatch[1];
    return null;
}
async function listFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
}
function groupRarSets(files) {
    const sets = new Map();
    for (const file of files) {
        if (!isRarPart(file))
            continue;
        const base = getRarSetBaseName(file);
        if (!base)
            continue;
        if (!sets.has(base)) {
            sets.set(base, { baseName: base, firstPart: '', parts: [] });
        }
        const set = sets.get(base);
        set.parts.push(file);
        if (isFirstRarPart(file)) {
            set.firstPart = file;
        }
    }
    // For sets without an explicit first part, pick the lowest numbered part.
    for (const set of sets.values()) {
        if (!set.firstPart && set.parts.length > 0) {
            set.parts.sort((a, b) => (getPartNumber(a) ?? Infinity) - (getPartNumber(b) ?? Infinity));
            set.firstPart = set.parts[0];
        }
    }
    return Array.from(sets.values()).filter((s) => s.firstPart);
}
const RAR_EXTRACTOR_CANDIDATES = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    'C:\\Program Files\\WinRAR\\UnRAR.exe',
    'C:\\Program Files\\WinRAR\\WinRAR.exe',
    'C:\\Program Files (x86)\\WinRAR\\UnRAR.exe',
    'C:\\Program Files (x86)\\WinRAR\\WinRAR.exe',
];
async function fileExists(filePath) {
    try {
        await fs.access(filePath, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function findRarExtractor() {
    for (const candidate of RAR_EXTRACTOR_CANDIDATES) {
        if (await fileExists(candidate))
            return candidate;
    }
    return null;
}
function runExtractor(exe, args, cwd) {
    return new Promise((resolve, reject) => {
        console.log('[extractor] running:', exe, args.join(' '), 'cwd:', cwd);
        const proc = spawn(exe, args, { cwd, windowsHide: true });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (chunk) => {
            const text = chunk.toString('utf-8');
            stdout += text;
            console.log('[extractor stdout]', text.trim());
        });
        proc.stderr?.on('data', (chunk) => {
            const text = chunk.toString('utf-8');
            stderr += text;
            console.error('[extractor stderr]', text.trim());
        });
        proc.on('error', (err) => {
            console.error('[extractor] spawn error:', err);
            reject(err);
        });
        proc.on('close', (code) => {
            console.log('[extractor] exited with code', code);
            if (code === 0 || code === 1) {
                // 7za returns 1 if warnings occurred but extraction succeeded
                resolve();
            }
            else {
                const summary = `${path.basename(exe)} exited with code ${code}.\nstdout:\n${stdout.slice(-4000)}\nstderr:\n${stderr.slice(-2000)}`;
                reject(new Error(summary));
            }
        });
    });
}
export async function extractAndOrganize(downloadFolder, outputFolder, onEvent) {
    console.log('[extractor] starting extraction from', downloadFolder, 'to', outputFolder);
    // Verify extraction tools exist before trying to extract.
    const sevenZipExe = getToolPath('7za.exe');
    try {
        await fs.access(sevenZipExe, fs.constants.X_OK);
    }
    catch {
        throw new Error(`7za executable not found at ${sevenZipExe}`);
    }
    await fs.mkdir(outputFolder, { recursive: true });
    const files = await listFiles(downloadFolder);
    console.log('[extractor] files in download folder:', files);
    const rarSets = groupRarSets(files);
    console.log('[extractor] detected RAR sets:', rarSets);
    const rarExtractor = rarSets.length > 0 ? await findRarExtractor() : null;
    if (rarSets.length > 0) {
        if (!rarExtractor) {
            throw new Error('RAR extraction requires full 7-Zip or WinRAR/UnRAR. Install 7-Zip from https://www.7-zip.org/ and try again.');
        }
        console.log('[extractor] using RAR extractor:', rarExtractor);
    }
    onEvent({ type: 'started', message: `Found ${rarSets.length} RAR archive set(s)`, total: rarSets.length });
    const errorMessages = [];
    // Extract RAR sets sequentially.
    for (let i = 0; i < rarSets.length; i++) {
        const set = rarSets[i];
        onEvent({
            type: 'progress',
            message: `Extracting ${set.firstPart} (${i + 1}/${rarSets.length})...`,
            current: i + 1,
            total: rarSets.length,
        });
        const archivePath = path.join(downloadFolder, set.firstPart);
        try {
            await runExtractor(rarExtractor, ['x', archivePath, '-o' + outputFolder, '-y'], downloadFolder);
        }
        catch (err) {
            const msg = `Failed to extract ${set.firstPart}: ${err.message}`;
            console.error('[extractor]', msg);
            onEvent({ type: 'error', message: msg });
            errorMessages.push(msg);
        }
    }
    // Move non-RAR files into the output folder.
    const rarPartNames = new Set(rarSets.flatMap((s) => s.parts));
    const otherFiles = files.filter((f) => !rarPartNames.has(f));
    console.log('[extractor] non-RAR files to move:', otherFiles);
    for (const file of otherFiles) {
        const src = path.join(downloadFolder, file);
        const dest = path.join(outputFolder, file);
        try {
            await fs.copyFile(src, dest);
            await fs.unlink(src);
        }
        catch (err) {
            const msg = `Failed to move ${file}: ${err.message}`;
            console.error('[extractor]', msg);
            onEvent({ type: 'error', message: msg });
            errorMessages.push(msg);
        }
    }
    if (errorMessages.length > 0) {
        throw new Error(`${errorMessages.length} error(s) during extraction:\n\n${errorMessages.join('\n\n')}`);
    }
    onEvent({ type: 'done', message: 'Extraction and organization complete' });
}
