import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { BookOpen, Code2, Menu, X } from 'lucide-react';
import type {
  DownloadJob,
  EngineInfo,
  GalleryDlConfig,
  MangaChapter,
  MangaSeries,
  ReaderPreferences,
  SampleFeedPreset,
} from './types';
import { ConfigPanel } from './components/ConfigPanel';
import { DownloaderPanel } from './components/DownloaderPanel';
import { LibraryView } from './components/LibraryView';
import { MangaReader } from './components/MangaReader';
import { Button, formatBytes } from './components/ui';

type ActiveTab = 'library' | 'downloader' | 'config';

const PREFS_STORAGE_KEY = 'komadl.reader.prefs.v1';

const DEFAULT_PREFS: ReaderPreferences = {
  fitMode: 'wide',
  layoutMode: 'single',
  direction: 'rtl',
  backgroundTone: 'pitch',
};

const FALLBACK_CONFIG: GalleryDlConfig = {
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

function loadReaderPrefs(): ReaderPreferences {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReaderPreferences>;
    const validFit =
      parsed.fitMode === 'wide' ||
      parsed.fitMode === 'cover-screen' ||
      parsed.fitMode === 'contain-height' ||
      parsed.fitMode === 'original'
        ? parsed.fitMode
        : 'wide';
    const validLayout =
      parsed.layoutMode === 'single' ||
      parsed.layoutMode === 'double' ||
      parsed.layoutMode === 'strip'
        ? parsed.layoutMode
        : 'single';
    const validDir = parsed.direction === 'ltr' || parsed.direction === 'rtl' ? parsed.direction : 'rtl';
    const validBg =
      parsed.backgroundTone === 'pitch' ||
      parsed.backgroundTone === 'ink' ||
      parsed.backgroundTone === 'paper'
        ? parsed.backgroundTone
        : 'pitch';
    return {
      fitMode: validFit,
      layoutMode: validLayout,
      direction: validDir,
      backgroundTone: validBg,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('library');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const [seriesList, setSeriesList] = useState<MangaSeries[]>([]);
  const [presets, setPresets] = useState<SampleFeedPreset[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [config, setConfig] = useState<GalleryDlConfig>(FALLBACK_CONFIG);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  const [activeReaderChapterId, setActiveReaderChapterId] = useState<string | null>(null);
  const [readerPrefs, setReaderPrefs] = useState<ReaderPreferences>(() => loadReaderPrefs());

  const progressTimerRef = useRef<number | null>(null);

  const fetchLibrary = useCallback(async () => {
    try {
      const resp = await fetch('/api/library');
      if (!resp.ok) {
        throw new Error(`Server responded with HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as {
        series: MangaSeries[];
        presets: SampleFeedPreset[];
        engine: EngineInfo;
        config: GalleryDlConfig;
        jobs: DownloadJob[];
      };
      setSeriesList(data.series || []);
      setPresets(data.presets || []);
      setEngine(data.engine || null);
      if (data.config) setConfig(data.config);
      setJobs(data.jobs || []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  const hasRunningJobs = useMemo(
    () => jobs.some((j) => j.status === 'queued' || j.status === 'running'),
    [jobs]
  );

  useEffect(() => {
    if (!hasRunningJobs) return;
    const id = window.setInterval(() => {
      void fetchLibrary();
    }, 900);
    return () => window.clearInterval(id);
  }, [fetchLibrary, hasRunningJobs]);

  const allChapters = useMemo(() => {
    const map = new Map<string, MangaChapter>();
    for (const s of seriesList) {
      for (const ch of s.chapters) {
        map.set(ch.id, ch);
      }
    }
    return map;
  }, [seriesList]);

  const activeChapter = activeReaderChapterId ? allChapters.get(activeReaderChapterId) || null : null;

  const continueChapter = useMemo(() => {
    for (const s of seriesList) {
      const inProgress = s.chapters.find((c) => c.readPage > 0 && c.readPage < c.pageCount);
      if (inProgress) return inProgress;
    }
    return seriesList[0]?.chapters[0] || null;
  }, [seriesList]);

  const updateReaderPrefs = useCallback((patch: Partial<ReaderPreferences>) => {
    setReaderPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  }, []);

  const handleOpenChapter = useCallback(
    (chapter: MangaChapter, forceWide?: boolean) => {
      if (forceWide) {
        updateReaderPrefs({ fitMode: 'wide' });
      }
      setActiveReaderChapterId(chapter.id);
    },
    [updateReaderPrefs]
  );

  const handlePageProgress = useCallback((chapterId: string, pageNumber: number) => {
    setSeriesList((prev) => {
      let changed = false;
      for (const s of prev) {
        const c = s.chapters.find((ch) => ch.id === chapterId);
        if (c && c.readPage !== pageNumber) {
          changed = true;
          break;
        }
      }
      if (!changed) return prev;
      return prev.map((s) => ({
        ...s,
        chapters: s.chapters.map((c) =>
          c.id === chapterId ? { ...c, readPage: pageNumber } : c
        ),
      }));
    });

    if (progressTimerRef.current) {
      window.clearTimeout(progressTimerRef.current);
    }
    progressTimerRef.current = window.setTimeout(() => {
      void fetch(`/api/chapters/${encodeURIComponent(chapterId)}/progress`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readPage: pageNumber }),
      }).catch(() => undefined);
    }, 400);
  }, []);

  const handleStartDownload = useCallback(
    async (payload: {
      url: string;
      seriesTitle?: string;
      chapterNumber?: number;
      pageRange?: string;
      extraArgs?: string;
    }) => {
      const resp = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await resp.json()) as { error?: string; jobs?: DownloadJob[] };
      if (!resp.ok) {
        throw new Error(json.error || 'Failed starting extraction job.');
      }
      setStatusLine(
        `Queued ${json.jobs?.length || 1} extraction job${(json.jobs?.length || 1) > 1 ? 's' : ''} into ./downloads.`
      );
      await fetchLibrary();
    },
    [fetchLibrary]
  );

  const handleQuickDownload = useCallback(
    async (url: string, preset?: SampleFeedPreset) => {
      await handleStartDownload({
        url,
        seriesTitle: preset?.seriesTitle,
        chapterNumber: preset?.chapterNumber,
      });
      window.setTimeout(() => {
        void fetchLibrary();
      }, 650);
    },
    [fetchLibrary, handleStartDownload]
  );

  const handleImportLocalFiles = useCallback(
    async (payload: {
      seriesTitle: string;
      chapterNumber: number;
      chapterTitle: string;
      files: Array<{ name: string; dataUrl: string; isSpread?: boolean }>;
    }): Promise<MangaChapter | null> => {
      const resp = await fetch('/api/library/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await resp.json()) as { error?: string; chapter?: MangaChapter };
      if (!resp.ok) {
        throw new Error(json.error || 'Failed importing local manga pages.');
      }
      await fetchLibrary();
      if (json.chapter) {
        setStatusLine(`Imported ${json.chapter.seriesTitle} · Ch. ${json.chapter.chapterNumber}.`);
      }
      return json.chapter || null;
    },
    [fetchLibrary]
  );

  const handleDeleteChapter = useCallback(
    async (chapterId: string) => {
      const target = allChapters.get(chapterId);
      const resp = await fetch(`/api/chapters/${encodeURIComponent(chapterId)}`, {
        method: 'DELETE',
      });
      if (!resp.ok) {
        const json = (await resp.json().catch(() => ({}))) as { error?: string };
        setLoadError(json.error || 'Could not delete chapter.');
        return;
      }
      if (activeReaderChapterId === chapterId) {
        setActiveReaderChapterId(null);
      }
      setStatusLine(
        target
          ? `Removed '${target.seriesTitle} · Ch. ${target.chapterNumber}' from ./downloads.`
          : 'Removed chapter from ./downloads.'
      );
      await fetchLibrary();
    },
    [activeReaderChapterId, allChapters, fetchLibrary]
  );

  const handleSaveConfig = useCallback(
    async (next: GalleryDlConfig) => {
      const resp = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const json = (await resp.json()) as { error?: string; config?: GalleryDlConfig };
      if (!resp.ok) {
        throw new Error(json.error || 'Could not save gallery-dl.conf.');
      }
      if (json.config) setConfig(json.config);
      await fetchLibrary();
    },
    [fetchLibrary]
  );

  const handleResetLibrary = useCallback(async () => {
    const resp = await fetch('/api/library/reset', { method: 'POST' });
    if (resp.ok) {
      setStatusLine('Restored initial manga archive in ./downloads.');
      await fetchLibrary();
    }
  }, [fetchLibrary]);

  const handleRetryJob = useCallback(
    async (jobId: string) => {
      const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
        method: 'POST',
      });
      if (resp.ok) {
        setStatusLine('Re-queued extraction job.');
        await fetchLibrary();
      }
    },
    [fetchLibrary]
  );

  const handleClearFailedJobs = useCallback(async () => {
    const resp = await fetch('/api/jobs/failed', { method: 'DELETE' });
    if (resp.ok) {
      await fetchLibrary();
    }
  }, [fetchLibrary]);

  const siblingChapters = useMemo(() => {
    if (!activeChapter) return [];
    const parent = seriesList.find((s) => s.id === activeChapter.seriesId);
    return parent ? parent.chapters : [activeChapter];
  }, [activeChapter, seriesList]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh bg-background text-foreground flex flex-col">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex w-full max-w-[96rem] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={() => setActiveTab('library')}
                className="whitespace-nowrap shrink-0 text-title font-semibold tracking-tight text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              >
                KomaDL
              </button>

              <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
                {(
                  [
                    { id: 'library', label: 'Library' },
                    { id: 'downloader', label: `Downloader${hasRunningJobs ? ' (active)' : ''}` },
                    { id: 'config', label: 'gallery-dl.conf' },
                  ] as Array<{ id: ActiveTab; label: string }>
                ).map((item) => {
                  const isCurrent = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={`min-h-10 whitespace-nowrap shrink-0 rounded-control px-3.5 text-label font-medium transition-colors ${
                        isCurrent
                          ? 'bg-background text-foreground border border-border'
                          : 'text-muted hover:text-foreground'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center gap-2.5">
              <a
                href="/api/source-code.zip"
                download="komadl-local-project.zip"
                className="hidden sm:inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-control border border-border bg-background px-3.5 text-label font-medium text-foreground hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-primary"
                title="Download complete KomaDL project source code (.zip) to run locally"
              >
                <Code2 className="h-4 w-4" />
                Download source (.zip)
              </a>

              {continueChapter ? (
                <Button
                  tone="primary"
                  onClick={() => handleOpenChapter(continueChapter, true)}
                  className="min-h-10 px-3.5 text-label"
                >
                  <BookOpen className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    Read {continueChapter.seriesTitle} · Ch. {continueChapter.chapterNumber}
                  </span>
                  <span className="sm:hidden">Open reader</span>
                </Button>
              ) : null}

              <button
                type="button"
                onClick={() => setMobileMenuOpen((v) => !v)}
                aria-expanded={mobileMenuOpen}
                aria-label="Toggle navigation menu"
                className="inline-flex md:hidden min-h-10 w-10 items-center justify-center rounded-control border border-border bg-background text-foreground"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {mobileMenuOpen ? (
            <nav aria-label="Mobile navigation" className="border-t border-border px-4 py-3 md:hidden">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: 'library', label: 'Library' },
                    { id: 'downloader', label: 'Downloader' },
                    { id: 'config', label: 'gallery-dl.conf' },
                  ] as Array<{ id: ActiveTab; label: string }>
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`min-h-10 whitespace-nowrap rounded-control px-3.5 text-label font-medium ${
                      activeTab === item.id
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border bg-background text-foreground'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
                <a
                  href="/api/source-code.zip"
                  download="komadl-local-project.zip"
                  className="inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-control border border-border bg-background px-3.5 text-label font-medium text-foreground"
                >
                  <Code2 className="h-4 w-4" />
                  Download source (.zip)
                </a>
              </div>
            </nav>
          ) : null}
        </header>

        <main className="mx-auto w-full max-w-[96rem] flex-1 px-4 py-6 sm:px-6 lg:px-8 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
            <div className="min-w-0 space-y-1">
              <h1 className="text-display text-foreground">
                {activeTab === 'library'
                  ? 'Local manga archive & wide reader'
                  : activeTab === 'downloader'
                    ? 'URL extractor & local page import'
                    : 'gallery-dl archive settings'}
              </h1>
              <p className="text-body text-muted max-w-[54em]">
                {activeTab === 'library'
                  ? 'Extract chapters locally to ./downloads and read any downloaded series with native Fullscreen [F] and edge-to-edge Wide screen cover [W].'
                  : activeTab === 'downloader'
                    ? 'Download chapters from MangaDex, HTML galleries, or direct image URLs, or import manga folders from your browser.'
                    : 'Customize directory naming templates, request pacing, and metadata postprocessors.'}
              </p>
            </div>

            {engine ? (
              <p className="text-label text-muted tabular-nums">
                {engine.totalSeries} series · {engine.totalChapters} chapters · {engine.totalPages} pages ·{' '}
                {formatBytes(engine.totalBytes)} on disk
              </p>
            ) : null}
          </div>

          {loadError ? (
            <div role="alert" className="rounded-control border border-border bg-surface px-4 py-3 text-label text-danger">
              Connection error: {loadError}
            </div>
          ) : null}

          {statusLine ? (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface px-4 py-2.5 text-label text-foreground"
            >
              <span>{statusLine}</span>
              <button
                type="button"
                onClick={() => setStatusLine(null)}
                className="text-caption text-muted hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {activeTab === 'library' ? (
            <LibraryView
              seriesList={seriesList}
              presets={presets}
              onOpenChapter={handleOpenChapter}
              onQuickDownload={handleQuickDownload}
              onDeleteChapter={handleDeleteChapter}
              onNavigateDownloader={() => setActiveTab('downloader')}
            />
          ) : activeTab === 'downloader' ? (
            <DownloaderPanel
              config={config}
              presets={presets}
              jobs={jobs}
              chaptersById={allChapters}
              onStartDownload={handleStartDownload}
              onImportLocalFiles={handleImportLocalFiles}
              onOpenChapter={handleOpenChapter}
              onRetryJob={handleRetryJob}
              onClearFailedJobs={handleClearFailedJobs}
            />
          ) : (
            <ConfigPanel
              config={config}
              engine={engine}
              onSaveConfig={handleSaveConfig}
              onResetLibrary={handleResetLibrary}
            />
          )}
        </main>

        {activeChapter ? (
          <MangaReader
            chapter={activeChapter}
            siblingChapters={siblingChapters}
            preferences={readerPrefs}
            onUpdatePreferences={updateReaderPrefs}
            onSelectChapter={(ch) => setActiveReaderChapterId(ch.id)}
            onPageProgress={handlePageProgress}
            onClose={() => setActiveReaderChapterId(null)}
          />
        ) : null}
      </div>
    </MotionConfig>
  );
}
