import type { GalleryDlConfig } from '../types';

export interface CommandBuildInput {
  url: string;
  config: GalleryDlConfig;
  pageRange?: string;
  chapterOverride?: number;
  seriesOverride?: string;
  extraArgs?: string;
}

export function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function expandPathTemplate(
  template: string,
  tokens: {
    category: string;
    manga: string;
    chapter: number;
    num: number;
    extension: string;
  }
): string {
  const safeCategory = sanitizeSegment(tokens.category || 'web');
  const safeManga = sanitizeSegment(tokens.manga || 'Untitled Manga');
  const safeExt = sanitizeSegment(tokens.extension || 'jpg').replace(/^\.+/, '');

  return template
    .replace(/\{category\}/g, safeCategory)
    .replace(/\{manga\}/g, safeManga)
    .replace(/\{chapter(?::0(\d+)d)?\}/g, (_match, padStr) => {
      const width = padStr ? Math.min(Math.max(Number(padStr), 1), 6) : 1;
      return String(Math.max(0, Math.floor(tokens.chapter))).padStart(width, '0');
    })
    .replace(/\{num(?::0(\d+)d)?\}/g, (_match, padStr) => {
      const width = padStr ? Math.min(Math.max(Number(padStr), 1), 6) : 3;
      return String(Math.max(1, Math.floor(tokens.num))).padStart(width, '0');
    })
    .replace(/\{extension\}/g, safeExt);
}

export function sanitizeSegment(raw: string): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'untitled';
}

export function detectExtractorFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('mangadex.org')) return 'mangadex';
    if (host.includes('reddit.com') || host.includes('redd.it')) return 'reddit';
    if (host.includes('danbooru')) return 'danbooru';
    if (host.includes('pixiv.net')) return 'pixiv';
    if (host.includes('imgur.com')) return 'imgur';
    if (host.includes('archive.org')) return 'archive';
    if (host.includes('wikimedia.org') || host.includes('wikipedia.org')) return 'wikimedia';
    if (parsed.pathname.startsWith('/api/sample-feed/')) return 'komadl-feed';
    if (/\.(jpe?g|png|webp|gif|svg|avif)$/i.test(parsed.pathname)) return 'direct-image';
    return host.split('.')[0] || 'generic-html';
  } catch {
    return 'generic-html';
  }
}

export function buildGalleryDlCommand(input: CommandBuildInput): string {
  const parts: string[] = ['gallery-dl'];
  parts.push('-d', shellQuote(input.config.baseDirectory || './downloads'));

  if (input.config.directoryTemplate && input.config.filenameTemplate) {
    parts.push('-f', shellQuote(input.config.filenameTemplate));
  }
  if (input.pageRange && input.pageRange.trim()) {
    parts.push('--range', shellQuote(input.pageRange.trim()));
  }
  if (input.config.sleepRequest > 0) {
    parts.push('--sleep-request', String(input.config.sleepRequest));
  }
  if (input.config.retries > 0 && input.config.retries !== 4) {
    parts.push('--retries', String(input.config.retries));
  }
  if (input.config.writeMetadata) {
    parts.push('--write-metadata');
  }
  if (input.config.ugoiraConvert) {
    parts.push('--ugoira-conv');
  }
  if (input.config.proxyUrl.trim()) {
    parts.push('--proxy', shellQuote(input.config.proxyUrl.trim()));
  }
  if (input.config.cookiesPath.trim()) {
    parts.push('--cookies', shellQuote(input.config.cookiesPath.trim()));
  }
  if (input.extraArgs && input.extraArgs.trim()) {
    parts.push(input.extraArgs.trim());
  }

  const urls = input.url
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    parts.push("'https://mangadex.org/chapter/...'");
  } else {
    for (const u of urls) {
      parts.push(shellQuote(u));
    }
  }

  return parts.join(' ');
}

export function buildGalleryDlConfigJson(config: GalleryDlConfig): string {
  const doc = {
    extractor: {
      'base-directory': config.baseDirectory || './downloads',
      directory: config.directoryTemplate.split('/').filter(Boolean),
      filename: config.filenameTemplate,
      retries: config.retries,
      'sleep-request': config.sleepRequest,
      'user-agent': config.userAgent,
      proxy: config.proxyUrl || null,
      cookies: config.cookiesPath || null,
      postprocessors: [
        ...(config.writeMetadata ? [{ name: 'metadata', mode: 'json' }] : []),
        ...(config.ugoiraConvert ? [{ name: 'ugoira', extension: 'webm' }] : []),
      ],
    },
  };
  return JSON.stringify(doc, null, 2);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32Bytes(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/*
 * Self-check against outside standard & invariant:
 * 1. Textbook IEEE 802.3 CRC-32 check value for ASCII "123456789" === 0xCBF43926 (3421780262).
 * 2. Invariant: expandPathTemplate('{category}/{manga}/c{chapter:03d}/{num:03d}.{extension}', ...)
 *    always zero-pads chapter and page indices and strips path-traversal slashes from segments.
 */
(() => {
  const asciiCheck = new TextEncoder().encode('123456789');
  const computedCrc = crc32Bytes(asciiCheck);
  if (computedCrc !== 0xcbf43926) {
    throw new Error(`CRC32 check failed: expected 0xCBF43926, got 0x${computedCrc.toString(16)}`);
  }
  const expanded = expandPathTemplate('{category}/{manga}/c{chapter:03d}/{num:03d}.{extension}', {
    category: 'mangadex',
    manga: 'Iron/Rail',
    chapter: 14,
    num: 2,
    extension: '.jpg',
  });
  if (expanded !== 'mangadex/Iron Rail/c014/002.jpg') {
    throw new Error(`Template invariant failed: ${expanded}`);
  }
})();
