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

const FUCKING_FAST_RE = /https?:\/\/fuckingfast\.co\/[^\s"'<>]+/gi;

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\s.]+$/, '')
    .slice(0, 255) || 'download';
}

export function getFileNameFromUrl(url: string): string {
  const hashIdx = url.indexOf('#');
  if (hashIdx !== -1) {
    const raw = url.slice(hashIdx + 1);
    try {
      return sanitizeFileName(decodeURIComponent(raw));
    } catch {
      return sanitizeFileName(raw);
    }
  }
  try {
    const path = new URL(url).pathname;
    const base = path.split('/').pop() || 'download';
    return sanitizeFileName(decodeURIComponent(base));
  } catch {
    return 'download';
  }
}

export function isOptionalFile(name: string): boolean {
  return /\boptional\b/i.test(name);
}

export function isSelectiveFile(name: string): boolean {
  return /\bselective\b/i.test(name);
}

export function matchesKeyword(name: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(name);
}

export function extractGameTitle(firstFileName: string): string {
  try {
    const cleaned = firstFileName
      .replace(/_--_fitgirl-repacks\.site_--_.*$/i, '')
      .replace(/_--_.*$/, '')
      .replace(/\.[^.]+$/, '')
      .replace(/_v?\d+(\.\d)*\s*$/i, '')
      .replace(/_part\d+.*$/i, '')
      .replace(/_\d+\s*$/, '')
      .trim();

    const title = cleaned
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!title) return 'FitGirl Download';
    return title.replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return 'FitGirl Download';
  }
}

export function extractLinks(plaintext: string): ParsedPaste {
  const matches = plaintext.match(FUCKING_FAST_RE) || [];
  const seen = new Set<string>();
  const items: PasteItem[] = [];

  for (const url of matches) {
    const normalized = url.split(/[\s"'<>]/)[0].trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const name = getFileNameFromUrl(normalized);
    items.push({
      url: normalized,
      name,
      isOptional: isOptionalFile(name),
      isSelective: isSelectiveFile(name),
    });
  }

  return {
    title: items.length > 0 ? extractGameTitle(items[0].name) : 'FitGirl Download',
    items,
  };
}
