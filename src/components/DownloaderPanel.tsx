import React, { useMemo, useRef, useState } from 'react';
import { BookOpen, Check, Copy, Download, FolderUp, Terminal } from 'lucide-react';
import type {
  DownloadJob,
  GalleryDlConfig,
  MangaChapter,
  SampleFeedPreset,
} from '../types';
import { buildGalleryDlCommand } from '../utils/galleryDl';
import { Button, Field, Input, Surface, formatBytes } from './ui';

interface DownloaderPanelProps {
  config: GalleryDlConfig;
  presets: SampleFeedPreset[];
  jobs: DownloadJob[];
  chaptersById: Map<string, MangaChapter>;
  onStartDownload: (payload: {
    url: string;
    seriesTitle?: string;
    chapterNumber?: number;
    pageRange?: string;
    extraArgs?: string;
  }) => Promise<void>;
  onImportLocalFiles: (payload: {
    seriesTitle: string;
    chapterNumber: number;
    chapterTitle: string;
    files: Array<{ name: string; dataUrl: string; isSpread?: boolean }>;
  }) => Promise<MangaChapter | null>;
  onOpenChapter: (chapter: MangaChapter, forceWide?: boolean) => void;
  onRetryJob: (jobId: string) => Promise<void>;
  onClearFailedJobs: () => Promise<void>;
}

export const DownloaderPanel: React.FC<DownloaderPanelProps> = ({
  config,
  presets,
  jobs,
  chaptersById,
  onStartDownload,
  onImportLocalFiles,
  onOpenChapter,
  onRetryJob,
  onClearFailedJobs,
}) => {
  const [urlInput, setUrlInput] = useState<string>(presets[0]?.url || '');
  const [seriesOverride, setSeriesOverride] = useState<string>('');
  const [chapterOverride, setChapterOverride] = useState<string>('');
  const [pageRange, setPageRange] = useState<string>('');
  const [extraArgs, setExtraArgs] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);
  const [expandedJobLogs, setExpandedJobLogs] = useState<Record<string, boolean>>({});

  // Local browser import state
  const [importSeries, setImportSeries] = useState<string>('');
  const [importChapter, setImportChapter] = useState<string>('1');
  const [importTitle, setImportTitle] = useState<string>('');
  const [importing, setImporting] = useState<boolean>(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const commandPreview = useMemo(
    () =>
      buildGalleryDlCommand({
        url: urlInput,
        config,
        pageRange,
        chapterOverride: chapterOverride ? Number(chapterOverride) : undefined,
        seriesOverride,
        extraArgs,
      }),
    [chapterOverride, config, extraArgs, pageRange, seriesOverride, urlInput]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) {
      setFormError('Paste at least one gallery, MangaDex chapter, or image URL.');
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      await onStartDownload({
        url: urlInput,
        seriesTitle: seriesOverride.trim() || undefined,
        chapterNumber: chapterOverride ? Math.max(1, Number(chapterOverride)) : undefined,
        pageRange: pageRange.trim() || undefined,
        extraArgs: extraArgs.trim() || undefined,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(commandPreview);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      // ignore clipboard permissions error
    }
  };

  const handleLocalFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setImporting(true);
    setImportMessage(null);
    try {
      const imageFiles = Array.from(fileList).filter((f) =>
        /\.(jpe?g|png|webp|gif|svg|avif)$/i.test(f.name)
      );
      if (imageFiles.length === 0) {
        setImportMessage('No image files (.jpg, .png, .webp, .svg) found in selection.');
        setImporting(false);
        return;
      }

      const encoded = await Promise.all(
        imageFiles.map(
          (file) =>
            new Promise<{ name: string; dataUrl: string; isSpread?: boolean }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = String(reader.result || '');
                const img = new Image();
                img.onload = () => {
                  resolve({
                    name: file.name,
                    dataUrl,
                    isSpread: img.naturalWidth > img.naturalHeight * 1.15,
                  });
                };
                img.onerror = () => resolve({ name: file.name, dataUrl, isSpread: false });
                img.src = dataUrl;
              };
              reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
              reader.readAsDataURL(file);
            })
        )
      );

      const inferredSeries =
        importSeries.trim() ||
        imageFiles[0].webkitRelativePath?.split('/')[0] ||
        'Local Browser Import';
      const chNum = Math.max(1, Math.floor(Number(importChapter) || 1));

      const created = await onImportLocalFiles({
        seriesTitle: inferredSeries,
        chapterNumber: chNum,
        chapterTitle: importTitle.trim() || `Imported (${encoded.length} pages)`,
        files: encoded,
      });

      if (created) {
        setImportMessage(
          `Archived ${created.pageCount} pages into ${created.directoryPath}.`
        );
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
      {/* Left 7 cols: Extractor Job Composer & CLI Preview */}
      <div className="min-w-0 space-y-6 lg:col-span-7">
        <Surface className="p-5 sm:p-6">
          <div className="space-y-5">
            <div>
              <h2 className="text-title text-foreground">Extract gallery or manga URL</h2>
              <p className="mt-1 text-label text-muted">
                Queue MangaDex chapters, HTML image galleries, direct image URLs, or pick a local feed below to test extraction into <span className="font-mono text-foreground">./downloads</span>.
              </p>
            </div>

            {/* Interactive Preset Chips (Controls per Section 0 Rule 3) */}
            <div className="space-y-2">
              <span className="text-caption text-muted">Load local test gallery feed:</span>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => {
                  const active = urlInput.trim() === preset.url;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setUrlInput(preset.url);
                        setSeriesOverride(preset.seriesTitle);
                        setChapterOverride(String(preset.chapterNumber));
                        setFormError(null);
                      }}
                      className={`min-h-9 rounded-control border px-3 py-1.5 text-caption font-medium transition-colors ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-foreground hover:bg-surface-elevated'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 border-t border-border pt-4">
              <Field
                label="Target URLs (one per line for batch extraction)"
                hint="Supports MangaDex chapter URLs, gallery pages, or direct images"
                htmlFor="dl-url-input"
              >
                <textarea
                  id="dl-url-input"
                  rows={3}
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://mangadex.org/chapter/..."
                  className="w-full min-w-0 rounded-control border border-border bg-background p-3 font-mono text-label text-foreground placeholder:text-muted/60 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-primary"
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Series folder override" hint="Optional" htmlFor="dl-series-override">
                  <Input
                    id="dl-series-override"
                    value={seriesOverride}
                    onChange={(e) => setSeriesOverride(e.target.value)}
                    placeholder="Auto-detect"
                  />
                </Field>

                <Field label="Chapter number" hint="Optional" htmlFor="dl-chapter-override">
                  <Input
                    id="dl-chapter-override"
                    type="number"
                    min={1}
                    max={9999}
                    step={1}
                    value={chapterOverride}
                    onChange={(e) => setChapterOverride(e.target.value)}
                    placeholder="Auto"
                  />
                </Field>

                <Field label="Page range (--range)" hint="e.g. 1-4" htmlFor="dl-page-range">
                  <Input
                    id="dl-page-range"
                    value={pageRange}
                    onChange={(e) => setPageRange(e.target.value)}
                    placeholder="All pages"
                  />
                </Field>
              </div>

              <Field
                label="Additional gallery-dl flags"
                hint="Appended to generated CLI command"
                htmlFor="dl-extra-args"
              >
                <Input
                  id="dl-extra-args"
                  value={extraArgs}
                  onChange={(e) => setExtraArgs(e.target.value)}
                  placeholder="--chapter-filter 'lang == en'"
                  className="font-mono text-label"
                />
              </Field>

              {/* Recessed interactive CLI preview well (allowed inset per Section 0 Rule 4) */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-caption font-medium text-muted">
                    <Terminal className="h-3.5 w-3.5" />
                    Equivalent gallery-dl command
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyCommand()}
                    className="inline-flex items-center gap-1 text-caption font-medium text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {copiedCmd ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedCmd ? 'Copied' : 'Copy command'}
                  </button>
                </div>
                <Surface inset className="p-3.5">
                  <code className="block break-all font-mono text-caption leading-relaxed text-foreground">
                    {commandPreview}
                  </code>
                </Surface>
              </div>

              {formError ? (
                <p role="alert" className="text-label text-danger">
                  {formError}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-caption text-muted">
                  Destination: <span className="font-mono text-foreground">{config.baseDirectory}/{config.directoryTemplate}</span>
                </span>
                <Button type="submit" disabled={busy}>
                  <Download className="h-4 w-4" />
                  {busy ? 'Queueing extraction…' : 'Start download'}
                </Button>
              </div>
            </form>
          </div>
        </Surface>

        {/* Local Disk / Browser Folder Import */}
        <Surface className="p-5 sm:p-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-title text-foreground">Import local manga pages from browser</h2>
              <p className="mt-1 text-label text-muted">
                Already ran <span className="font-mono text-foreground">gallery-dl</span> in your terminal? Select page images from any folder on your machine to copy into this library and read in Fullscreen Wide view.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Series title" htmlFor="imp-series">
                <Input
                  id="imp-series"
                  value={importSeries}
                  onChange={(e) => setImportSeries(e.target.value)}
                  placeholder="Iron Rail Nocturne"
                />
              </Field>
              <Field label="Chapter" htmlFor="imp-chapter">
                <Input
                  id="imp-chapter"
                  type="number"
                  min={1}
                  max={9999}
                  step={1}
                  value={importChapter}
                  onChange={(e) => setImportChapter(e.target.value)}
                />
              </Field>
              <Field label="Chapter subtitle" htmlFor="imp-title">
                <Input
                  id="imp-title"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                  placeholder="Optional title"
                />
              </Field>
            </div>

            {/* Recessed interactive file dropzone (allowed inset per Section 0 Rule 4) */}
            <Surface inset className="p-5 text-center">
              <input
                ref={fileInputRef}
                id="local-manga-files"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => void handleLocalFilesSelected(e.target.files)}
                className="sr-only"
              />
              <FolderUp className="mx-auto h-6 w-6 text-muted" />
              <p className="mt-2 text-label font-medium text-foreground">
                Select downloaded manga page images (.jpg, .png, .webp, .svg)
              </p>
              <p className="mt-1 text-caption text-muted">
                Pages sort naturally by filename (001.jpg, 002.jpg…) and detect double spreads automatically.
              </p>
              <div className="mt-4">
                <Button
                  tone="quiet"
                  disabled={importing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {importing ? 'Importing pages…' : 'Choose image files'}
                </Button>
              </div>
            </Surface>

            {importMessage ? (
              <p role="status" className="text-label text-success">
                {importMessage}
              </p>
            ) : null}
          </div>
        </Surface>
      </div>

      {/* Right 5 cols: Active & Completed Download Queue */}
      <div className="min-w-0 lg:col-span-5 lg:sticky lg:self-start lg:top-6">
        <Surface className="p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-border">
            <h2 className="text-title text-foreground">Extraction queue</h2>
            <div className="flex items-center gap-3">
              {jobs.some((j) => j.status === 'failed') ? (
                <button
                  type="button"
                  onClick={() => void onClearFailedJobs()}
                  className="text-caption font-medium text-muted hover:text-foreground"
                >
                  Clear failed
                </button>
              ) : null}
              <span className="text-caption text-muted tabular-nums">
                {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} recorded
              </span>
            </div>
          </div>

          {jobs.length === 0 ? (
            <p className="py-8 text-label text-muted">
              No extraction jobs yet. Paste a gallery URL or select a test feed on the left to start downloading.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {jobs.map((job) => {
                const linkedChapter = job.outputChapterId
                  ? chaptersById.get(job.outputChapterId)
                  : undefined;
                const progressPct =
                  job.totalPages > 0
                    ? Math.min(100, Math.round((job.downloadedPages / job.totalPages) * 100))
                    : job.status === 'completed'
                      ? 100
                      : 15;
                const isExpanded = Boolean(expandedJobLogs[job.id]);
                const visibleLogs = isExpanded ? job.logs : job.logs.slice(-4);

                const statusColor =
                  job.status === 'completed'
                    ? 'text-success'
                    : job.status === 'failed'
                      ? 'text-danger'
                      : 'text-warning';

                return (
                  <div key={job.id} className="py-4 first:pt-4 last:pb-0 space-y-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="min-w-0 truncate text-label font-semibold text-foreground" title={job.seriesTitle}>
                        {job.seriesTitle} · Ch. {job.chapterNumber}
                      </p>
                      <span className="text-caption text-muted tabular-nums">
                        <span className={`font-medium ${statusColor}`}>
                          {job.status === 'completed'
                            ? 'Completed'
                            : job.status === 'running'
                              ? 'Downloading'
                              : job.status === 'failed'
                                ? 'Failed'
                                : 'Queued'}
                        </span>
                        {' · '}
                        {job.extractor}
                        {' · '}
                        {job.downloadedPages}/{job.totalPages || '?'} pages
                        {job.bytesDownloaded > 0 ? ` · ${formatBytes(job.bytesDownloaded)}` : ''}
                      </span>
                    </div>

                    <p className="truncate font-mono text-caption text-muted" title={job.url}>
                      {job.url}
                    </p>

                    {/* Progress hairline bar */}
                    <div className="h-1.5 w-full overflow-hidden rounded-control bg-background">
                      <div
                        className={`h-full transition-[width] duration-200 ease-out ${
                          job.status === 'failed' ? 'bg-danger' : 'bg-primary'
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>

                    {job.error ? (
                      <p role="alert" className="text-caption text-danger">
                        {job.error}
                      </p>
                    ) : null}

                    {visibleLogs.length > 0 ? (
                      <div className="space-y-1 pt-1">
                        {visibleLogs.map((line, idx) => (
                          <p key={idx} className="break-all font-mono text-caption text-muted">
                            {line}
                          </p>
                        ))}
                        {job.logs.length > 4 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedJobLogs((prev) => ({
                                ...prev,
                                [job.id]: !isExpanded,
                              }))
                            }
                            className="text-caption font-medium text-foreground hover:text-primary"
                          >
                            {isExpanded ? 'Show fewer lines' : `Show all ${job.logs.length} log lines`}
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {linkedChapter ? (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          tone="primary"
                          onClick={() => onOpenChapter(linkedChapter, true)}
                          className="min-h-9 px-3 text-caption"
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                          Read in wide view
                        </Button>
                        <Button
                          tone="quiet"
                          onClick={() => onOpenChapter(linkedChapter, false)}
                          className="min-h-9 px-3 text-caption"
                        >
                          Open reader
                        </Button>
                      </div>
                    ) : job.status === 'failed' ? (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          tone="quiet"
                          onClick={() => void onRetryJob(job.id)}
                          className="min-h-9 px-3 text-caption"
                        >
                          Retry download
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
};
