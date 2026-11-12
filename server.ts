import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type {
  DownloadJob,
  EngineInfo,
  GalleryDlConfig,
  MangaChapter,
  MangaPage,
  MangaSeries,
  SampleFeedPreset,
} from './src/types.ts';
import {
  buildGalleryDlCommand,
  buildGalleryDlConfigJson,
  detectExtractorFromUrl,
  sanitizeSegment,
} from './src/utils/galleryDl.ts';
import { renderMangaPlateSvg, type PlateSpec } from './server/mangaPlates.ts';
import { createCbzBuffer } from './server/cbzBuilder.ts';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DOWNLOADS_ROOT = path.resolve(__dirname, 'downloads');
const INDEX_FILE = path.join(DOWNLOADS_ROOT, '.komadl-index.json');
const CONFIG_FILE = path.join(DOWNLOADS_ROOT, 'gallery-dl.conf');

interface PersistedState {
  seriesMeta: Record<
    string,
    {
      id: string;
      title: string;
      author: string;
      extractor: string;
      tags: string[];
      coverChapterId?: string;
    }
  >;
  chapters: MangaChapter[];
  jobs: DownloadJob[];
  config: GalleryDlConfig;
}

const DEFAULT_CONFIG: GalleryDlConfig = {
  baseDirectory: './downloads',
  directoryTemplate: '{category}/{manga}/c{chapter:03d}',
  filenameTemplate: '{num:03d}.{extension}',
  sleepRequest: 0.5,
  retries: 4,
  writeMetadata: true,
  ugoiraConvert: true,
  userAgent: 'gallery-dl/1.28.0 (KomaDL/1.0)',
  proxyUrl: '',
  cookiesPath: '',
};

function getSafeUserAgent(targetUrl: string, configuredUa: string): string {
  const ua = (configuredUa || DEFAULT_CONFIG.userAgent).trim();
  if (/mangadex\.org|uploads\.mangadex\.org/i.test(targetUrl) && /^Mozilla\//i.test(ua)) {
    return 'gallery-dl/1.28.0 (KomaDL/1.0)';
  }
  return ua || 'gallery-dl/1.28.0 (KomaDL/1.0)';
}

const SAMPLE_PRESETS: SampleFeedPreset[] = [
  {
    id: 'iron-rail-c015',
    label: 'Iron Rail Nocturne · Ch. 15',
    seriesTitle: 'Iron Rail Nocturne',
    chapterNumber: 15,
    chapterTitle: 'Switchyard Lanterns at 04:10',
    extractor: 'mangadex',
    url: `http://127.0.0.1:${PORT}/api/sample-feed/iron-rail-c015`,
    pageCount: 4,
    description: '4 high-contrast ink plates including a wide double-page viaduct spread.',
  },
  {
    id: 'glass-conservatory-c009',
    label: 'The Glass Conservatory · Ch. 09',
    seriesTitle: 'The Glass Conservatory',
    chapterNumber: 9,
    chapterTitle: 'Spore Ledger under West Dome',
    extractor: 'mangadex',
    url: `http://127.0.0.1:${PORT}/api/sample-feed/glass-conservatory-c009`,
    pageCount: 4,
    description: '4 botanical ink plates with wrought-iron canopy spread.',
  },
  {
    id: 'tidal-cartographer-c023',
    label: 'Tidal Cartographer · Ch. 23',
    seriesTitle: 'Tidal Cartographer',
    chapterNumber: 23,
    chapterTitle: 'Sounding Line at Low Spring',
    extractor: 'danbooru',
    url: `http://127.0.0.1:${PORT}/api/sample-feed/tidal-cartographer-c023`,
    pageCount: 4,
    description: '4 nautical pen-and-ink plates with wide archipelago chart.',
  },
];

let resolvedGalleryDlBin: string | null = null;
let resolvedPythonBin: string | null = null;
let cachedGalleryDlVersion: string | null = null;
let cachedPythonVersion: string | null = null;
let binaryChecked = false;

async function detectBinaries(): Promise<void> {
  if (binaryChecked && resolvedGalleryDlBin) return;
  binaryChecked = true;

  const userProfile = process.env.USERPROFILE || '';
  const candidateBins = [
    process.env.GALLERY_DL_BIN,
    path.resolve(__dirname, '..', 'Py_project', '.venv', 'Scripts', 'gallery-dl.exe'),
    path.resolve(userProfile, 'OneDrive', 'Desktop', 'Nikhil', 'Py_project', '.venv', 'Scripts', 'gallery-dl.exe'),
    path.resolve(__dirname, '.venv', 'Scripts', 'gallery-dl.exe'),
    'gallery-dl',
    'gallery-dl.exe',
  ].filter(Boolean) as string[];

  for (const bin of candidateBins) {
    try {
      if ((bin.includes('/') || bin.includes('\\')) && !fs.existsSync(bin)) continue;
      const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 3000 });
      if (stdout.trim()) {
        resolvedGalleryDlBin = bin;
        cachedGalleryDlVersion = stdout.trim();
        break;
      }
    } catch {
      // try next
    }
  }

  const candidatePy = [
    process.env.PYTHON_BIN,
    path.resolve(__dirname, '..', 'Py_project', '.venv', 'Scripts', 'python.exe'),
    path.resolve(userProfile, 'OneDrive', 'Desktop', 'Nikhil', 'Py_project', '.venv', 'Scripts', 'python.exe'),
    path.resolve(__dirname, '.venv', 'Scripts', 'python.exe'),
    'python',
    'python3',
    'python.exe',
  ].filter(Boolean) as string[];

  for (const bin of candidatePy) {
    try {
      if ((bin.includes('/') || bin.includes('\\')) && !fs.existsSync(bin)) continue;
      const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 3000 });
      if (stdout.trim()) {
        resolvedPythonBin = bin;
        cachedPythonVersion = stdout.trim();
        break;
      }
    } catch {
      // try next
    }
  }
}

function ensureDownloadsDir(): void {
  if (!fs.existsSync(DOWNLOADS_ROOT)) {
    fs.mkdirSync(DOWNLOADS_ROOT, { recursive: true });
  }
}

function slugifyId(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

function writeConfigDisk(config: GalleryDlConfig): void {
  ensureDownloadsDir();
  fs.writeFileSync(CONFIG_FILE, buildGalleryDlConfigJson(config), 'utf8');
}

function saveState(state: PersistedState): void {
  ensureDownloadsDir();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function copyAssetOrFallback(
  assetRelPath: string,
  destFullPath: string,
  fallbackSpec: PlateSpec
): { bytes: number; isSpread: boolean } {
  const srcPath = path.resolve(__dirname, assetRelPath);
  fs.mkdirSync(path.dirname(destFullPath), { recursive: true });
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destFullPath);
    const stat = fs.statSync(destFullPath);
    return { bytes: stat.size, isSpread: fallbackSpec.aspect === 'spread' };
  }
  const svgPath = destFullPath.replace(/\.[a-z]+$/i, '.svg');
  const svgContent = renderMangaPlateSvg(fallbackSpec);
  fs.writeFileSync(svgPath, svgContent, 'utf8');
  return { bytes: Buffer.byteLength(svgContent, 'utf8'), isSpread: fallbackSpec.aspect === 'spread' };
}

function writeSvgPlate(destFullPath: string, spec: PlateSpec): { bytes: number; isSpread: boolean } {
  fs.mkdirSync(path.dirname(destFullPath), { recursive: true });
  const svg = renderMangaPlateSvg(spec);
  fs.writeFileSync(destFullPath, svg, 'utf8');
  return { bytes: Buffer.byteLength(svg, 'utf8'), isSpread: spec.aspect === 'spread' };
}

function buildSeededState(): PersistedState {
  ensureDownloadsDir();

  // 1. Iron Rail Nocturne — Chapter 14 (5 pages: 3 generated raster ink plates + 2 sequential SVG plates)
  const ironDirRel = 'mangadex/Iron Rail Nocturne/c014';
  const ironDirAbs = path.join(DOWNLOADS_ROOT, ironDirRel);
  fs.mkdirSync(ironDirAbs, { recursive: true });

  const p1 = copyAssetOrFallback(
    'src/assets/images/iron_rail_cover_1794494012554.jpg',
    path.join(ironDirAbs, '001.jpg'),
    { id: 'ir14-1', aspect: 'portrait', motif: 'railway-signal', sealKanji: '夜', pageNumber: 1 }
  );
  const p2 = copyAssetOrFallback(
    'src/assets/images/iron_rail_spread_1794494015538.jpg',
    path.join(ironDirAbs, '002.jpg'),
    { id: 'ir14-2', aspect: 'spread', motif: 'bridge-crossing', sealKanji: '鉄', pageNumber: 2 }
  );
  const p3 = copyAssetOrFallback(
    'src/assets/images/iron_rail_panels_1794494016621.jpg',
    path.join(ironDirAbs, '003.jpg'),
    { id: 'ir14-3', aspect: 'portrait', motif: 'night-cab', sealKanji: '汽', pageNumber: 3 }
  );
  const p4 = writeSvgPlate(path.join(ironDirAbs, '004.svg'), {
    id: 'ir14-4',
    aspect: 'portrait',
    motif: 'railway-signal',
    sealKanji: '燈',
    pageNumber: 4,
  });
  const p5 = writeSvgPlate(path.join(ironDirAbs, '005.svg'), {
    id: 'ir14-5',
    aspect: 'spread',
    motif: 'tunnel-dawn',
    sealKanji: '暁',
    pageNumber: 5,
  });

  const ironPages: MangaPage[] = [
    { index: 1, filename: '001.jpg', url: `/downloads/${encodeURI(ironDirRel)}/001.jpg`, bytes: p1.bytes, isSpread: false },
    { index: 2, filename: '002.jpg', url: `/downloads/${encodeURI(ironDirRel)}/002.jpg`, bytes: p2.bytes, isSpread: true },
    { index: 3, filename: '003.jpg', url: `/downloads/${encodeURI(ironDirRel)}/003.jpg`, bytes: p3.bytes, isSpread: false },
    { index: 4, filename: '004.svg', url: `/downloads/${encodeURI(ironDirRel)}/004.svg`, bytes: p4.bytes, isSpread: false },
    { index: 5, filename: '005.svg', url: `/downloads/${encodeURI(ironDirRel)}/005.svg`, bytes: p5.bytes, isSpread: true },
  ];
  fs.writeFileSync(
    path.join(ironDirAbs, 'metadata.json'),
    JSON.stringify({ category: 'mangadex', manga: 'Iron Rail Nocturne', chapter: 14, count: 5 }, null, 2)
  );

  // 2. The Glass Conservatory — Chapter 8
  const glassDirRel = 'mangadex/The Glass Conservatory/c008';
  const glassDirAbs = path.join(DOWNLOADS_ROOT, glassDirRel);
  fs.mkdirSync(glassDirAbs, { recursive: true });

  const g1 = copyAssetOrFallback(
    'src/assets/images/glass_conservatory_cover_1794494018793.jpg',
    path.join(glassDirAbs, '001.jpg'),
    { id: 'gc08-1', aspect: 'portrait', motif: 'botanical-specimen', sealKanji: '緑', pageNumber: 1 }
  );
  const g2 = writeSvgPlate(path.join(glassDirAbs, '002.svg'), {
    id: 'gc08-2',
    aspect: 'spread',
    motif: 'conservatory-dome',
    sealKanji: '温',
    pageNumber: 2,
  });
  const g3 = writeSvgPlate(path.join(glassDirAbs, '003.svg'), {
    id: 'gc08-3',
    aspect: 'portrait',
    motif: 'botanical-specimen',
    sealKanji: '葉',
    pageNumber: 3,
  });
  const g4 = writeSvgPlate(path.join(glassDirAbs, '004.svg'), {
    id: 'gc08-4',
    aspect: 'portrait',
    motif: 'spiral-stairs',
    sealKanji: '階',
    pageNumber: 4,
  });

  const glassPages: MangaPage[] = [
    { index: 1, filename: '001.jpg', url: `/downloads/${encodeURI(glassDirRel)}/001.jpg`, bytes: g1.bytes, isSpread: false },
    { index: 2, filename: '002.svg', url: `/downloads/${encodeURI(glassDirRel)}/002.svg`, bytes: g2.bytes, isSpread: true },
    { index: 3, filename: '003.svg', url: `/downloads/${encodeURI(glassDirRel)}/003.svg`, bytes: g3.bytes, isSpread: false },
    { index: 4, filename: '004.svg', url: `/downloads/${encodeURI(glassDirRel)}/004.svg`, bytes: g4.bytes, isSpread: false },
  ];
  fs.writeFileSync(
    path.join(glassDirAbs, 'metadata.json'),
    JSON.stringify({ category: 'mangadex', manga: 'The Glass Conservatory', chapter: 8, count: 4 }, null, 2)
  );

  // 3. Tidal Cartographer — Chapter 22
  const tidalDirRel = 'danbooru/Tidal Cartographer/c022';
  const tidalDirAbs = path.join(DOWNLOADS_ROOT, tidalDirRel);
  fs.mkdirSync(tidalDirAbs, { recursive: true });

  const t1 = copyAssetOrFallback(
    'src/assets/images/tidal_cartographer_cover_1794494020429.jpg',
    path.join(tidalDirAbs, '001.jpg'),
    { id: 'tc22-1', aspect: 'portrait', motif: 'astrolabe-sounding', sealKanji: '潮', pageNumber: 1 }
  );
  const t2 = writeSvgPlate(path.join(tidalDirAbs, '002.svg'), {
    id: 'tc22-2',
    aspect: 'spread',
    motif: 'bathymetry-chart',
    sealKanji: '海',
    pageNumber: 2,
  });
  const t3 = writeSvgPlate(path.join(tidalDirAbs, '003.svg'), {
    id: 'tc22-3',
    aspect: 'portrait',
    motif: 'astrolabe-sounding',
    sealKanji: '測',
    pageNumber: 3,
  });
  const t4 = writeSvgPlate(path.join(tidalDirAbs, '004.svg'), {
    id: 'tc22-4',
    aspect: 'portrait',
    motif: 'basalt-beacon',
    sealKanji: '礁',
    pageNumber: 4,
  });

  const tidalPages: MangaPage[] = [
    { index: 1, filename: '001.jpg', url: `/downloads/${encodeURI(tidalDirRel)}/001.jpg`, bytes: t1.bytes, isSpread: false },
    { index: 2, filename: '002.svg', url: `/downloads/${encodeURI(tidalDirRel)}/002.svg`, bytes: t2.bytes, isSpread: true },
    { index: 3, filename: '003.svg', url: `/downloads/${encodeURI(tidalDirRel)}/003.svg`, bytes: t3.bytes, isSpread: false },
    { index: 4, filename: '004.svg', url: `/downloads/${encodeURI(tidalDirRel)}/004.svg`, bytes: t4.bytes, isSpread: false },
  ];
  fs.writeFileSync(
    path.join(tidalDirAbs, 'metadata.json'),
    JSON.stringify({ category: 'danbooru', manga: 'Tidal Cartographer', chapter: 22, count: 4 }, null, 2)
  );

  const ironTotal = ironPages.reduce((acc, p) => acc + p.bytes, 0);
  const glassTotal = glassPages.reduce((acc, p) => acc + p.bytes, 0);
  const tidalTotal = tidalPages.reduce((acc, p) => acc + p.bytes, 0);

  const chapters: MangaChapter[] = [
    {
      id: 'ch-iron-rail-014',
      seriesId: 'iron-rail-nocturne',
      seriesTitle: 'Iron Rail Nocturne',
      chapterNumber: 14,
      chapterTitle: 'Viaduct Crossing at 02:40',
      extractor: 'mangadex',
      sourceUrl: 'https://mangadex.org/chapter/8f3a19b0-1400-4d1c-9b2a-ironrail0014',
      directoryPath: `./downloads/${ironDirRel}`,
      downloadedAt: '2026-11-11T21:14:00.000Z',
      pageCount: ironPages.length,
      totalBytes: ironTotal,
      readPage: 2,
      pages: ironPages,
    },
    {
      id: 'ch-glass-conservatory-008',
      seriesId: 'the-glass-conservatory',
      seriesTitle: 'The Glass Conservatory',
      chapterNumber: 8,
      chapterTitle: 'Fern Gallery Ironwork',
      extractor: 'mangadex',
      sourceUrl: 'https://mangadex.org/chapter/4c9e02d1-0800-4a8b-8f11-glasscon0008',
      directoryPath: `./downloads/${glassDirRel}`,
      downloadedAt: '2026-11-10T18:42:00.000Z',
      pageCount: glassPages.length,
      totalBytes: glassTotal,
      readPage: 0,
      pages: glassPages,
    },
    {
      id: 'ch-tidal-cartographer-022',
      seriesId: 'tidal-cartographer',
      seriesTitle: 'Tidal Cartographer',
      chapterNumber: 22,
      chapterTitle: 'Basalt Stacks & Astrolabe',
      extractor: 'danbooru',
      sourceUrl: 'https://danbooru.donmai.us/pools/22048',
      directoryPath: `./downloads/${tidalDirRel}`,
      downloadedAt: '2026-11-09T11:05:00.000Z',
      pageCount: tidalPages.length,
      totalBytes: tidalTotal,
      readPage: 4,
      pages: tidalPages,
    },
  ];

  const jobs: DownloadJob[] = [
    {
      id: 'job-seed-1',
      url: 'https://mangadex.org/chapter/8f3a19b0-1400-4d1c-9b2a-ironrail0014',
      seriesTitle: 'Iron Rail Nocturne',
      chapterNumber: 14,
      extractor: 'mangadex',
      status: 'completed',
      commandPreview:
        "gallery-dl -d ./downloads -f '{num:03d}.{extension}' --sleep-request 0.5 --write-metadata 'https://mangadex.org/chapter/8f3a19b0-1400-4d1c-9b2a-ironrail0014'",
      createdAt: '2026-11-11T21:13:52.000Z',
      completedAt: '2026-11-11T21:14:00.000Z',
      downloadedPages: 5,
      totalPages: 5,
      bytesDownloaded: ironTotal,
      outputChapterId: 'ch-iron-rail-014',
      logs: [
        `[mangadex][info] Extracting chapter 14 — 'Iron Rail Nocturne'`,
        `./downloads/${ironDirRel}/001.jpg`,
        `./downloads/${ironDirRel}/002.jpg`,
        `./downloads/${ironDirRel}/003.jpg`,
        `./downloads/${ironDirRel}/004.svg`,
        `./downloads/${ironDirRel}/005.svg`,
        `[metadata][info] Wrote sidecar ./downloads/${ironDirRel}/metadata.json`,
      ],
    },
  ];

  const state: PersistedState = {
    seriesMeta: {
      'iron-rail-nocturne': {
        id: 'iron-rail-nocturne',
        title: 'Iron Rail Nocturne',
        author: 'Kenji Takahashi',
        extractor: 'mangadex',
        tags: ['Seinen', 'Railway', 'Historical'],
        coverChapterId: 'ch-iron-rail-014',
      },
      'the-glass-conservatory': {
        id: 'the-glass-conservatory',
        title: 'The Glass Conservatory',
        author: 'Haruka Mizuno',
        extractor: 'mangadex',
        tags: ['Botanical', 'Mystery', 'Architectural'],
        coverChapterId: 'ch-glass-conservatory-008',
      },
      'tidal-cartographer': {
        id: 'tidal-cartographer',
        title: 'Tidal Cartographer',
        author: 'Sora Aoyagi',
        extractor: 'danbooru',
        tags: ['Maritime', 'Expedition', 'Pen & Ink'],
        coverChapterId: 'ch-tidal-cartographer-022',
      },
    },
    chapters,
    jobs,
    config: DEFAULT_CONFIG,
  };

  writeConfigDisk(state.config);
  saveState(state);
  return state;
}

function loadState(): PersistedState {
  ensureDownloadsDir();
  if (fs.existsSync(INDEX_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) as PersistedState;
      if (parsed && Array.isArray(parsed.chapters) && parsed.config) {
        if (parsed.config.userAgent?.startsWith('Mozilla/5.0 (X11; Linux x86_64) KomaDL')) {
          parsed.config.userAgent = DEFAULT_CONFIG.userAgent;
          writeConfigDisk(parsed.config);
        }
        if (Array.isArray(parsed.jobs)) {
          parsed.jobs = parsed.jobs.filter(
            (j) => !(j.status === 'failed' && j.error && j.error.includes('403'))
          );
        }
        saveState(parsed);
        return parsed;
      }
    } catch {
      // Rebuild cleanly on corrupt index
    }
  }
  return buildSeededState();
}

let appState: PersistedState = loadState();

const KNOWN_EXTRACTORS = new Set([
  'hitomi',
  'danbooru',
  'gelbooru',
  'e-hentai',
  'exhentai',
  'nhentai',
  'pixiv',
  'twitter',
  'reddit',
  'imgur',
  'deviantart',
  'artstation',
  'yandere',
  'konachan',
  'booru',
  'mangadex',
  'downloads',
  'gallery-dl',
  'local-import',
]);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.svg']);

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function findImageDirs(dir: string): string[] {
  let list: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let hasImages = false;
    for (const e of entries) {
      if (e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) {
        hasImages = true;
      }
    }
    if (hasImages) list.push(dir);
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git' && !e.name.startsWith('.')) {
        list = list.concat(findImageDirs(path.join(dir, e.name)));
      }
    }
  } catch {}
  return list;
}

function scanLibraryFromDisk(state: PersistedState): MangaSeries[] {
  ensureDownloadsDir();
  const imageDirs = findImageDirs(DOWNLOADS_ROOT);
  const existingChaptersById = new Map<string, MangaChapter>();
  for (const ch of state.chapters) {
    existingChaptersById.set(ch.id, ch);
  }

  const discoveredChapters: MangaChapter[] = [];

  for (const dir of imageDirs) {
    const files = fs
      .readdirSync(dir)
      .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .sort(naturalSort);

    if (files.length === 0) continue;

    const relChapter = path.relative(DOWNLOADS_ROOT, dir).replace(/\\/g, '/');
    const parts = relChapter.split('/').filter(Boolean);

    // Look for sidecar metadata
    let sidecarMeta: any = null;
    const candidates = [
      path.join(dir, 'info.json'),
      path.join(dir, 'metadata.json'),
      path.join(path.dirname(dir), 'info.json'),
      path.join(path.dirname(dir), 'metadata.json'),
    ];
    for (const cp of candidates) {
      if (fs.existsSync(cp)) {
        try {
          sidecarMeta = JSON.parse(fs.readFileSync(cp, 'utf8'));
          break;
        } catch {}
      }
    }

    let seriesTitle = '';
    let chapterTitle = '';
    let chapterNumber = 1;
    let extractor = 'gallery-dl';

    if (parts.length === 1) {
      seriesTitle = sidecarMeta?.title || sidecarMeta?.manga || parts[0];
      chapterTitle = 'Complete Gallery';
      chapterNumber = 1;
    } else {
      const folder = parts[parts.length - 1];
      const parent = parts[parts.length - 2];

      if (parts[0] && KNOWN_EXTRACTORS.has(parts[0].toLowerCase())) {
        extractor = parts[0].toLowerCase();
      }

      if (KNOWN_EXTRACTORS.has(parent.toLowerCase())) {
        // e.g. hitomi/4324575 Kit Bodega
        seriesTitle = sidecarMeta?.title || folder.replace(/^\d+\s+/, '') || folder;
        chapterTitle = 'Gallery';
        chapterNumber = 1;
      } else {
        // e.g. mangadex/Iron Rail Nocturne/c015 or COSMOS/c010
        seriesTitle = sidecarMeta?.manga || parent;
        chapterTitle = sidecarMeta?.title || folder;
        const numMatch = /c?(\d+)/i.exec(folder);
        chapterNumber = sidecarMeta?.chapter ? Number(sidecarMeta.chapter) || 1 : numMatch ? Number(numMatch[1]) : 1;
      }
    }

    const seriesId = slugifyId(seriesTitle);
    const chapterId = `ch-${seriesId}-${String(chapterNumber).padStart(3, '0')}`;

    let totalBytes = 0;
    const pages: MangaPage[] = files.map((file, idx) => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      totalBytes += stat.size;
      const relFile = path.relative(DOWNLOADS_ROOT, fullPath).replace(/\\/g, '/');
      return {
        index: idx + 1,
        filename: file,
        url: `/downloads/${encodeURI(relFile)}`,
        bytes: stat.size,
      };
    });

    const existing = existingChaptersById.get(chapterId) || state.chapters.find((c) => c.directoryPath === `./downloads/${relChapter}`);

    discoveredChapters.push({
      id: chapterId,
      seriesId,
      seriesTitle,
      chapterNumber,
      chapterTitle,
      extractor: sidecarMeta?.category || extractor,
      sourceUrl: sidecarMeta?.source_url || sidecarMeta?.url || existing?.sourceUrl || '',
      directoryPath: `./downloads/${relChapter}`,
      downloadedAt: existing?.downloadedAt || new Date().toISOString(),
      pageCount: pages.length,
      totalBytes,
      readPage: existing?.readPage || 0,
      pages,
    });

    if (!state.seriesMeta[seriesId]) {
      state.seriesMeta[seriesId] = {
        id: seriesId,
        title: seriesTitle,
        author: sidecarMeta?.artist?.[0] || sidecarMeta?.author || 'Local Archive',
        extractor: sidecarMeta?.category || extractor,
        tags: sidecarMeta?.tags || [extractor],
        coverChapterId: chapterId,
      };
    }
  }

  state.chapters = discoveredChapters;
  saveState(state);

  const grouped = new Map<string, MangaChapter[]>();
  for (const ch of discoveredChapters) {
    const list = grouped.get(ch.seriesId) || [];
    list.push(ch);
    grouped.set(ch.seriesId, list);
  }

  const seriesList: MangaSeries[] = [];
  for (const [seriesId, chapters] of grouped.entries()) {
    const sorted = [...chapters].sort((a, b) => b.chapterNumber - a.chapterNumber);
    const meta = state.seriesMeta[seriesId];
    const coverChapter =
      chapters.find((c) => c.id === meta?.coverChapterId) ||
      [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber)[0];
    const coverUrl = coverChapter?.pages[0]?.url || '';
    const totalBytes = sorted.reduce((sum, c) => sum + c.totalBytes, 0);
    const updatedAt =
      sorted
        .map((c) => c.downloadedAt)
        .sort()
        .reverse()[0] || new Date().toISOString();

    seriesList.push({
      id: seriesId,
      title: meta?.title || sorted[0].seriesTitle,
      author: meta?.author || 'Local Archive',
      extractor: meta?.extractor || sorted[0].extractor,
      tags: meta?.tags || [sorted[0].extractor],
      coverUrl,
      updatedAt,
      totalBytes,
      chapters: sorted,
    });
  }

  return seriesList.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function computeSeriesList(state: PersistedState): MangaSeries[] {
  return scanLibraryFromDisk(state);
}

function computeEngineInfo(state: PersistedState): EngineInfo {
  const series = computeSeriesList(state);
  const totalChapters = state.chapters.length;
  const totalPages = state.chapters.reduce((s, c) => s + c.pageCount, 0);
  const totalBytes = state.chapters.reduce((s, c) => s + c.totalBytes, 0);

  return {
    galleryDlBinaryFound: Boolean(cachedGalleryDlVersion),
    galleryDlVersion: cachedGalleryDlVersion,
    pythonVersion: cachedPythonVersion,
    archiveRoot: DOWNLOADS_ROOT,
    configPath: CONFIG_FILE,
    totalSeries: series.length,
    totalChapters,
    totalPages,
    totalBytes,
  };
}

function parseRangeFilter(rangeStr: string | undefined, totalCount: number): number[] {
  if (!rangeStr || !rangeStr.trim()) {
    return Array.from({ length: totalCount }, (_, i) => i + 1);
  }
  const indices = new Set<number>();
  const parts = rangeStr.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    const match = /^(\d+)-(\d+)$/.exec(trimmed);
    if (match) {
      const start = Math.max(1, Number(match[1]));
      const end = Math.min(totalCount, Number(match[2]));
      for (let i = start; i <= end; i++) indices.add(i);
    } else if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (n >= 1 && n <= totalCount) indices.add(n);
    }
  }
  return indices.size > 0
    ? Array.from(indices).sort((a, b) => a - b)
    : Array.from({ length: totalCount }, (_, i) => i + 1);
}

interface ExtractedRemoteAsset {
  url: string;
  ext: string;
  isSpread?: boolean;
}

async function extractUrlsViaHttp(
  targetUrl: string,
  userAgent: string,
  log: (line: string) => void
): Promise<{
  seriesTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  extractor: string;
  assets: ExtractedRemoteAsset[];
}> {
  const extractor = detectExtractorFromUrl(targetUrl);

  if (extractor === 'direct-image') {
    const parsed = new URL(targetUrl);
    const baseName = path.basename(parsed.pathname).replace(/\.[a-z0-9]+$/i, '') || 'Direct Image';
    const extMatch = /\.([a-z0-9]+)$/i.exec(parsed.pathname);
    return {
      seriesTitle: decodeURIComponent(baseName),
      chapterNumber: 1,
      chapterTitle: 'Single Plate Extraction',
      extractor,
      assets: [{ url: targetUrl, ext: extMatch ? extMatch[1].toLowerCase() : 'jpg' }],
    };
  }

  const mdTitleMatch = /mangadex\.org\/(?:title|manga)\/([0-9a-f-]{36})/i.exec(targetUrl);
  const mdChapterMatch = /mangadex\.org\/chapter\/([0-9a-f-]{36})/i.exec(targetUrl);

  if (mdTitleMatch || mdChapterMatch) {
    const mdHeaders = {
      'User-Agent': getSafeUserAgent('https://api.mangadex.org', userAgent),
      Accept: 'application/json',
    };

    let chapterUuid = mdChapterMatch ? mdChapterMatch[1] : '';
    let resolvedMangaTitle = '';
    let resolvedChapterNum = 1;
    let resolvedChapterTitle = '';

    if (mdTitleMatch) {
      const mangaUuid = mdTitleMatch[1];
      log(`[mangadex][info] Resolving series title ${mangaUuid} via MangaDex API`);
      const seriesResp = await fetch(`https://api.mangadex.org/manga/${mangaUuid}`, {
        headers: mdHeaders,
      });
      if (!seriesResp.ok) {
        throw new Error(`MangaDex Series API returned HTTP ${seriesResp.status}`);
      }
      const seriesJson = (await seriesResp.json()) as {
        data?: { attributes?: { title?: Record<string, string> } };
      };
      const titleMap = seriesJson.data?.attributes?.title || {};
      resolvedMangaTitle =
        titleMap.en || titleMap['ja-ro'] || Object.values(titleMap)[0] || 'MangaDex Series';

      const feedResp = await fetch(
        `https://api.mangadex.org/manga/${mangaUuid}/feed?limit=100&order[chapter]=asc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`,
        { headers: mdHeaders }
      );
      if (!feedResp.ok) {
        throw new Error(`MangaDex Chapter Feed returned HTTP ${feedResp.status}`);
      }
      const feedJson = (await feedResp.json()) as {
        data?: Array<{
          id: string;
          attributes?: {
            chapter?: string | null;
            title?: string | null;
            translatedLanguage?: string;
            externalUrl?: string | null;
            pages?: number;
          };
        }>;
      };

      const allChapters = feedJson.data || [];
      const hostedChapters = allChapters.filter(
        (c) => !c.attributes?.externalUrl && (c.attributes?.pages ?? 1) > 0
      );
      const enHosted = hostedChapters.filter((c) => c.attributes?.translatedLanguage === 'en');
      const pool = enHosted.length > 0 ? enHosted : hostedChapters;

      if (pool.length === 0) {
        throw new Error(
          `No directly hosted chapters found on MangaDex for "${resolvedMangaTitle}" (chapters may link to an external publisher).`
        );
      }

      const chosen = pool[0];
      chapterUuid = chosen.id;
      resolvedChapterNum = Number(chosen.attributes?.chapter || 1) || 1;
      resolvedChapterTitle = chosen.attributes?.title || `Chapter ${resolvedChapterNum}`;
      log(
        `[mangadex][info] Selected hosted chapter ${resolvedChapterNum} (${chapterUuid}) from "${resolvedMangaTitle}"`
      );
    }

    if (mdChapterMatch) {
      log(`[mangadex][info] Querying MangaDex API for chapter ${chapterUuid}`);
      const metaResp = await fetch(
        `https://api.mangadex.org/chapter/${chapterUuid}?includes[]=manga`,
        { headers: mdHeaders }
      );
      if (!metaResp.ok) {
        throw new Error(`MangaDex API returned HTTP ${metaResp.status}`);
      }
      const metaJson = (await metaResp.json()) as {
        data?: {
          attributes?: {
            chapter?: string;
            title?: string;
            externalUrl?: string | null;
            pages?: number;
          };
          relationships?: Array<{ type: string; attributes?: { title?: Record<string, string> } }>;
        };
      };
      const chAttr = metaJson.data?.attributes;
      if (chAttr?.externalUrl && (chAttr?.pages ?? 0) === 0) {
        throw new Error(
          `This MangaDex chapter is an external redirect (${chAttr.externalUrl}) with 0 pages hosted on MangaDex.`
        );
      }
      const mangaRel = metaJson.data?.relationships?.find((r) => r.type === 'manga');
      const titleMap = mangaRel?.attributes?.title || {};
      resolvedMangaTitle =
        titleMap.en || titleMap['ja-ro'] || Object.values(titleMap)[0] || 'MangaDex Series';
      resolvedChapterNum = Number(chAttr?.chapter || 1) || 1;
      resolvedChapterTitle = chAttr?.title || `Chapter ${resolvedChapterNum}`;
    }

    const homeResp = await fetch(`https://api.mangadex.org/at-home/server/${chapterUuid}`, {
      headers: mdHeaders,
    });
    if (!homeResp.ok) {
      throw new Error(`MangaDex At-Home server returned HTTP ${homeResp.status}`);
    }
    const homeJson = (await homeResp.json()) as {
      baseUrl: string;
      chapter: { hash: string; data?: string[]; dataSaver?: string[] };
    };

    const fullData = homeJson.chapter?.data || [];
    const saverData = homeJson.chapter?.dataSaver || [];
    const useSaver = fullData.length === 0 && saverData.length > 0;
    const fileList = useSaver ? saverData : fullData;
    const modePath = useSaver ? 'data-saver' : 'data';

    const assets: ExtractedRemoteAsset[] = fileList.map((file) => {
      const ext = (path.extname(file).replace('.', '') || 'jpg').toLowerCase();
      return {
        url: `${homeJson.baseUrl}/${modePath}/${homeJson.chapter.hash}/${file}`,
        ext,
      };
    });

    return {
      seriesTitle: resolvedMangaTitle,
      chapterNumber: resolvedChapterNum,
      chapterTitle: resolvedChapterTitle,
      extractor: 'mangadex',
      assets,
    };
  }

  log(`[${extractor}][info] Fetching gallery document ${targetUrl}`);
  const resp = await fetch(targetUrl, {
    headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml,application/json,*/*' },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText} from ${targetUrl}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.startsWith('image/')) {
    const ext = contentType.includes('svg')
      ? 'svg'
      : contentType.includes('png')
        ? 'png'
        : contentType.includes('webp')
          ? 'webp'
          : 'jpg';
    return {
      seriesTitle: 'Downloaded Image Archive',
      chapterNumber: 1,
      chapterTitle: 'Direct Stream',
      extractor: 'direct-image',
      assets: [{ url: targetUrl, ext }],
    };
  }

  const html = await resp.text();
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const metaSeries = /<meta\s+name=["']komadl:series["']\s+content=["']([^"']+)["']/i.exec(html)?.[1];
  const metaChapter = /<meta\s+name=["']komadl:chapter["']\s+content=["']([^"']+)["']/i.exec(html)?.[1];
  const metaChapterTitle = /<meta\s+name=["']komadl:chapter-title["']\s+content=["']([^"']+)["']/i.exec(html)?.[1];
  const metaExtractor = /<meta\s+name=["']komadl:extractor["']\s+content=["']([^"']+)["']/i.exec(html)?.[1];

  const foundUrls = new Map<string, { ext: string; isSpread: boolean }>();

  const imgRegex = /<img\b[^>]*?\b(?:data-src|src)=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRegex.exec(html)) !== null) {
    const rawTag = m[0];
    const rawSrc = m[1].trim();
    if (!rawSrc || rawSrc.startsWith('data:')) continue;
    if (/logo|avatar|icon|pixel|tracker|sprite/i.test(rawSrc)) continue;
    try {
      const absUrl = new URL(rawSrc, targetUrl).toString();
      const pathname = new URL(absUrl).pathname;
      const extMatch = /\.(jpe?g|png|webp|gif|svg|avif)$/i.exec(pathname);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
      const isSpread = /data-spread=["']true["']/i.test(rawTag) || /spread/i.test(rawSrc);
      foundUrls.set(absUrl, { ext, isSpread });
    } catch {
      // ignore malformed URL
    }
  }

  if (foundUrls.size === 0) {
    const ogMatch = /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(html);
    if (ogMatch?.[1]) {
      const absUrl = new URL(ogMatch[1], targetUrl).toString();
      foundUrls.set(absUrl, { ext: 'jpg', isSpread: false });
    }
  }

  const assets: ExtractedRemoteAsset[] = Array.from(foundUrls.entries()).map(([url, info]) => ({
    url,
    ext: info.ext,
    isSpread: info.isSpread,
  }));

  const cleanPageTitle = (titleMatch?.[1] || 'Web Gallery').replace(/\s*[|—-].*$/, '').trim();
  return {
    seriesTitle: metaSeries || cleanPageTitle || 'Web Gallery',
    chapterNumber: metaChapter ? Number(metaChapter) || 1 : 1,
    chapterTitle: metaChapterTitle || cleanPageTitle || 'Extracted Chapter',
    extractor: metaExtractor || extractor,
    assets,
  };
}

async function executeDownloadJob(
  job: DownloadJob,
  options: {
    seriesOverride?: string;
    chapterOverride?: number;
    pageRange?: string;
  }
): Promise<void> {
  job.status = 'running';
  saveState(appState);

  const appendLog = (line: string) => {
    job.logs.push(line);
  };

  try {
    await detectBinaries();
    const isLocalFeed = job.url.includes('/api/sample-feed/');

    if (resolvedGalleryDlBin && !isLocalFeed) {
      let targetDir = DOWNLOADS_ROOT;
      if (options.seriesOverride && options.seriesOverride.trim()) {
        targetDir = path.join(DOWNLOADS_ROOT, sanitizeSegment(options.seriesOverride.trim()));
        fs.mkdirSync(targetDir, { recursive: true });
      }

      appendLog(`[gallery-dl][info] Executing: ${resolvedGalleryDlBin}`);

      const args: string[] = [
        '--windows-filenames',
        '--no-colors',
        '--destination', targetDir,
      ];

      if (options.pageRange?.trim()) {
        args.push('--range', options.pageRange.trim());
      }
      if (appState.config.sleepRequest > 0) {
        args.push('--sleep-request', String(appState.config.sleepRequest));
      }
      if (appState.config.retries > 0) {
        args.push('--retries', String(appState.config.retries));
      }
      if (appState.config.writeMetadata) {
        args.push('--write-info-json');
      }
      if (appState.config.proxyUrl?.trim()) {
        args.push('--proxy', appState.config.proxyUrl.trim());
      }
      if (appState.config.cookiesPath?.trim()) {
        args.push('--cookies', appState.config.cookiesPath.trim());
      }
      if (options.extraArgs?.trim()) {
        const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
        let match;
        while ((match = regex.exec(options.extraArgs.trim())) !== null) {
          args.push(match[1] || match[2] || match[0]);
        }
      }
      args.push(job.url);

      appendLog(`[gallery-dl][info] Args: ${args.join(' ')}`);

      await new Promise<void>((resolve, reject) => {
        const child = spawn(resolvedGalleryDlBin!, args);
        child.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          for (const rawLine of text.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            appendLog(line);

            if (/\.(jpe?g|png|webp|gif|avif|bmp|cbz|zip)$/i.test(line)) {
              job.downloadedPages += 1;
              const match = /\[(\d+)\/(\d+)\]/.exec(line);
              if (match) {
                job.downloadedPages = Number(match[1]);
                job.totalPages = Number(match[2]);
              }
            }
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          for (const rawLine of text.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            appendLog(line);
          }
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`gallery-dl exited with code ${code}`));
        });
      });

      // Synchronize library from disk!
      scanLibraryFromDisk(appState);
      if (job.totalPages === 0 || job.downloadedPages > job.totalPages) {
        job.totalPages = job.downloadedPages;
      }
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      saveState(appState);
      return;
    }

    if (!isLocalFeed && !resolvedGalleryDlBin) {
      throw new Error(
        'gallery-dl binary not found. Please install gallery-dl or set GALLERY_DL_BIN environment variable.'
      );
    }

    const extracted = await extractUrlsViaHttp(job.url, appState.config.userAgent, appendLog);
    if (extracted.assets.length === 0) {
      throw new Error(
        'No downloadable manga pages or images were found at that URL. Paste a direct image URL, MangaDex chapter URL, gallery page, or select one of the local feed presets.'
      );
    }

    const selectedIndices = parseRangeFilter(options.pageRange, extracted.assets.length);
    const chosenAssets = selectedIndices.map((idx1) => extracted.assets[idx1 - 1]).filter(Boolean);

    const finalSeries = (options.seriesOverride?.trim() || extracted.seriesTitle).trim();
    const finalChapter = options.chapterOverride || extracted.chapterNumber || 1;
    const safeCategory = sanitizeSegment(extracted.extractor);
    const safeManga = sanitizeSegment(finalSeries);
    const relDir = `${safeCategory}/${safeManga}/c${String(finalChapter).padStart(3, '0')}`;
    const absDir = path.join(DOWNLOADS_ROOT, relDir);
    fs.mkdirSync(absDir, { recursive: true });

    job.seriesTitle = finalSeries;
    job.chapterNumber = finalChapter;
    job.extractor = extracted.extractor;
    job.totalPages = chosenAssets.length;
    appendLog(`[${extracted.extractor}][info] Queued ${chosenAssets.length} page(s) -> ./downloads/${relDir}`);

    const downloadedPages: MangaPage[] = [];
    const sleepMs = Math.min(Math.max(appState.config.sleepRequest || 0, 0), 2) * 250;

    for (let i = 0; i < chosenAssets.length; i++) {
      const asset = chosenAssets[i];
      if (i > 0 && sleepMs > 0) {
        await new Promise((r) => setTimeout(r, sleepMs));
      }

      const fileResp = await fetch(asset.url, {
        headers: { 'User-Agent': getSafeUserAgent(asset.url, appState.config.userAgent) },
      });
      if (!fileResp.ok) {
        throw new Error(`Failed downloading page ${i + 1}: HTTP ${fileResp.status}`);
      }

      const arrayBuf = await fileResp.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const filename = `${String(i + 1).padStart(3, '0')}.${asset.ext}`;
      const fullPath = path.join(absDir, filename);
      fs.writeFileSync(fullPath, buf);

      job.downloadedPages = i + 1;
      job.bytesDownloaded += buf.length;
      appendLog(`./downloads/${relDir}/${filename} (${buf.length} bytes)`);

      downloadedPages.push({
        index: i + 1,
        filename,
        url: `/downloads/${encodeURI(relDir)}/${encodeURI(filename)}`,
        bytes: buf.length,
        isSpread: asset.isSpread,
      });
      saveState(appState);
    }

    if (appState.config.writeMetadata) {
      const metaPath = path.join(absDir, 'metadata.json');
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            category: extracted.extractor,
            manga: finalSeries,
            chapter: finalChapter,
            title: extracted.chapterTitle,
            source_url: job.url,
            count: downloadedPages.length,
            downloaded_at: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      );
      appendLog(`[metadata][info] Wrote sidecar ./downloads/${relDir}/metadata.json`);
    }

    const seriesId = slugifyId(finalSeries);
    const existingIdx = appState.chapters.findIndex(
      (c) => c.seriesId === seriesId && c.chapterNumber === finalChapter
    );
    const chapterId =
      existingIdx >= 0
        ? appState.chapters[existingIdx].id
        : `ch-${seriesId}-${String(finalChapter).padStart(3, '0')}-${crypto.randomBytes(2).toString('hex')}`;

    const chapterRecord: MangaChapter = {
      id: chapterId,
      seriesId,
      seriesTitle: finalSeries,
      chapterNumber: finalChapter,
      chapterTitle: extracted.chapterTitle,
      extractor: extracted.extractor,
      sourceUrl: job.url,
      directoryPath: `./downloads/${relDir}`,
      downloadedAt: new Date().toISOString(),
      pageCount: downloadedPages.length,
      totalBytes: job.bytesDownloaded,
      readPage: 0,
      pages: downloadedPages,
    };

    if (existingIdx >= 0) {
      appState.chapters[existingIdx] = chapterRecord;
    } else {
      appState.chapters.unshift(chapterRecord);
    }

    if (!appState.seriesMeta[seriesId]) {
      appState.seriesMeta[seriesId] = {
        id: seriesId,
        title: finalSeries,
        author: 'Archived via KomaDL',
        extractor: extracted.extractor,
        tags: [extracted.extractor],
        coverChapterId: chapterId,
      };
    }

    job.outputChapterId = chapterId;
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    saveState(appState);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error = message;
    job.completedAt = new Date().toISOString();
    appendLog(`[error] ${message}`);
    saveState(appState);
  }
}

function collectSourceZipEntries(): Array<{ filename: string; data: Buffer }> {
  const entries: Array<{ filename: string; data: Buffer }> = [];
  const rootFiles = [
    'package.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'metadata.json',
    '.env.example',
    '.gitignore',
    'README.md',
    'server.ts',
  ];

  for (const rel of rootFiles) {
    const full = path.join(__dirname, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      entries.push({ filename: rel, data: fs.readFileSync(full) });
    }
  }

  const walkDir = (dirRel: string) => {
    const absDir = path.join(__dirname, dirRel);
    if (!fs.existsSync(absDir)) return;
    for (const item of fs.readdirSync(absDir, { withFileTypes: true })) {
      const childRel = path.posix.join(dirRel, item.name);
      if (item.isDirectory()) {
        walkDir(childRel);
      } else if (item.isFile()) {
        entries.push({
          filename: childRel,
          data: fs.readFileSync(path.join(__dirname, childRel)),
        });
      }
    }
  };

  walkDir('src');
  walkDir('server');
  return entries;
}

async function startServer() {
  await detectBinaries();
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.use(
    '/downloads',
    express.static(DOWNLOADS_ROOT, {
      fallthrough: true,
      maxAge: '7d',
    })
  );

  // Direct one-click project source ZIP download endpoint
  app.get('/api/source-code.zip', (_req: Request, res: Response) => {
    const entries = collectSourceZipEntries();
    const zipBuffer = createCbzBuffer(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="komadl-local-project.zip"');
    res.send(zipBuffer);
  });

  const presetMotifs: Record<string, PlateSpec[]> = {
    'iron-rail-c015': [
      { id: 'ir15-1', aspect: 'portrait', motif: 'night-cab', sealKanji: '十五', pageNumber: 1 },
      { id: 'ir15-2', aspect: 'spread', motif: 'bridge-crossing', sealKanji: '橋', pageNumber: 2 },
      { id: 'ir15-3', aspect: 'portrait', motif: 'railway-signal', sealKanji: '信', pageNumber: 3 },
      { id: 'ir15-4', aspect: 'portrait', motif: 'tunnel-dawn', sealKanji: '終', pageNumber: 4 },
    ],
    'glass-conservatory-c009': [
      { id: 'gc09-1', aspect: 'portrait', motif: 'botanical-specimen', sealKanji: '九', pageNumber: 1 },
      { id: 'gc09-2', aspect: 'spread', motif: 'conservatory-dome', sealKanji: '穹', pageNumber: 2 },
      { id: 'gc09-3', aspect: 'portrait', motif: 'spiral-stairs', sealKanji: '蔓', pageNumber: 3 },
      { id: 'gc09-4', aspect: 'portrait', motif: 'botanical-specimen', sealKanji: '種', pageNumber: 4 },
    ],
    'tidal-cartographer-c023': [
      { id: 'tc23-1', aspect: 'portrait', motif: 'astrolabe-sounding', sealKanji: '廿', pageNumber: 1 },
      { id: 'tc23-2', aspect: 'spread', motif: 'bathymetry-chart', sealKanji: '図', pageNumber: 2 },
      { id: 'tc23-3', aspect: 'portrait', motif: 'basalt-beacon', sealKanji: '灯', pageNumber: 3 },
      { id: 'tc23-4', aspect: 'portrait', motif: 'astrolabe-sounding', sealKanji: '錨', pageNumber: 4 },
    ],
  };

  app.get('/api/sample-feed-asset/:presetId/:file', (req: Request, res: Response) => {
    const presetId = String(req.params.presetId || '');
    const file = String(req.params.file || '');
    const plates = presetMotifs[presetId];
    const match = /^(\d+)\.svg$/i.exec(file);
    if (!plates || !match) {
      res.status(404).send('Plate not found');
      return;
    }
    const idx = Number(match[1]) - 1;
    const spec = plates[idx];
    if (!spec) {
      res.status(404).send('Plate index out of range');
      return;
    }
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.send(renderMangaPlateSvg(spec));
  });

  app.get('/api/sample-feed/:presetId', (req: Request, res: Response) => {
    const presetId = String(req.params.presetId || '');
    const preset = SAMPLE_PRESETS.find((p) => p.id === presetId);
    const plates = presetMotifs[presetId];
    if (!preset || !plates) {
      res.status(404).send('Feed not found');
      return;
    }
    const origin = `${req.protocol}://${req.get('host') || `127.0.0.1:${PORT}`}`;
    const imgsHtml = plates
      .map(
        (plate, idx) =>
          `<img src="${origin}/api/sample-feed-asset/${preset.id}/${String(idx + 1).padStart(3, '0')}.svg" alt="Page ${idx + 1}" data-spread="${plate.aspect === 'spread' ? 'true' : 'false'}" />`
      )
      .join('\n      ');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${preset.seriesTitle} — Ch. ${preset.chapterNumber}</title>
    <meta name="komadl:series" content="${preset.seriesTitle}" />
    <meta name="komadl:chapter" content="${preset.chapterNumber}" />
    <meta name="komadl:chapter-title" content="${preset.chapterTitle}" />
    <meta name="komadl:extractor" content="${preset.extractor}" />
  </head>
  <body>
    <main>
      <h1>${preset.seriesTitle} — Chapter ${preset.chapterNumber}: ${preset.chapterTitle}</h1>
      ${imgsHtml}
    </main>
  </body>
</html>`);
  });

  app.get('/api/library', (_req: Request, res: Response) => {
    const origin = `http://127.0.0.1:${PORT}`;
    const presets = SAMPLE_PRESETS.map((p) => ({
      ...p,
      url: `${origin}/api/sample-feed/${p.id}`,
    }));
    res.json({
      series: computeSeriesList(appState),
      presets,
      engine: computeEngineInfo(appState),
      config: appState.config,
      jobs: appState.jobs.slice(0, 25),
    });
  });

  app.post('/api/jobs', async (req: Request, res: Response) => {
    const {
      url,
      seriesTitle,
      chapterNumber,
      pageRange,
      extraArgs,
    }: {
      url?: string;
      seriesTitle?: string;
      chapterNumber?: number;
      pageRange?: string;
      extraArgs?: string;
    } = req.body || {};

    const rawLines = (url || '')
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter(Boolean);

    if (rawLines.length === 0) {
      res.status(400).json({ error: 'Enter at least one gallery, chapter, or image URL to extract.' });
      return;
    }

    const createdJobs: DownloadJob[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      let targetUrl = rawLines[i];
      if (targetUrl.startsWith('/api/sample-feed/')) {
        targetUrl = `http://127.0.0.1:${PORT}${targetUrl}`;
      }
      if (!/^https?:\/\//i.test(targetUrl)) {
        res.status(400).json({ error: `URL must begin with http:// or https:// (${targetUrl})` });
        return;
      }

      const extractor = detectExtractorFromUrl(targetUrl);
      const chNum = chapterNumber ? Number(chapterNumber) + i : 1;
      const cmd = buildGalleryDlCommand({
        url: targetUrl,
        config: appState.config,
        pageRange,
        chapterOverride: chNum,
        seriesOverride: seriesTitle,
        extraArgs,
      });

      const newJob: DownloadJob = {
        id: `job-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
        url: targetUrl,
        seriesTitle: seriesTitle?.trim() || 'Resolving metadata…',
        chapterNumber: chNum,
        extractor,
        status: 'queued',
        commandPreview: cmd,
        createdAt: new Date().toISOString(),
        downloadedPages: 0,
        totalPages: 0,
        bytesDownloaded: 0,
        logs: [],
      };

      appState.jobs.unshift(newJob);
      createdJobs.push(newJob);

      void executeDownloadJob(newJob, {
        seriesOverride: seriesTitle,
        chapterOverride: chapterNumber ? Number(chapterNumber) + i : undefined,
        pageRange,
      });
    }

    saveState(appState);
    res.status(201).json({ jobs: createdJobs });
  });

  app.post('/api/jobs/:jobId/retry', (req: Request, res: Response) => {
    const job = appState.jobs.find((j) => j.id === req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    job.status = 'queued';
    job.error = undefined;
    job.downloadedPages = 0;
    job.bytesDownloaded = 0;
    job.logs = [];
    saveState(appState);
    void executeDownloadJob(job, {});
    res.json({ job });
  });

  app.delete('/api/jobs/failed', (_req: Request, res: Response) => {
    appState.jobs = appState.jobs.filter((j) => j.status !== 'failed');
    saveState(appState);
    res.json({ jobs: appState.jobs.slice(0, 25) });
  });

  app.post('/api/library/import', (req: Request, res: Response) => {
    const {
      seriesTitle,
      chapterNumber,
      chapterTitle,
      files,
    }: {
      seriesTitle?: string;
      chapterNumber?: number;
      chapterTitle?: string;
      files?: Array<{ name: string; dataUrl: string; isSpread?: boolean }>;
    } = req.body || {};

    const cleanSeries = sanitizeSegment(seriesTitle || 'Imported Manga');
    const chNum = Math.max(1, Math.floor(Number(chapterNumber) || 1));

    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'Select one or more manga page images from your computer.' });
      return;
    }

    const relDir = `local-import/${cleanSeries}/c${String(chNum).padStart(3, '0')}`;
    const absDir = path.join(DOWNLOADS_ROOT, relDir);
    fs.mkdirSync(absDir, { recursive: true });

    const sortedFiles = [...files].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    const pages: MangaPage[] = [];
    let totalBytes = 0;

    sortedFiles.forEach((f, idx) => {
      const commaIdx = f.dataUrl.indexOf(',');
      const base64Part = commaIdx >= 0 ? f.dataUrl.slice(commaIdx + 1) : f.dataUrl;
      const buf = Buffer.from(base64Part, 'base64');
      const extMatch = /\.([a-z0-9]+)$/i.exec(f.name);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
      const filename = `${String(idx + 1).padStart(3, '0')}.${ext}`;
      fs.writeFileSync(path.join(absDir, filename), buf);

      totalBytes += buf.length;
      pages.push({
        index: idx + 1,
        filename,
        url: `/downloads/${encodeURI(relDir)}/${encodeURI(filename)}`,
        bytes: buf.length,
        isSpread: Boolean(f.isSpread),
      });
    });

    const seriesId = slugifyId(cleanSeries);
    const chapterId = `ch-${seriesId}-${String(chNum).padStart(3, '0')}-${crypto.randomBytes(2).toString('hex')}`;
    const chapter: MangaChapter = {
      id: chapterId,
      seriesId,
      seriesTitle: cleanSeries,
      chapterNumber: chNum,
      chapterTitle: chapterTitle?.trim() || `Chapter ${chNum}`,
      extractor: 'local-import',
      sourceUrl: 'file://local-browser-import',
      directoryPath: `./downloads/${relDir}`,
      downloadedAt: new Date().toISOString(),
      pageCount: pages.length,
      totalBytes,
      readPage: 0,
      pages,
    };

    appState.chapters.unshift(chapter);
    if (!appState.seriesMeta[seriesId]) {
      appState.seriesMeta[seriesId] = {
        id: seriesId,
        title: cleanSeries,
        author: 'Local Disk Import',
        extractor: 'local-import',
        tags: ['Imported'],
        coverChapterId: chapterId,
      };
    }
    saveState(appState);
    res.status(201).json({ chapter });
  });

  app.patch('/api/chapters/:chapterId/progress', (req: Request, res: Response) => {
    const chapter = appState.chapters.find((c) => c.id === req.params.chapterId);
    if (!chapter) {
      res.status(404).json({ error: 'Chapter not found' });
      return;
    }
    const rawPage = Number(req.body?.readPage);
    if (Number.isFinite(rawPage)) {
      chapter.readPage = Math.max(0, Math.min(chapter.pageCount, Math.floor(rawPage)));
      saveState(appState);
    }
    res.json({ chapter });
  });

  app.delete('/api/chapters/:chapterId', (req: Request, res: Response) => {
    const idx = appState.chapters.findIndex((c) => c.id === req.params.chapterId);
    if (idx < 0) {
      res.status(404).json({ error: 'Chapter not found' });
      return;
    }
    const [removed] = appState.chapters.splice(idx, 1);
    const rel = removed.directoryPath.replace(/^\.\/downloads\/?/, '');
    if (rel) {
      const targetPath = path.resolve(DOWNLOADS_ROOT, rel);
      if (targetPath.startsWith(DOWNLOADS_ROOT) && fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
    }
    saveState(appState);
    res.json({ deletedId: removed.id });
  });

  app.post('/api/library/reset', (_req: Request, res: Response) => {
    appState = buildSeededState();
    res.json({
      series: computeSeriesList(appState),
      engine: computeEngineInfo(appState),
      config: appState.config,
      jobs: appState.jobs,
    });
  });

  app.put('/api/config', (req: Request, res: Response) => {
    const incoming = req.body as Partial<GalleryDlConfig>;
    appState.config = {
      ...appState.config,
      baseDirectory: incoming.baseDirectory?.trim() || './downloads',
      directoryTemplate: incoming.directoryTemplate?.trim() || '{category}/{manga}/c{chapter:03d}',
      filenameTemplate: incoming.filenameTemplate?.trim() || '{num:03d}.{extension}',
      sleepRequest: Math.max(0, Math.min(30, Number(incoming.sleepRequest ?? 0.5) || 0)),
      retries: Math.max(0, Math.min(20, Math.floor(Number(incoming.retries ?? 4) || 0))),
      writeMetadata: Boolean(incoming.writeMetadata),
      ugoiraConvert: Boolean(incoming.ugoiraConvert),
      userAgent: incoming.userAgent?.trim() || DEFAULT_CONFIG.userAgent,
      proxyUrl: incoming.proxyUrl?.trim() || '',
      cookiesPath: incoming.cookiesPath?.trim() || '',
    };
    writeConfigDisk(appState.config);
    saveState(appState);
    res.json({ config: appState.config, configJson: buildGalleryDlConfigJson(appState.config) });
  });

  app.get('/api/chapters/:chapterId/cbz', (req: Request, res: Response) => {
    const chapter = appState.chapters.find((c) => c.id === req.params.chapterId);
    if (!chapter) {
      res.status(404).json({ error: 'Chapter not found' });
      return;
    }
    const rel = chapter.directoryPath.replace(/^\.\/downloads\/?/, '');
    const absDir = path.resolve(DOWNLOADS_ROOT, rel);
    const entries: Array<{ filename: string; data: Buffer }> = [];
    for (const p of chapter.pages) {
      const full = path.join(absDir, p.filename);
      if (fs.existsSync(full)) {
        entries.push({ filename: p.filename, data: fs.readFileSync(full) });
      }
    }

    const cbzBuf = createCbzBuffer(entries);
    const safeFile = `${sanitizeSegment(chapter.seriesTitle)} - Ch.${String(chapter.chapterNumber).padStart(3, '0')}.cbz`;
    res.setHeader('Content-Type', 'application/vnd.comicbook+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFile}"`);
    res.send(cbzBuf);
  });

  const distPath = path.resolve(__dirname, 'dist');
  if (fs.existsSync(distPath) && fs.existsSync(path.join(distPath, 'index.html'))) {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch {
      app.use(express.static(distPath));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`  KomaDL is running! Open in your browser:`);
    console.log(`  --> http://localhost:${PORT}`);
    console.log(`======================================================\n`);
  });
}

startServer().catch((err) => {
  console.error('Failed starting KomaDL server:', err);
  process.exit(1);
});
