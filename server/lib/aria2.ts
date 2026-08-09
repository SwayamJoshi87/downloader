import { spawn, ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { createServer } from 'node:net';
import fs from 'node:fs/promises';
import { getToolPath } from './paths.js';

export interface Aria2Item {
  directUrl: string;
  filename: string;
}

export interface FileProgress {
  gid: string;
  filename: string;
  totalBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
}

export interface Aria2OverallProgress {
  totalBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  files: FileProgress[];
}

export type Aria2EventCallback = (
  event:
    | { type: 'progress'; data: Aria2OverallProgress }
    | { type: 'done' }
    | { type: 'error'; message: string }
) => void;

let currentProcess: ChildProcess | null = null;

export function killAria2(): void {
  if (currentProcess && !currentProcess.killed) {
    currentProcess.kill('SIGKILL');
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function rpcCall(port: number, secret: string, method: string, params: unknown[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      params: [`token:${secret}`, ...params],
    });

    fetch(`http://127.0.0.1:${port}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
      .then(async (res) => {
        if (!res.ok) {
          reject(new Error(`RPC ${method} failed: ${res.status}`));
          return;
        }
        const json = (await res.json()) as { error?: { message: string }; result?: unknown };
        if (json.error) {
          reject(new Error(`RPC ${method} error: ${json.error.message}`));
          return;
        }
        resolve(json.result);
      })
      .catch(reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function downloadWithAria2(
  items: Aria2Item[],
  downloadFolder: string,
  onEvent: Aria2EventCallback
): Promise<void> {
  return downloadWithAria2Queue(items.length, downloadFolder, onEvent, async (addDownload) => {
    for (const item of items) {
      await addDownload(item);
    }
  });
}

export async function downloadWithAria2Queue(
  expectedItems: number,
  downloadFolder: string,
  onEvent: Aria2EventCallback,
  producer: (addDownload: (item: Aria2Item) => Promise<void>) => Promise<void>
): Promise<void> {
  if (expectedItems === 0) {
    onEvent({ type: 'done' });
    return;
  }

  await fs.mkdir(downloadFolder, { recursive: true });

  const port = await getFreePort();
  const secret = crypto.randomUUID();

  const args = [
    '--enable-rpc',
    `--rpc-listen-port=${port}`,
    `--rpc-secret=${secret}`,
    '--rpc-listen-all=false',
    '--rpc-allow-origin-all',
    '--console-log-level=error',
    '--file-allocation=trunc',
    '--continue=true',
    '--auto-file-renaming=false',
    '--allow-overwrite=true',
    '--split=1',
    '--max-connection-per-server=1',
    '--max-concurrent-downloads=10',
    '--continue=false',
  ];

  return new Promise((resolve, reject) => {
    const aria2cPath = getToolPath('aria2c.exe');
    console.log('Spawning aria2c:', aria2cPath, args.join(' '));

    const proc = spawn(aria2cPath, args, { windowsHide: true });
    currentProcess = proc;

    let stdoutBuffer = '';
    let stderrBuffer = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stdoutBuffer += text;
      console.log('[aria2c stdout]', text.trim());
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderrBuffer += text;
      console.log('[aria2c stderr]', text.trim());
    });

    proc.on('error', (err) => {
      console.error('aria2c spawn error:', err);
      currentProcess = null;
      reject(err);
    });

    proc.on('close', (code) => {
      console.log('aria2c exited with code', code);
      currentProcess = null;
      if (code !== 0 && code !== null) {
        reject(new Error(`aria2c exited with code ${code}. stdout: ${stdoutBuffer.slice(-2000)} stderr: ${stderrBuffer.slice(-2000)}`));
      }
    });

    const gids: string[] = [];
    let finished = false;
    let producerDone = false;
    let settled = false;

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const cleanup = (fn?: () => void) => {
      finished = true;
      if (currentProcess && !currentProcess.killed) {
        currentProcess.kill('SIGKILL');
      }
      currentProcess = null;
      fn?.();
    };

    const waitForRpc = async (): Promise<void> => {
      let lastError = '';
      for (let i = 0; i < 60; i++) {
        try {
          await rpcCall(port, secret, 'aria2.getVersion');
          console.log('aria2c RPC ready on port', port);
          return;
        } catch (err) {
          lastError = (err as Error).message;
          await sleep(500);
        }
      }
      throw new Error(`aria2c RPC did not become ready on port ${port}. Last error: ${lastError}`);
    };

    const addDownloads = async (): Promise<void> => {
      await rpcCall(port, secret, 'aria2.changeGlobalOption', [{ dir: downloadFolder }]);
    };

    const addDownload = async (item: Aria2Item): Promise<void> => {
      const gid = (await rpcCall(port, secret, 'aria2.addUri', [
        [item.directUrl],
        {
          out: item.filename,
          split: '1',
          'max-connection-per-server': '1',
          'file-allocation': 'trunc',
          continue: 'false',
        },
      ])) as string;
      gids.push(gid);
    };

    const parseFileStatus = (raw: { gid: string; files: { path: string; length: string; completedLength: string }[]; totalLength: string; completedLength: string; downloadSpeed: string; status: string }[]): FileProgress[] => {
      return raw.map((entry) => {
        const file = entry.files?.[0];
        const filename = file ? file.path.split('/').pop() || file.path.split('\\').pop() || entry.gid : entry.gid;
        return {
          gid: entry.gid,
          filename: filename || entry.gid,
          totalBytes: parseInt(entry.totalLength || '0', 10),
          downloadedBytes: parseInt(entry.completedLength || '0', 10),
          speedBytesPerSec: parseInt(entry.downloadSpeed || '0', 10),
          status: (entry.status as FileProgress['status']) || 'waiting',
        };
      });
    };

    const poll = async (): Promise<void> => {
      while (!finished) {
        try {
          const active = (await rpcCall(port, secret, 'aria2.tellActive')) as Parameters<typeof parseFileStatus>[0];
          const statusLimit = Math.max(100, gids.length);
          const waiting = (await rpcCall(port, secret, 'aria2.tellWaiting', [0, statusLimit])) as Parameters<typeof parseFileStatus>[0];
          const stopped = (await rpcCall(port, secret, 'aria2.tellStopped', [0, statusLimit])) as Parameters<typeof parseFileStatus>[0];

          const all = [...active, ...waiting, ...stopped].filter((entry) => gids.includes(entry.gid));
          const files = parseFileStatus(all);

          const totalBytes = files.reduce((sum, f) => sum + f.totalBytes, 0);
          const downloadedBytes = files.reduce((sum, f) => sum + f.downloadedBytes, 0);
          const speedBytesPerSec = files.reduce((sum, f) => sum + f.speedBytesPerSec, 0);

          onEvent({
            type: 'progress',
            data: { totalBytes, downloadedBytes, speedBytesPerSec, files },
          });

          const allStopped = gids.every((gid) => {
            const f = files.find((x) => x.gid === gid);
            return f && (f.status === 'complete' || f.status === 'error' || f.status === 'removed');
          });

          if (producerDone && expectedItems === 0) {
            cleanup(() => {
              onEvent({ type: 'done' });
              settleResolve();
            });
            return;
          }

          if (producerDone && allStopped && gids.length === expectedItems) {
            const errors = files.filter((f) => f.status === 'error');
            if (errors.length > 0) {
              cleanup(() => settleReject(new Error(`${errors.length} download(s) failed`)));
            } else {
              cleanup(() => {
                onEvent({ type: 'done' });
                settleResolve();
              });
            }
            return;
          }
        } catch {
          // Ignore transient RPC errors and keep polling.
        }
        await sleep(1000);
      }
    };

    (async () => {
      try {
        await waitForRpc();
        await addDownloads();
        const pollPromise = poll();
        await producer(addDownload);
        producerDone = true;
        await pollPromise;
      } catch (err) {
        cleanup(() => settleReject(err));
      }
    })();
  });
}
