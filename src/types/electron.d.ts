interface PasteItem {
  url: string;
  name: string;
  isOptional: boolean;
  isSelective: boolean;
}

interface ParsedPaste {
  title: string;
  items: PasteItem[];
}

interface FileProgress {
  gid: string;
  filename: string;
  totalBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
}

interface Aria2Progress {
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

interface ElectronAPI {
  decryptPaste: (url: string) => Promise<ParsedPaste>;
  chooseFolder: (defaultPath?: string) => Promise<string | null>;
  openFolder: (path: string) => Promise<void>;
  openHelp: () => Promise<void>;
  startDownload: (params: {
    items: PasteItem[];
    downloadFolder: string;
    outputFolder: string;
  }) => Promise<void>;
  cancelDownload: () => Promise<void>;
  onDownloadEvent: (callback: (event: Aria2Event) => void) => () => void;
  onExtractEvent: (callback: (event: ExtractorEvent) => void) => () => void;
}

declare global {
  interface Window {
    api?: ElectronAPI;
  }
}

export {};
