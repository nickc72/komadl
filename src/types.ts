export interface MangaPage {
  index: number;
  filename: string;
  url: string;
  widthHint?: number;
  heightHint?: number;
  bytes: number;
  isSpread?: boolean;
}

export interface MangaChapter {
  id: string;
  seriesId: string;
  seriesTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  extractor: string;
  sourceUrl: string;
  directoryPath: string;
  downloadedAt: string;
  pageCount: number;
  totalBytes: number;
  readPage: number; // 0 = unread, 1..pageCount = last read 1-based page
  pages: MangaPage[];
}

export interface MangaSeries {
  id: string;
  title: string;
  author: string;
  extractor: string;
  tags: string[];
  coverUrl: string;
  updatedAt: string;
  totalBytes: number;
  chapters: MangaChapter[];
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface DownloadJob {
  id: string;
  url: string;
  seriesTitle: string;
  chapterNumber: number;
  extractor: string;
  status: JobStatus;
  commandPreview: string;
  createdAt: string;
  completedAt?: string;
  downloadedPages: number;
  totalPages: number;
  bytesDownloaded: number;
  outputChapterId?: string;
  error?: string;
  logs: string[];
}

export interface GalleryDlConfig {
  baseDirectory: string;
  filenameTemplate: string;
  directoryTemplate: string;
  sleepRequest: number;
  retries: number;
  writeMetadata: boolean;
  ugoiraConvert: boolean;
  userAgent: string;
  proxyUrl: string;
  cookiesPath: string;
}

export interface EngineInfo {
  galleryDlBinaryFound: boolean;
  galleryDlVersion: string | null;
  pythonVersion: string | null;
  archiveRoot: string;
  configPath: string;
  totalSeries: number;
  totalChapters: number;
  totalPages: number;
  totalBytes: number;
}

export type ReaderFitMode = 'wide' | 'contain-height' | 'cover-screen' | 'original';
export type ReaderLayoutMode = 'single' | 'double' | 'strip';
export type ReaderDirection = 'rtl' | 'ltr';

export interface ReaderPreferences {
  fitMode: ReaderFitMode;
  layoutMode: ReaderLayoutMode;
  direction: ReaderDirection;
  backgroundTone: 'pitch' | 'ink' | 'paper';
}

export interface SampleFeedPreset {
  id: string;
  label: string;
  seriesTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  extractor: string;
  url: string;
  pageCount: number;
  description: string;
}
