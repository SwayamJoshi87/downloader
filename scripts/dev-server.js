import { spawn } from 'node:child_process';
import http from 'node:http';

const VITE_PORT = 5173;
const VITE_URL = `http://localhost:${VITE_PORT}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        http
          .get(url, (res) => {
            if (res.statusCode === 200) resolve();
            else reject(new Error(`status ${res.statusCode}`));
          })
          .on('error', reject);
      });
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Server did not respond at ${url} in time`);
}

function waitForApiUrl(proc, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const cleanup = () => {
      proc.stdout?.off('data', onData);
      proc.off('close', onClose);
      proc.off('error', onError);
    };

    const onData = (data) => {
      const chunk = data.toString();
      process.stdout.write(chunk);
      buffer += chunk;
      const match = buffer.match(/FitGirl Downloader web UI running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        cleanup();
        resolve(match[1]);
      }
    };

    const onClose = (code) => {
      cleanup();
      reject(new Error(`API server exited with code ${code}`));
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    proc.stdout?.on('data', onData);
    proc.on('close', onClose);
    proc.on('error', onError);

    setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for API server URL'));
    }, timeoutMs);
  });
}

function run(command, options = {}) {
  return spawn(command, {
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, NODE_ENV: 'development' },
    ...options,
  });
}

async function main() {
  const api = run('npx tsx server/index.ts', {
    env: { ...process.env, NODE_ENV: 'development', NO_OPEN_BROWSER: '1' },
  });

  api.stderr?.on('data', (data) => process.stderr.write(data));

  try {
    const apiUrl = await waitForApiUrl(api);
    console.log(`[dev] API server ready at ${apiUrl}`);

    const vite = run(`npx vite --port ${VITE_PORT} --strictPort`, {
      env: { ...process.env, NODE_ENV: 'development', API_SERVER_URL: apiUrl },
    });

    vite.stdout?.on('data', (data) => process.stdout.write(data));
    vite.stderr?.on('data', (data) => process.stderr.write(data));

    vite.on('close', (code) => {
      console.log(`[dev] Vite exited with code ${code}`);
      api.kill();
      process.exit(code ?? 0);
    });

    process.on('SIGINT', () => {
      api.kill();
      vite.kill();
    });

    await probeUrl(`${VITE_URL}/api/events`);
    console.log(`[dev] Vite ready at ${VITE_URL}`);

    const command =
      process.platform === 'win32'
        ? `start "" "${VITE_URL}"`
        : process.platform === 'darwin'
        ? `open "${VITE_URL}"`
        : `xdg-open "${VITE_URL}"`;
    spawn(command, { shell: true, detached: true, stdio: 'ignore' });
  } catch (err) {
    console.error('[dev]', err.message);
    api.kill();
    process.exit(1);
  }
}

main();
