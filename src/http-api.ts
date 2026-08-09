export interface PasteItem {
  url: string;
  name: string;
  isOptional: boolean;
  isSelective: boolean;
}

export interface ParsedPaste {
  title: string;
  items: PasteItem[];
}

export interface FileProgress {
  gid: string;
  filename: string;
  totalBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
}

export interface Aria2Progress {
  totalBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  files: FileProgress[];
}

type Aria2Event =
  | { type: 'progress'; data: Aria2Progress }
  | { type: 'resolving'; current: number; total: number; message: string; url?: string; filename?: string; status?: 'ok' | 'fail' }
  | { type: 'done' }
  | { type: 'error'; message: string };

interface ExtractorEvent {
  type: 'started' | 'progress' | 'done' | 'error';
  message?: string;
  current?: number;
  total?: number;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export const httpApi = {
  decryptPaste: (url: string): Promise<ParsedPaste> => post('/api/decrypt', { url }),

  listFolder: async (folderPath: string): Promise<{ path: string; entries: { name: string; isDirectory: boolean }[] }> => {
    return post('/api/list-folder', { path: folderPath });
  },

  getDrives: async (): Promise<{ drives: string[] }> => {
    return post('/api/drives', {});
  },

  openFolder: async (folderPath: string): Promise<void> => {
    // In server mode, open folder via simple explorer command.
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath }),
    });
  },

  openHelp: async (): Promise<void> => {
    await fetch('/api/help', { method: 'POST' });
  },

  startDownload: (params: {
    items: PasteItem[];
    downloadFolder: string;
    outputFolder: string;
  }): Promise<void> => post('/api/start', params),

  cancelDownload: (): Promise<void> => post('/api/cancel', {}),

  onDownloadEvent: (callback: (event: Aria2Event) => void): (() => void) => {
    return onServerEvent('download', callback);
  },

  onExtractEvent: (callback: (event: ExtractorEvent) => void): (() => void) => {
    return onServerEvent('extract', callback);
  },
};

function onServerEvent<T>(eventName: string, callback: (event: T) => void): () => void {
  const es = new EventSource('/api/events');
  const handler = (e: MessageEvent) => {
    try {
      callback(JSON.parse(e.data) as T);
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  };
  es.addEventListener(eventName, handler);
  es.onerror = (err) => console.error('SSE error:', err);
  return () => {
    es.removeEventListener(eventName, handler);
    es.close();
  };
}
