import React, { useMemo, useState } from 'react';
import { BookOpen, Download, MoveHorizontal, Search, Trash2 } from 'lucide-react';
import type { MangaChapter, MangaSeries, SampleFeedPreset } from '../types';
import { Button, Input, MangaImage, Select, Surface, formatBytes } from './ui';

type FilterMode = 'all' | 'reading' | 'unread' | 'completed';
type SortMode = 'recent' | 'title' | 'size';

interface LibraryViewProps {
  seriesList: MangaSeries[];
  presets: SampleFeedPreset[];
  onOpenChapter: (chapter: MangaChapter, forceWide?: boolean) => void;
  onQuickDownload: (url: string, preset?: SampleFeedPreset) => Promise<void>;
  onDeleteChapter: (chapterId: string) => Promise<void>;
  onNavigateDownloader: () => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  seriesList,
  presets,
  onOpenChapter,
  onQuickDownload,
  onDeleteChapter,
  onNavigateDownloader,
}) => {
  const [quickUrl, setQuickUrl] = useState<string>('');
  const [quickBusy, setQuickBusy] = useState<boolean>(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleQuickSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = quickUrl.trim();
    if (!trimmed) {
      onNavigateDownloader();
      return;
    }
    setQuickError(null);
    setQuickBusy(true);
    try {
      const matchedPreset = presets.find((p) => p.url === trimmed);
      await onQuickDownload(trimmed, matchedPreset);
      setQuickUrl('');
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuickBusy(false);
    }
  };

  const filteredSeries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const matchesFilter = (s: MangaSeries): boolean => {
      if (filterMode === 'all') return true;
      const totalPages = s.chapters.reduce((acc, c) => acc + c.pageCount, 0);
      const readPages = s.chapters.reduce((acc, c) => acc + c.readPage, 0);
      if (filterMode === 'unread') return readPages === 0;
      if (filterMode === 'completed') return totalPages > 0 && readPages >= totalPages;
      if (filterMode === 'reading') return readPages > 0 && readPages < totalPages;
      return true;
    };

    return seriesList
      .filter((s) => {
        if (!matchesFilter(s)) return false;
        if (!q) return true;
        return (
          s.title.toLowerCase().includes(q) ||
          s.author.toLowerCase().includes(q) ||
          s.extractor.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortMode === 'title') return a.title.localeCompare(b.title);
        if (sortMode === 'size') return b.totalBytes - a.totalBytes;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [filterMode, searchQuery, seriesList, sortMode]);

  return (
    <div className="space-y-6">
      {/* Quick URL Extractor Strip — Direct First-Screen Action */}
      <Surface className="p-4 sm:p-5">
        <form onSubmit={(e) => void handleQuickSubmit(e)} className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label htmlFor="quick-gallery-url" className="sr-only">
              Paste gallery-dl or manga chapter URL
            </label>
            <Input
              id="quick-gallery-url"
              value={quickUrl}
              onChange={(e) => setQuickUrl(e.target.value)}
              placeholder="Paste MangaDex chapter, gallery page, or direct image URL to download locally…"
              className="flex-1 font-mono text-label"
            />
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button type="submit" disabled={quickBusy}>
                <Download className="h-4 w-4" />
                {quickBusy ? 'Extracting…' : 'Download to shelf'}
              </Button>
              <Button tone="quiet" onClick={onNavigateDownloader}>
                Advanced options
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted">
            <div className="flex flex-wrap items-center gap-2">
              <span>One-click sample chapter feeds:</span>
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={quickBusy}
                  onClick={() => {
                    setQuickError(null);
                    setQuickBusy(true);
                    void onQuickDownload(preset.url, preset).finally(() => setQuickBusy(false));
                  }}
                  className="rounded-control border border-border bg-background px-2.5 py-1 text-caption font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  + {preset.label}
                </button>
              ))}
            </div>
            <span>Saved to <code className="font-mono text-foreground">./downloads</code></span>
          </div>

          {quickError ? (
            <p role="alert" className="text-caption text-danger">
              {quickError}
            </p>
          ) : null}
        </form>
      </Surface>

      {/* Filter Controls & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter manga shelf" className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'all', label: 'All series' },
              { id: 'reading', label: 'In progress' },
              { id: 'unread', label: 'Unread' },
              { id: 'completed', label: 'Completed' },
            ] as Array<{ id: FilterMode; label: string }>
          ).map((chip) => {
            const active = filterMode === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setFilterMode(chip.id)}
                className={`min-h-10 whitespace-nowrap rounded-control border px-3.5 text-label font-medium transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-surface text-foreground hover:bg-surface-elevated'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-initial">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <label htmlFor="library-search" className="sr-only">
              Filter downloaded manga
            </label>
            <Input
              id="library-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, tag, extractor…"
              className="min-h-10 pl-9 text-label"
            />
          </div>

          <div className="w-40 shrink-0">
            <label htmlFor="library-sort" className="sr-only">
              Sort manga shelf
            </label>
            <Select
              id="library-sort"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="min-h-10 text-label"
            >
              <option value="recent">Sort: Recent</option>
              <option value="title">Sort: Title A–Z</option>
              <option value="size">Sort: Disk size</option>
            </Select>
          </div>
        </div>
      </div>

      {/* Downloaded Manga Series Grid */}
      {filteredSeries.length === 0 ? (
        <Surface className="p-8 text-center">
          <h2 className="text-title text-foreground">No matching manga chapters on shelf</h2>
          <p className="mt-1.5 text-body text-muted">
            Clear the active filter or paste a URL above to extract a chapter into <code className="font-mono text-foreground">./downloads</code>.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {filterMode !== 'all' || searchQuery ? (
              <Button
                tone="quiet"
                onClick={() => {
                  setFilterMode('all');
                  setSearchQuery('');
                }}
              >
                Show all downloaded series
              </Button>
            ) : null}
            <Button onClick={onNavigateDownloader}>Open URL extractor</Button>
          </div>
        </Surface>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {filteredSeries.map((series) => {
            const primaryChapter =
              series.chapters.find((c) => c.readPage > 0 && c.readPage < c.pageCount) ||
              series.chapters[0];
            const totalPages = series.chapters.reduce((sum, c) => sum + c.pageCount, 0);
            const readPages = series.chapters.reduce((sum, c) => sum + c.readPage, 0);

            const statusText =
              readPages === 0
                ? 'Unread'
                : readPages >= totalPages
                  ? 'Completed'
                  : `Reading ${readPages}/${totalPages}`;
            const statusTone =
              readPages === 0
                ? 'text-muted'
                : readPages >= totalPages
                  ? 'text-success'
                  : 'text-primary';

            return (
              <Surface key={series.id} className="flex flex-col overflow-hidden">
                {/* Cover + Core Metadata Header */}
                <div className="grid grid-cols-1 sm:grid-cols-12">
                  <div className="sm:col-span-5 bg-background border-b sm:border-b-0 sm:border-r border-border">
                    <button
                      type="button"
                      onClick={() => primaryChapter && onOpenChapter(primaryChapter, true)}
                      className="group relative block w-full h-full text-left focus-visible:outline-2 focus-visible:outline-primary"
                      aria-label={`Read ${series.title} in wide view`}
                    >
                      <MangaImage
                        src={series.coverUrl}
                        alt={`${series.title} cover artwork`}
                        fallbackTitle={series.title}
                        className="aspect-[3/4] w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.015]"
                      />
                    </button>
                  </div>

                  <div className="sm:col-span-7 flex min-w-0 flex-col justify-between p-4 sm:p-5">
                    <div className="min-w-0 space-y-2">
                      <h2 className="text-title text-foreground">{series.title}</h2>
                      <p className="text-caption text-muted">
                        {series.author} · {series.extractor}
                      </p>

                      {/* Quiet metadata joined by middle dot per Section 0 Rule 3 */}
                      <p className="text-caption text-muted tabular-nums">
                        <span className={`font-medium ${statusTone}`}>{statusText}</span>
                        {' · '}
                        {series.chapters.length} {series.chapters.length === 1 ? 'ch' : 'chs'}
                        {' · '}
                        {totalPages} pages
                        {' · '}
                        {formatBytes(series.totalBytes)}
                      </p>

                      {series.tags.length > 0 ? (
                        <p className="text-caption text-muted">
                          {series.tags.join(' · ')}
                        </p>
                      ) : null}
                    </div>

                    {primaryChapter ? (
                      <div className="mt-4 flex flex-wrap gap-2 pt-3 border-t border-border">
                        <Button
                          tone="primary"
                          onClick={() => onOpenChapter(primaryChapter, true)}
                          className="min-h-10 px-3.5 text-caption flex-1"
                          title="Open chapter in Wide Cover mode so pages fill the screen"
                        >
                          <MoveHorizontal className="h-4 w-4" />
                          Read wide
                        </Button>
                        <Button
                          tone="quiet"
                          onClick={() => onOpenChapter(primaryChapter, false)}
                          className="min-h-10 px-3 text-caption"
                          title="Open chapter in reader"
                        >
                          <BookOpen className="h-4 w-4" />
                          Ch. {primaryChapter.chapterNumber}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Chapter List on Parent Surface with 1px Hairline Dividers (Section 0 Rule 4) */}
                <div className="border-t border-border divide-y divide-border">
                  {series.chapters.map((ch) => {
                    const isConfirming = confirmDeleteId === ch.id;
                    return (
                      <div
                        key={ch.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-caption"
                      >
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => onOpenChapter(ch, false)}
                            className="block max-w-full truncate text-left text-label font-medium text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                            title={`Ch. ${ch.chapterNumber} — ${ch.chapterTitle}`}
                          >
                            Ch. {ch.chapterNumber} — {ch.chapterTitle}
                          </button>
                          <p className="mt-0.5 truncate text-caption text-muted tabular-nums" title={ch.directoryPath}>
                            {ch.pageCount} pages · {formatBytes(ch.totalBytes)} ·{' '}
                            {ch.readPage === 0
                              ? 'Unread'
                              : ch.readPage >= ch.pageCount
                                ? 'Finished'
                                : `Page ${ch.readPage}/${ch.pageCount}`}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isConfirming ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmDeleteId(null);
                                  void onDeleteChapter(ch.id);
                                }}
                                className="min-h-8 rounded-control border border-border bg-background px-2.5 text-caption font-medium text-danger hover:bg-surface-elevated"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="min-h-8 rounded-control border border-border bg-background px-2.5 text-caption text-muted hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => onOpenChapter(ch, true)}
                                className="min-h-8 rounded-control border border-border bg-background px-2.5 text-caption font-medium text-foreground hover:border-primary hover:text-primary"
                                title="Read chapter in Wide Screen Cover mode"
                              >
                                Wide
                              </button>
                              <a
                                href={`/api/chapters/${encodeURIComponent(ch.id)}/cbz`}
                                download
                                className="inline-flex min-h-8 items-center rounded-control border border-border bg-background px-2 text-caption text-muted hover:text-foreground"
                                title="Export chapter as .cbz comic archive"
                                aria-label={`Download Chapter ${ch.chapterNumber} as CBZ`}
                              >
                                .cbz
                              </a>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(ch.id)}
                                className="inline-flex min-h-8 w-8 items-center justify-center rounded-control border border-transparent text-muted hover:border-border hover:text-danger"
                                aria-label={`Remove Chapter ${ch.chapterNumber} from disk`}
                                title="Remove chapter from ./downloads"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Surface>
            );
          })}
        </div>
      )}
    </div>
  );
};
