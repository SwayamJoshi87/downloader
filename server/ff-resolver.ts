import { chromium, type Browser } from 'playwright';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

declare global {
  interface Window {
    dynamic?: string;
  }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export interface FuckingFastDirectLink {
  directUrl: string;
  filename: string;
}

function parseCookies(setCookieHeaders: string | string[] | undefined): string {
  if (!setCookieHeaders) return '';
  const raw = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return raw
    .map((h) => h.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function mergeCookies(existing: string, setCookieHeaders: string | string[] | undefined): string {
  const cookies = new Map<string, string>();
  for (const cookie of existing.split(';')) {
    const [name, ...value] = cookie.trim().split('=');
    if (name && value.length > 0) cookies.set(name, value.join('='));
  }
  for (const cookie of parseCookies(setCookieHeaders).split(';')) {
    const [name, ...value] = cookie.trim().split('=');
    if (name && value.length > 0) cookies.set(name, value.join('='));
  }
  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function parseHxPost(html: string): string | null {
  return html.match(/\bhx-post\s*=\s*["']([^"']+)["']/i)?.[1] || null;
}

function parseDynamicAdUrl(html: string): string | null {
  const raw = html.match(/\bwindow\.dynamic\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\\//g, '/');
  }
}

function parseTitleFilename(html: string): string | null {
  const metaTitle = html.match(/<meta\s+name=["']title["']\s+content=["']([^"']+)["']/i)?.[1];
  const title = metaTitle || html.match(/<title>([^<]+)<\/title>/i)?.[1];
  return title ? title.trim() : null;
}

function isBlockedUrl(value: string, blockedUrls: Set<string>): boolean {
  for (const blockedUrl of blockedUrls) {
    if (value === blockedUrl || value.startsWith(blockedUrl)) return true;
    try {
      const candidate = new URL(value);
      const blocked = new URL(blockedUrl);
      if (candidate.origin === blocked.origin && candidate.pathname === blocked.pathname) return true;
    } catch {
      // Keep checking the remaining blocked URLs.
    }
  }
  return false;
}

function isLikelyDirectDownloadUrl(value: string | undefined, blockedUrls = new Set<string>()): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return value.startsWith('http') && !isBlockedUrl(value, blockedUrls) && !url.pathname.endsWith('/go');
  } catch {
    return false;
  }
}

function isFuckingFastDownloadUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return /(^|\.)fuckingfast\.co$/i.test(url.hostname) && url.pathname.startsWith('/dl/');
  } catch {
    return false;
  }
}

async function launchResolverBrowser(): Promise<Browser> {
  const launchOptions = {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  };

  try {
    return await chromium.launch({ ...launchOptions, channel: 'msedge' });
  } catch (edgeErr) {
    throw new Error(`Microsoft Edge is required for FuckingFast link resolution. Edge launch failed: ${(edgeErr as Error).message}`);
  }
}

function request(
  url: string,
  options: https.RequestOptions & { body?: Buffer; followRedirects?: boolean },
  cookies: string,
  redirectCount = 0
): Promise<{ headers: http.IncomingHttpHeaders; statusCode?: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));

    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const follow = options.followRedirects !== false;

    const req = client.request(
      parsed,
      {
        method: options.method || 'GET',
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          Cookie: cookies,
          ...(options.headers || {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          if (
            follow &&
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const next = new URL(res.headers.location, url).toString();
            const newCookies = parseCookies(res.headers['set-cookie']);
            request(next, options, newCookies || cookies, redirectCount + 1).then(resolve, reject);
            return;
          }
          resolve({ headers: res.headers, statusCode: res.statusCode, body });
        });
      }
    );

    req.on('error', reject);
    if (options.body && options.body.length > 0) req.write(options.body);
    req.end();
  });
}

async function resolveDirectHttp(fastUrl: string): Promise<FuckingFastDirectLink | null> {
  try {
    const match = fastUrl.match(/fuckingfast\.co\/([a-zA-Z0-9]+)/);
    if (!match) return null;

    const fileId = match[1];
    const getRes = await request(fastUrl, { method: 'GET' }, '');
    if (String(getRes.statusCode).startsWith('5')) return null;
    const html = getRes.body.toString('utf-8');
    const hxPost = parseHxPost(html) || `/f/${fileId}/go`;
    const postUrl = new URL(hxPost, fastUrl).toString();
    const dynamicAdUrl = parseDynamicAdUrl(html);
    const blockedUrls = new Set([fastUrl, ...(dynamicAdUrl ? [dynamicAdUrl] : [])]);
    let cookies = parseCookies(getRes.headers['set-cookie']);

    const postHeaders: Record<string, string> = {
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      'HX-Request': 'true',
      'HX-Current-URL': fastUrl,
      'HX-Target': 'body',
      Origin: 'https://fuckingfast.co',
      Referer: fastUrl,
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      const postRes = await request(
        postUrl,
        { method: 'POST', body: Buffer.alloc(0), headers: postHeaders, followRedirects: false },
        cookies
      );
      cookies = mergeCookies(cookies, postRes.headers['set-cookie']);

      const hxRedirect =
        (postRes.headers['hx-redirect'] as string | undefined) ||
        (postRes.headers['HX-Redirect'] as string | undefined) ||
        (postRes.headers.location as string | undefined);

      if (isFuckingFastDownloadUrl(hxRedirect)) {
        const directUrl = new URL(hxRedirect, fastUrl).toString();
        const filename = fastUrl.split('#')[1] || parseTitleFilename(html) || directUrl.split('/').pop() || 'download';
        return { directUrl, filename: decodeURIComponent(filename) };
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function resolveViaBrowser(fastUrl: string): Promise<FuckingFastDirectLink> {
  const filename = fastUrl.split('#')[1] || 'download';
  let browser: Browser | null = null;

  try {
    try {
      browser = await launchResolverBrowser();
    } catch (launchErr) {
      console.error('[ff-resolver] Chromium launch failed:', launchErr);
      throw new Error(`Chromium launch failed: ${(launchErr as Error).message}`);
    }
    if (!browser) {
      throw new Error('Playwright failed to launch Chromium (browser is null)');
    }
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.open = () => null;
    });
    const page = await context.newPage();

    const seenUrls = new Set<string>();

    await page.goto(fastUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    const pageConfig = await page.evaluate(() => {
      const hxPost = document.querySelector('[hx-post*="/go"]')?.getAttribute('hx-post') || '';
      const dynamicAdUrl = typeof window.dynamic === 'string' ? window.dynamic : '';
      const title = document.querySelector('meta[name="title"]')?.getAttribute('content') || document.title || '';
      return { hxPost, dynamicAdUrl, title };
    });
    const postUrl = pageConfig.hxPost ? new URL(pageConfig.hxPost, fastUrl).toString() : '';
    const blockedUrls = new Set([fastUrl, ...(pageConfig.dynamicAdUrl ? [pageConfig.dynamicAdUrl] : [])]);
    if (pageConfig.dynamicAdUrl) {
      const adUrl = new URL(pageConfig.dynamicAdUrl);
      await context.route(
        (url) => url.hostname === adUrl.hostname || url.toString().startsWith(pageConfig.dynamicAdUrl),
        (route) => route.abort()
      );
    }
    await page.evaluate(() => {
      window.dynamic = '';
    });
    page.on('request', (request) => {
      const requestUrl = request.url();
      if (!requestUrl.startsWith('data:')) seenUrls.add(requestUrl);
    });

    // Primary: try the HTMX request directly. The site can require two attempts:
    // first "click" opens ads, second returns the real download.
    if (postUrl) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await page.evaluate(
          async ({ url, currentUrl }) => {
            try {
              const res = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: {
                  Accept: '*/*',
                  'HX-Request': 'true',
                  'HX-Current-URL': currentUrl,
                  'HX-Target': 'body',
                },
              });
              const hxRedirect = res.headers.get('hx-redirect') || res.headers.get('HX-Redirect');
              if (hxRedirect) return { directUrl: hxRedirect.trim() };
            } catch (e) {
              return { error: String(e) };
            }
            return null;
          },
          { url: postUrl, currentUrl: fastUrl }
        );
        if (isLikelyDirectDownloadUrl(result?.directUrl, blockedUrls)) {
          return { directUrl: result.directUrl, filename: decodeURIComponent(filename || pageConfig.title || 'download') };
        }
      }
    }

    const clickAndCapture = async (): Promise<string | null> => {
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
      const popupPromise = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);
      const goResponsePromise = postUrl
        ? page
            .waitForResponse(
              (response) => response.request().method() === 'POST' && response.url().startsWith(postUrl),
              { timeout: 15000 }
            )
            .catch(() => null)
        : Promise.resolve(null);
      const directRequestPromise = page
        .waitForRequest((request) => isLikelyDirectDownloadUrl(request.url(), blockedUrls), { timeout: 15000 })
        .catch(() => null);
      const navigationPromise = page
        .waitForURL((url) => isLikelyDirectDownloadUrl(url.toString(), blockedUrls), { timeout: 15000 })
        .catch(() => null);

      const clicked = await page.evaluate(() => {
        const btn =
          document.querySelector('a[hx-post*="/go"]') ||
          Array.from(document.querySelectorAll('a')).find(
            (a) => a.textContent?.trim().toUpperCase() === 'DOWNLOAD'
          );
        if (btn) {
          (btn as HTMLElement).click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        throw new Error('Could not find download button on fuckingfast.co page');
      }

      const goResponse = await goResponsePromise;
      const hxRedirect = goResponse?.headers()['hx-redirect'];
      if (isLikelyDirectDownloadUrl(hxRedirect, blockedUrls)) return hxRedirect;

      const download = await downloadPromise;
      if (download) {
        const directUrl = download.url();
        await download.cancel().catch(() => {});
        return directUrl;
      }

      const popup = await popupPromise;
      if (popup) {
        await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        const popupUrl = popup.url();
        if (isLikelyDirectDownloadUrl(popupUrl, blockedUrls)) return popupUrl;
      }

      await navigationPromise;
      const currentUrl = page.url();
      if (isLikelyDirectDownloadUrl(currentUrl, blockedUrls)) return currentUrl;

      const directRequest = await directRequestPromise;
      return directRequest?.url() || null;
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      const directUrl = await clickAndCapture();
      if (directUrl) {
        return { directUrl, filename: decodeURIComponent(filename || pageConfig.title || 'download') };
      }
    }

    const recentUrls = Array.from(seenUrls).slice(-10).join('\n');
    throw new Error(`Could not intercept fuckingfast.co download. Current URL: ${page.url()}. Recent requests:\n${recentUrls}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function resolveFuckingFastLink(fastUrl: string): Promise<FuckingFastDirectLink> {
  const direct = await resolveDirectHttp(fastUrl);
  if (direct) return direct;
  return resolveViaBrowser(fastUrl);
}
