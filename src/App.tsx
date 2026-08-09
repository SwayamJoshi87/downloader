import { useEffect, useMemo, useState } from 'react';
import { httpApi, type ParsedPaste, type FileProgress, type Aria2Progress } from './http-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  FolderOpen,
  FolderInput,
  Download,
  Check,
  X,
  AlertCircle,
  Loader2,
  Moon,
  Sun,
  HelpCircle,
  Clock,
  Wifi,
  CheckCircle2,
  UserCheck,
} from 'lucide-react';

interface ResolveEntry {
  filename: string;
  status: 'pending' | 'processing' | 'ok' | 'fail';
  message: string;
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || isNaN(bytes)) return '-';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(2)} ${units[unit]}`;
}

function formatSpeed(bytesPerSec: number | undefined): string {
  if (bytesPerSec === undefined || isNaN(bytesPerSec)) return '-';
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !isFinite(seconds) || seconds <= 0) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function statusLabel(status: FileProgress['status']): string {
  switch (status) {
    case 'active': return 'Downloading';
    case 'waiting': return 'Waiting';
    case 'paused': return 'Paused';
    case 'error': return 'Error';
    case 'complete': return 'Complete';
    case 'removed': return 'Removed';
    default: return status;
  }
}

function matchesKeyword(name: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(name);
}

export default function App() {
  const [url, setUrl] = useState('');
  const [downloadFolder, setDownloadFolder] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [parsed, setParsed] = useState<ParsedPaste | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'resolving' | 'downloading' | 'extracting' | 'done'>('idle');
  const [progress, setProgress] = useState<Aria2Progress | null>(null);
  const [resolving, setResolving] = useState<{ current: number; total: number; message: string } | null>(null);
  const [resolveEntries, setResolveEntries] = useState<Map<string, ResolveEntry>>(new Map());
  const [extractMessage, setExtractMessage] = useState<string>('');
  const [extractProgress, setExtractProgress] = useState<{ current: number; total: number } | null>(null);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('fitgirl-dark-mode') !== 'false';
  });
  const [folderBrowser, setFolderBrowser] = useState<{
    open: boolean;
    setter: (path: string) => void;
    currentPath: string;
    entries: { name: string; isDirectory: boolean }[];
    drives: string[];
  }>({ open: false, setter: () => {}, currentPath: '', entries: [], drives: [] });

  const api = httpApi;

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('fitgirl-dark-mode', String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    const unsubDownload = api.onDownloadEvent((event) => {
      if (event.type === 'progress') {
        setProgress(event.data);
        setPhase('downloading');
      } else if (event.type === 'resolving') {
        setPhase((prev) =>
          prev === 'downloading' || prev === 'extracting' || prev === 'done' ? prev : 'resolving'
        );
        setResolving({ current: event.current, total: event.total, message: event.message });

        // Track per-link resolution status
        if (event.url) {
          setResolveEntries((prev) => {
            const next = new Map(prev);
            next.set(event.url!, {
              filename: event.filename || '',
              status: event.status === undefined ? 'processing' : (event.status || 'ok'),
              message: event.message,
            });
            return next;
          });
        }
      } else if (event.type === 'done') {
        setPhase('extracting');
      } else if (event.type === 'error') {
        setError(event.message);
        setPhase('idle');
      }
    });

    const unsubExtract = api.onExtractEvent((event) => {
      if (event.type === 'started') {
        setExtractMessage(event.message || 'Starting extraction...');
        if (event.current !== undefined && event.total !== undefined) {
          setExtractProgress({ current: event.current, total: event.total });
        }
      } else if (event.type === 'progress') {
        setExtractMessage(event.message || '');
        if (event.current !== undefined && event.total !== undefined) {
          setExtractProgress({ current: event.current, total: event.total });
        }
      } else if (event.type === 'done') {
        setPhase('done');
      } else if (event.type === 'error') {
        setExtractMessage((prev) => `${prev}\n${event.message}`);
      }
    });

    return () => {
      unsubDownload();
      unsubExtract();
    };
  }, [api]);

  const handleDecrypt = async () => {
    setLoading(true);
    setError(null);
    setParsed(null);
    try {
      const result = await api.decryptPaste(url);
      setParsed(result);
      const defaults = new Set(
        result.items.filter((i) => !i.isOptional && !i.isSelective).map((i) => i.url)
      );
      setSelected(defaults);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = (itemUrl: string) => {
    const next = new Set(selected);
    if (next.has(itemUrl)) next.delete(itemUrl);
    else next.add(itemUrl);
    setSelected(next);
  };

  const selectAll = () => setSelected(new Set(parsed?.items.map((i) => i.url) || []));
  const deselectAll = () => setSelected(new Set());
  const selectByKeyword = (keyword: string) => {
    const next = new Set(selected);
    parsed?.items.forEach((item) => {
      if (matchesKeyword(item.name, keyword)) next.add(item.url);
    });
    setSelected(next);
  };

  const selectedItems = useMemo(
    () => parsed?.items.filter((i) => selected.has(i.url)) || [],
    [parsed, selected]
  );

  const resolveStats = useMemo(() => {
    let ok = 0;
    let fail = 0;
    let processing = 0;
    resolveEntries.forEach((entry) => {
      if (entry.status === 'ok') ok++;
      else if (entry.status === 'fail') fail++;
      else if (entry.status === 'processing') processing++;
    });
    const total = resolving?.total || selectedItems.length;
    return { ok, fail, processing, total, done: ok + fail };
  }, [resolveEntries, resolving, selectedItems.length]);

  // The resolve queue keeps running in the background while aria2 downloads already-resolved
  // links, so this card must stay visible independently of the download card's own phase.
  const showResolveCard = phase !== 'idle' && (resolving !== null || resolveEntries.size > 0);
  const resolveComplete = resolveStats.total > 0 && resolveStats.done >= resolveStats.total;
  const showDownloadCard = progress !== null || phase === 'extracting' || phase === 'done';

  const handleStart = async () => {
    if (!parsed || selectedItems.length === 0 || !downloadFolder || !outputFolder) return;
    setPhase('submitting');
    setResolving(null);
    setResolveEntries(new Map());
    setProgress(null);
    setExtractMessage('');
    setExtractProgress(null);
    setError(null);
    try {
      await api.startDownload({
        items: selectedItems,
        downloadFolder,
        outputFolder,
      });
    } catch (err) {
      setError((err as Error).message);
      setPhase('idle');
    }
  };

  const chooseFolder = async (setter: (path: string) => void, currentPath: string) => {
    try {
      setError(null);
      await openFolderBrowser(setter, currentPath);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const openFolderBrowser = async (setter: (path: string) => void, initialPath: string) => {
    try {
      setError(null);
      const startPath = initialPath || 'C:\\';
      const [data, drivesData] = await Promise.all([api.listFolder(startPath), api.getDrives()]);
      setFolderBrowser({ open: true, setter, currentPath: data.path, entries: data.entries, drives: drivesData.drives });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const navigateFolderBrowser = async (name: string) => {
    let nextPath: string;
    if (/^[A-Za-z]:[\\/]/.test(name)) {
      nextPath = name.endsWith('\\') || name.endsWith('/') ? name : name + '\\';
    } else if (/^[A-Za-z]:$/.test(name)) {
      nextPath = name + '\\';
    } else {
      const separator = folderBrowser.currentPath.includes('\\') ? '\\' : '/';
      nextPath = name === '..' ? folderBrowser.currentPath + separator + '..' : folderBrowser.currentPath + separator + name;
    }
    try {
      const data = await api.listFolder(nextPath);
      setFolderBrowser((prev) => ({ ...prev, currentPath: data.path, entries: data.entries, drives: prev.drives }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const selectFolderBrowser = () => {
    folderBrowser.setter(folderBrowser.currentPath);
    setFolderBrowser((prev) => ({ ...prev, open: false }));
  };

  const openHelp = async () => {
    try {
      await api.openHelp();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">FitGirl Downloader</h1>
            <p className="text-muted-foreground">Decrypt pastes, resolve links through the ff-resolver queue (human-verified), download with aria2c, auto-extract.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setDarkMode((v) => !v)} title="Toggle dark mode">
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" onClick={openHelp} title="Open help">
              <HelpCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Paste URL</CardTitle>
            <CardDescription>Paste the FitGirl/PrivateBin link here.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="https://paste.fitgirl-repacks.site/?...#..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDecrypt()}
              />
              <Button onClick={handleDecrypt} disabled={loading || !url}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Decrypt'}
              </Button>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Folders</CardTitle>
            <CardDescription>Choose where to download and where to extract.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Download folder</Label>
                <div className="flex gap-2">
                  <Input readOnly value={downloadFolder} placeholder="Select download folder" />
                  <Button variant="outline" onClick={() => chooseFolder(setDownloadFolder, downloadFolder)}>
                    <FolderInput className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Output/Extract folder</Label>
                <div className="flex gap-2">
                  <Input readOnly value={outputFolder} placeholder="Select output folder" />
                  <Button variant="outline" onClick={() => chooseFolder(setOutputFolder, outputFolder)}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {parsed && (
          <Card>
            <CardHeader>
              <CardTitle>{parsed.title}</CardTitle>
              <CardDescription>
                {parsed.items.length} file(s) found. Optional and selective files are unchecked by default.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>Select All</Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>Deselect All</Button>
                <Button variant="outline" size="sm" onClick={() => selectByKeyword('4K')}>Check All 4K</Button>
                <Button variant="outline" size="sm" onClick={() => selectByKeyword('selective')}>Check All Selective</Button>
                <Button variant="outline" size="sm" onClick={() => selectByKeyword('optional')}>Check All Optional</Button>
                <div className="flex-1" />
                <Button
                  onClick={handleStart}
                  disabled={phase === 'downloading' || phase === 'extracting' || selectedItems.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download {selectedItems.length} file(s)
                </Button>
              </div>

              <ScrollArea className="h-[400px] rounded-md border">
                <div className="space-y-1 p-2">
                  {parsed.items.map((item) => (
                    <label
                      key={item.url}
                      className="flex items-start gap-3 rounded-md p-2 hover:bg-muted cursor-pointer"
                    >
                      <Checkbox
                        checked={selected.has(item.url)}
                        onCheckedChange={() => toggleItem(item.url)}
                      />
                      <div className="flex-1 text-sm">
                        <div className="font-medium">{item.name}</div>
                        <div className="flex gap-2 mt-1">
                          {item.isOptional && (
                            <span className="text-xs text-muted-foreground">Optional</span>
                          )}
                          {item.isSelective && (
                            <span className="text-xs text-muted-foreground">Selective</span>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* ── Resolve queue (runs on the ff-resolver server; stays visible even after
             downloads start, since resolving and downloading are pipelined in parallel) ── */}
        {showResolveCard && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {phase === 'submitting' ? (
                  <Wifi className="h-5 w-5" />
                ) : resolveComplete ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <UserCheck className="h-5 w-5" />
                )}
                {phase === 'submitting'
                  ? 'Submitting to ff-resolver...'
                  : resolveComplete
                  ? `Resolved ${resolveStats.ok}/${resolveStats.total} link(s)${resolveStats.fail > 0 ? ` (${resolveStats.fail} failed)` : ''}`
                  : 'Resolving links'}
              </CardTitle>
              <CardDescription>
                {phase === 'submitting'
                  ? 'Sending batch to the ff-resolver service on your homelab.'
                  : resolveComplete
                  ? 'All links have gone through the resolve queue. Any files that failed to resolve were skipped.'
                  : `Queued on the resolver server — a human manually clears each Cloudflare challenge, so this can take a moment per link. ${resolveStats.done}/${resolveStats.total} done so far. Already-resolved files start downloading immediately below, in parallel with the rest of this queue.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {resolving && !resolveComplete && (
                <div className="space-y-2">
                  <Progress value={(resolveStats.done / resolveStats.total) * 100} />
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{resolving.message}</span>
                  </div>
                </div>
              )}

              {/* Per-link status list */}
              {selectedItems.length > 0 && (
                <ScrollArea className="h-[250px] rounded-md border">
                  <div className="space-y-0.5 p-2">
                    {selectedItems.map((item) => {
                      const entry = resolveEntries.get(item.url);
                      const status = entry?.status || 'pending';
                      return (
                        <div
                          key={item.url}
                          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm"
                        >
                          {status === 'ok' ? (
                            <Check className="h-4 w-4 text-green-500 shrink-0" />
                          ) : status === 'fail' ? (
                            <X className="h-4 w-4 text-red-500 shrink-0" />
                          ) : status === 'processing' ? (
                            <Loader2 className="h-4 w-4 text-blue-400 shrink-0 animate-spin" />
                          ) : (
                            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="flex-1 truncate">{item.name}</span>
                          <span className={`text-xs shrink-0 ${
                            status === 'ok' ? 'text-green-500' :
                            status === 'fail' ? 'text-red-500' :
                            status === 'processing' ? 'text-blue-400' :
                            'text-muted-foreground'
                          }`}>
                            {status === 'ok' ? 'Resolved' :
                             status === 'fail' ? 'Failed' :
                             status === 'processing' ? 'Awaiting manual verification…' :
                             'Queued'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Downloads / Extract / Done — separate card, can be visible at the same time as
             the resolve queue above since aria2 starts on each link as soon as it resolves ── */}
        {showDownloadCard && (
          <Card>
            <CardHeader>
              <CardTitle>
                {phase === 'extracting' && 'Extracting...'}
                {phase === 'done' && 'Complete'}
                {phase !== 'extracting' && phase !== 'done' && 'Downloads'}
              </CardTitle>
              {!resolveComplete && phase !== 'extracting' && phase !== 'done' && (
                <CardDescription>
                  Downloading files as they come out of the resolve queue above.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              {progress && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Overall</span>
                      <span className="text-muted-foreground">
                        {formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)} (
                        {progress.totalBytes > 0
                          ? ((progress.downloadedBytes / progress.totalBytes) * 100).toFixed(1)
                          : 0}
                        %)
                      </span>
                    </div>
                    <Progress value={progress.totalBytes > 0 ? (progress.downloadedBytes / progress.totalBytes) * 100 : 0} />
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{formatSpeed(progress.speedBytesPerSec)}</span>
                      <span>
                        ETA{' '}
                        {formatEta(
                          progress.speedBytesPerSec > 0
                            ? (progress.totalBytes - progress.downloadedBytes) / progress.speedBytesPerSec
                            : Infinity
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-sm font-medium">Individual files</h4>
                    <ScrollArea className="h-[300px] rounded-md border">
                      <div className="space-y-3 p-3">
                        {progress.files.map((file) => {
                          const pct = file.totalBytes > 0 ? (file.downloadedBytes / file.totalBytes) * 100 : 0;
                          return (
                            <div key={file.gid} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="truncate pr-2 font-medium" title={file.filename}>
                                  {file.filename}
                                </span>
                                <span className="shrink-0 text-muted-foreground">
                                  {statusLabel(file.status)} • {formatBytes(file.downloadedBytes)} /{' '}
                                  {formatBytes(file.totalBytes)}
                                </span>
                              </div>
                              <Progress value={pct} />
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                </>
              )}

              {extractMessage && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Extraction progress</h4>
                  {extractProgress && (
                    <Progress
                      value={
                        extractProgress.total > 0
                          ? (extractProgress.current / extractProgress.total) * 100
                          : 0
                      }
                    />
                  )}
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {extractMessage}
                  </p>
                </div>
              )}

              {phase === 'done' && (
                <div className="flex items-center gap-2 text-green-500">
                  <Check className="h-5 w-5" />
                  <span className="font-medium">All downloads and extraction complete.</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Folder browser modal ── */}
        {folderBrowser.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg space-y-4">
              <h3 className="text-lg font-semibold">Select Folder</h3>
              <div className="flex gap-2">
                <select
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) navigateFolderBrowser(e.target.value);
                  }}
                >
                  <option value="">Change drive...</option>
                  {folderBrowser.drives.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-sm text-muted-foreground break-all">{folderBrowser.currentPath}</div>
              <ScrollArea className="h-[300px] rounded-md border">
                <div className="space-y-0.5 p-2">
                  {(() => {
                    const parent = folderBrowser.currentPath
                      .replace(/[\\/]+$/, '')
                      .replace(/[\\/][^\\/]+$/, '');
                    if (parent && parent !== folderBrowser.currentPath) {
                      return (
                        <button
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                          onClick={() => navigateFolderBrowser('..')}
                        >
                          <FolderOpen className="h-4 w-4" />
                          ..
                        </button>
                      );
                    }
                    return null;
                  })()}
                  {folderBrowser.entries.map((entry) =>
                    entry.isDirectory ? (
                      <button
                        key={entry.name}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                        onClick={() => navigateFolderBrowser(entry.name)}
                      >
                        <FolderOpen className="h-4 w-4" />
                        {entry.name}
                      </button>
                    ) : null
                  )}
                </div>
              </ScrollArea>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setFolderBrowser((prev) => ({ ...prev, open: false }))}>
                  Cancel
                </Button>
                <Button onClick={selectFolderBrowser}>Select</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
