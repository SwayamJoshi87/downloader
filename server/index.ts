import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { inspect } from 'node:util';
import { decryptPaste } from './lib/pastebin.js';
import { extractLinks } from './lib/links.js';
import { downloadWithAria2Queue, killAria2 } from './lib/aria2.js';
import { extractAndOrganize } from './lib/extractor.js';

const FF_RESOLVER_URL = process.env.FF_RESOLVER_URL || 'https://downloader.swayamjoshi.dev';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'dist');
const ERROR_LOG_PATH = path.join(process.cwd(), 'server-error.log');

function logError(message: string, err?: unknown): void {
  const timestamp = new Date().toISOString();
  const stack =
    err instanceof Error
      ? err.stack || err.message
      : err === undefined
      ? ''
      : typeof err === 'string'
      ? err
      : inspect(err, { depth: 6 });
  const line = `[${timestamp}] ${message}\n${stack || ''}\n\n`;
  console.error(line.trimEnd());
  try {
    fs.appendFileSync(ERROR_LOG_PATH, line);
  } catch (logErr) {
    console.error(`[${timestamp}] Failed to write error log at ${ERROR_LOG_PATH}`, logErr);
  }
}

process.on('uncaughtException', (err) => {
  logError('uncaught exception', err);
});

process.on('unhandledRejection', (reason) => {
  logError('unhandled rejection', reason);
});


const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

interface Client {
  id: number;
  res: http.ServerResponse;
}

let clientId = 0;
const clients = new Map<number, Client>();

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients.values()) {
    client.res.write(payload);
  }
}

function sendDownloadEvent(event: { type: string; [key: string]: unknown }) {
  broadcast('download', event);
}

function sendExtractEvent(event: unknown) {
  broadcast('extract', event);
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  let url = req.url || '/';
  if (url.includes('?')) url = url.split('?')[0];
  if (url === '/') url = '/index.html';

  const filePath = path.join(PUBLIC_DIR, url);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;

  try {
    const content = await fsp.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function listFolder(folderPath: string): Promise<{ name: string; isDirectory: boolean }[]> {
  const resolved = path.resolve(folderPath || process.cwd());
  const entries = await fsp.readdir(resolved, { withFileTypes: true });
  return entries
    .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
    .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
}

function getDrives(): Promise<string[]> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(['/']);
      return;
    }
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_LogicalDisk | Select-Object -ExpandProperty DeviceID'], { shell: false });
    let output = '';
    ps.stdout.on('data', (d) => (output += d.toString()));
    ps.stderr.on('data', (d) => console.error('[drives]', d.toString().trim()));
    ps.on('close', () => {
      const drives = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[A-Za-z]:$/.test(line));
      resolve(drives.length > 0 ? drives : ['C:']);
    });
    ps.on('error', () => resolve(['C:']));
  });
}

async function handleDrives(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const drives = await getDrives();
    json(res, 200, { drives });
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
}

async function handleListFolder(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const { path: folderPath } = await readJson<{ path: string }>(req);
    const entries = await listFolder(folderPath);
    json(res, 200, { path: path.resolve(folderPath || process.cwd()), entries });
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
}

async function handleOpenFolder(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const { folderPath } = await readJson<{ folderPath: string }>(req);
    const command =
      process.platform === 'win32'
        ? `explorer "${folderPath}"`
        : process.platform === 'darwin'
        ? `open "${folderPath}"`
        : `xdg-open "${folderPath}"`;
    spawn(command, { shell: true, detached: true, stdio: 'ignore' });
    json(res, 200, { opened: true });
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
}

async function handleOpenHelp(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const helpPath = path.join(process.cwd(), 'help.md');
    const command =
      process.platform === 'win32'
        ? `notepad "${helpPath}"`
        : process.platform === 'darwin'
        ? `open -e "${helpPath}"`
        : `xdg-open "${helpPath}"`;
    spawn(command, { shell: true, detached: true, stdio: 'ignore' });
    json(res, 200, { opened: true });
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
}

async function handleDecrypt(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const { url } = await readJson<{ url: string }>(req);
    const plaintext = await decryptPaste(url);
    const parsed = extractLinks(plaintext);
    json(res, 200, parsed);
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
}

async function handleStart(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const { items, downloadFolder, outputFolder } = await readJson<{
      items: { url: string; name: string }[];
      downloadFolder: string;
      outputFolder: string;
    }>(req);

    const selected = items.filter((i) => i.url);

    sendDownloadEvent({ type: 'resolving', current: 0, total: selected.length, message: `Submitting ${selected.length} link(s) to resolver...` });

    // Submit batch to ff-resolver service
    const links = selected.map((i) => i.url);
    const filenameMap = new Map(selected.map((i) => [i.url, i.name]));
    const { job_id } = await (await fetch(`${FF_RESOLVER_URL}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links }),
    })).json();

    sendDownloadEvent({ type: 'resolving', current: 0, total: selected.length, message: `Job ${job_id} — resolving ${selected.length} link(s)...` });

    let queuedCount = 0;
    await downloadWithAria2Queue(
      selected.length,
      downloadFolder,
      (event) => sendDownloadEvent(event),
      async (addDownload) => {
        // Poll ff-resolver until complete
        let lastDone = 0;
        let lastCurrent: string | null = null;
        while (true) {
          const job = await (await fetch(`${FF_RESOLVER_URL}/jobs/${job_id}`)).json();

          // Notify client which link is currently being resolved
          if (job.current && job.current !== lastCurrent) {
            lastCurrent = job.current;
            const cf = filenameMap.get(job.current) || job.current.split('/').pop() || '';
            sendDownloadEvent({
              type: 'resolving',
              current: job.progress?.done || 0,
              total: selected.length,
              message: `Resolving: ${cf}`,
              url: job.current,
              filename: cf,
              status: undefined,
            });
          }

          // Feed newly resolved links to aria2c
          for (let i = lastDone; i < (job.results?.length || 0); i++) {
            const r = job.results[i];
            const filename = filenameMap.get(r.url) || r.filename;
            if (r.direct_url) {
              await addDownload({ directUrl: r.direct_url, filename });
              queuedCount++;
              sendDownloadEvent({
                type: 'resolving',
                current: queuedCount,
                total: selected.length,
                message: `Resolved: ${filename}`,
                url: r.url,
                filename,
                status: 'ok',
              });
            } else {
              sendDownloadEvent({
                type: 'resolving',
                current: queuedCount + 1,
                total: selected.length,
                message: `Failed: ${filename} — ${r.error || 'unknown'}`,
                url: r.url,
                filename,
                status: 'fail',
              });
              queuedCount++;
            }
            lastDone = i + 1;
          }

          if (job.status === 'failed') {
            sendDownloadEvent({ type: 'error', message: job.error || 'Resolver job failed' });
            return;
          }
          if (job.status === 'completed') break;

          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    );

    sendDownloadEvent({ type: 'done' });

    await extractAndOrganize(downloadFolder, outputFolder, (event) => sendExtractEvent(event));

    json(res, 200, { done: true });
  } catch (err) {
    logError('/api/start failed', err);
    sendDownloadEvent({ type: 'error', message: (err as Error).message });
    json(res, 500, { error: (err as Error).message, stack: (err as Error).stack });
  }
}

function handleCancel(_req: http.IncomingMessage, res: http.ServerResponse) {
  killAria2();
  json(res, 200, { canceled: true });
}

function handleEvents(req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(':ok\n\n');

  const id = ++clientId;
  clients.set(id, { id, res });

  req.on('close', () => {
    clients.delete(id);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.url?.startsWith('/api/events')) {
      handleEvents(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/drives') {
      await handleDrives(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/list-folder') {
      await handleListFolder(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/open-folder') {
      await handleOpenFolder(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/help') {
      await handleOpenHelp(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/decrypt') {
      await handleDecrypt(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/start') {
      await handleStart(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/cancel') {
      handleCancel(req, res);
      return;
    }

    if (await serveStatic(req, res)) return;

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    logError(`request error: ${req.method} ${req.url}`, err);
    if (!res.headersSent) {
      json(res, 500, {
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
    }
  }
});

function findPort(preferredPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = new http.Server();
    s.listen(preferredPort, '127.0.0.1', () => {
      s.close(() => resolve(preferredPort));
    });
    s.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && preferredPort < 8799) {
        resolve(findPort(preferredPort + 1));
      } else {
        reject(err);
      }
    });
  });
}

async function startServer(preferredPort = 8765) {
  const port = await findPort(preferredPort);
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`[server] FitGirl Downloader web UI running at ${url}`);
    console.log(`[server] Errors are also written to: ${ERROR_LOG_PATH}`);

    if (process.env.NO_OPEN_BROWSER) {
      return;
    }

    // Open browser.
    const command =
      process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
    spawn(command, { shell: true, detached: true, stdio: 'ignore' });
  });
}

startServer();
