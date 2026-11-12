import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Maximize,
  Minimize,
  MoveHorizontal,
} from 'lucide-react';
import type {
  MangaChapter,
  ReaderDirection,
  ReaderFitMode,
  ReaderLayoutMode,
  ReaderPreferences,
} from '../types';
import { Button, MangaImage, Select, formatBytes } from './ui';

interface MangaReaderProps {
  chapter: MangaChapter;
  siblingChapters: MangaChapter[];
  preferences: ReaderPreferences;
  onUpdatePreferences: (patch: Partial<ReaderPreferences>) => void;
  onSelectChapter: (chapter: MangaChapter) => void;
  onPageProgress: (chapterId: string, pageNumber: number) => void;
  onClose: () => void;
}

const MangaReaderComponent: React.FC<MangaReaderProps> = ({
  chapter,
  siblingChapters,
  preferences,
  onUpdatePreferences,
  onSelectChapter,
  onPageProgress,
  onClose,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);

  const initialPage = useMemo(() => {
    if (chapter.readPage >= 1 && chapter.readPage <= chapter.pageCount) {
      return chapter.readPage;
    }
    return 1;
  }, [chapter.id, chapter.pageCount, chapter.readPage]);

  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState<boolean>(false);
  const [isImmersiveLock, setIsImmersiveLock] = useState<boolean>(false);
  const [hudVisible, setHudVisible] = useState<boolean>(true);
  const [isMouseActive, setIsMouseActive] = useState<boolean>(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleMouseMove = useCallback(() => {
    setIsMouseActive(true);
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      setIsMouseActive(false);
    }, 2500);
  }, []);

  useEffect(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      setIsMouseActive(false);
    }, 2500);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const start =
      chapter.readPage >= 1 && chapter.readPage <= chapter.pageCount ? chapter.readPage : 1;
    setCurrentPage(start);
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollTo({ top: 0, left: 0 });
    }
  }, [chapter.id]);

  useEffect(() => {
    onPageProgress(chapter.id, currentPage);
  }, [chapter.id, currentPage, onPageProgress]);

  // Track active page during smooth long-strip scrolling via IntersectionObserver (zero scroll jank)
  useEffect(() => {
    if (preferences.layoutMode !== 'strip') return;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    let rafId: number | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        let bestTarget: Element | null = null;
        let bestRatio = 0;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestTarget = entry.target;
          }
        }
        if (bestTarget) {
          const pageIdx = Number(bestTarget.getAttribute('data-page-index'));
          if (pageIdx) {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
              setCurrentPage((prev) => (prev === pageIdx ? prev : pageIdx));
            });
          }
        }
      },
      {
        root: viewport,
        threshold: [0.15, 0.5, 0.8],
      }
    );

    const pageElements = viewport.querySelectorAll('[data-page-index]');
    pageElements.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [preferences.layoutMode, chapter.id, chapter.pageCount]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  useEffect(() => {
    const handleFsChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsNativeFullscreen(active);
      if (!active) {
        setIsImmersiveLock(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const isFullscreenActive = isNativeFullscreen || isImmersiveLock;

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // fallback
      }
      setIsNativeFullscreen(false);
      setIsImmersiveLock(false);
      return;
    }

    if (isImmersiveLock) {
      setIsImmersiveLock(false);
      return;
    }

    const target = stageRef.current || document.documentElement;
    try {
      if (target.requestFullscreen) {
        await target.requestFullscreen();
        setIsNativeFullscreen(true);
        return;
      }
    } catch {
      // Host iframe may restrict native OS fullscreen; engage full-viewport lock seamlessly
    }
    setIsImmersiveLock(true);
  }, [isImmersiveLock]);

  const toggleWideMode = useCallback(() => {
    onUpdatePreferences({
      fitMode: preferences.fitMode === 'wide' ? 'contain-height' : 'wide',
    });
  }, [onUpdatePreferences, preferences.fitMode]);

  const stepSize = useMemo(() => {
    if (preferences.layoutMode !== 'double') return 1;
    const currentObj = chapter.pages[currentPage - 1];
    const nextObj = chapter.pages[currentPage];
    if (!currentObj || currentObj.isSpread || !nextObj || nextObj.isSpread) {
      return 1;
    }
    return 2;
  }, [chapter.pages, currentPage, preferences.layoutMode]);

  const goNext = useCallback(() => {
    setCurrentPage((prev) => {
      const next = Math.min(chapter.pageCount, prev + stepSize);
      if (next !== prev && scrollViewportRef.current) {
        scrollViewportRef.current.scrollTo({ top: 0 });
      }
      return next;
    });
  }, [chapter.pageCount, stepSize]);

  const goPrev = useCallback(() => {
    setCurrentPage((prev) => {
      const step = preferences.layoutMode === 'double' ? 2 : 1;
      const next = Math.max(1, prev - step);
      if (next !== prev && scrollViewportRef.current) {
        scrollViewportRef.current.scrollTo({ top: 0 });
      }
      return next;
    });
  }, [preferences.layoutMode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void toggleFullscreen();
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        toggleWideMode();
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setHudVisible((v) => !v);
        handleMouseMove();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        onUpdatePreferences({
          layoutMode: preferences.layoutMode === 'strip' ? 'single' : 'strip',
        });
      } else if (e.key === 'Escape') {
        if (isImmersiveLock && !document.fullscreenElement) {
          e.preventDefault();
          setIsImmersiveLock(false);
        } else if (!document.fullscreenElement) {
          e.preventDefault();
          onClose();
        }
      } else if (preferences.layoutMode !== 'strip') {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (preferences.direction === 'rtl') goPrev();
          else goNext();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (preferences.direction === 'rtl') goNext();
          else goPrev();
        } else if (e.key === ' ') {
          e.preventDefault();
          const vp = scrollViewportRef.current;
          if (e.shiftKey) {
            if (vp && vp.scrollTop > 30) {
              vp.scrollBy({ top: -Math.round(vp.clientHeight * 0.8), behavior: 'smooth' });
            } else {
              goPrev();
            }
          } else {
            if (vp && vp.scrollHeight - vp.scrollTop - vp.clientHeight > 30) {
              vp.scrollBy({ top: Math.round(vp.clientHeight * 0.8), behavior: 'smooth' });
            } else {
              goNext();
            }
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    goNext,
    goPrev,
    handleMouseMove,
    isImmersiveLock,
    onClose,
    onUpdatePreferences,
    preferences.direction,
    preferences.layoutMode,
    toggleFullscreen,
    toggleWideMode,
  ]);

  const visiblePages = useMemo(() => {
    if (preferences.layoutMode === 'strip') {
      return chapter.pages;
    }
    const first = chapter.pages[currentPage - 1];
    if (!first) return [];
    if (preferences.layoutMode === 'double' && !first.isSpread) {
      const second = chapter.pages[currentPage];
      if (second && !second.isSpread) {
        return preferences.direction === 'rtl' ? [second, first] : [first, second];
      }
    }
    return [first];
  }, [chapter.pages, currentPage, preferences.direction, preferences.layoutMode]);

  const bgClass =
    preferences.backgroundTone === 'pitch'
      ? 'bg-[#090908]'
      : preferences.backgroundTone === 'paper'
        ? 'bg-[#e9e2d2]'
        : 'bg-background';

  const getImageFitClasses = (fit: ReaderFitMode, isDoublePair: boolean): string => {
    if (isDoublePair) {
      if (fit === 'wide' || fit === 'cover-screen') {
        return 'w-1/2 max-w-[50%] h-auto block select-none pointer-events-none';
      }
      return 'max-h-dvh w-1/2 object-contain block select-none pointer-events-none';
    }

    switch (fit) {
      case 'wide':
        // Wide function: stretches/scales manga page edge-to-edge with 0 horizontal overflow
        return 'w-full max-w-full h-auto block select-none pointer-events-none';
      case 'cover-screen':
        // Locks to exact viewport rectangle covering 100% width and height without scroll
        return 'w-full max-w-full h-dvh object-cover block select-none pointer-events-none';
      case 'contain-height':
        return 'max-h-dvh max-w-full w-auto h-auto object-contain mx-auto block select-none pointer-events-none';
      case 'original':
        return 'max-w-none w-auto h-auto mx-auto block select-none pointer-events-none';
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  };

  const handleStageZoneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (preferences.layoutMode === 'strip') return;

    // Ignore clicks if user was scrolling or dragging (moved > 8px or took > 400ms)
    if (pointerStartRef.current) {
      const dist = Math.hypot(e.clientX - pointerStartRef.current.x, e.clientY - pointerStartRef.current.y);
      if (dist > 8 || Date.now() - pointerStartRef.current.time > 400) {
        return;
      }
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    if (relX < 0.32) {
      if (preferences.direction === 'rtl') goNext();
      else goPrev();
    } else if (relX > 0.68) {
      if (preferences.direction === 'rtl') goPrev();
      else goNext();
    } else {
      setHudVisible((v) => !v);
    }
  };

  const activePageObj = chapter.pages[currentPage - 1];
  const sortedSiblings = useMemo(
    () => [...siblingChapters].sort((a, b) => a.chapterNumber - b.chapterNumber),
    [siblingChapters]
  );
  const currentSiblingIdx = sortedSiblings.findIndex((c) => c.id === chapter.id);
  const prevChapter = currentSiblingIdx > 0 ? sortedSiblings[currentSiblingIdx - 1] : null;
  const nextChapter =
    currentSiblingIdx >= 0 && currentSiblingIdx < sortedSiblings.length - 1
      ? sortedSiblings[currentSiblingIdx + 1]
      : null;

  return (
    <div
      ref={stageRef}
      onMouseMove={handleMouseMove}
      onTouchStart={handleMouseMove}
      className={`fixed inset-0 z-50 flex h-dvh w-full flex-col ${bgClass} text-foreground overflow-hidden no-scrollbar ${
        !hudVisible && !isMouseActive ? 'cursor-none' : ''
      }`}
    >
      {/* Floating minimal restore button when HUD is hidden for 100% pure screen coverage */}
      {!hudVisible ? (
        <div
          className={`fixed right-4 top-4 z-30 flex items-center gap-2 transition-all duration-300 ease-out ${
            isMouseActive
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 -translate-y-2 pointer-events-none'
          }`}
        >
          <Button
            tone="quiet"
            onClick={() => {
              setHudVisible(true);
              handleMouseMove();
            }}
            aria-label="Show reader controls"
            className="min-h-10 px-3 text-caption bg-surface/90 backdrop-blur-md shadow-md"
          >
            <Eye className="h-4 w-4" />
            Controls [H]
          </Button>
          <Button
            tone={preferences.fitMode === 'wide' ? 'primary' : 'quiet'}
            onClick={() => {
              toggleWideMode();
              handleMouseMove();
            }}
            aria-label="Toggle wide screen fit"
            className="min-h-10 px-3 text-caption bg-surface/90 backdrop-blur-md shadow-md"
          >
            <MoveHorizontal className="h-4 w-4" />
            Wide [W]
          </Button>
          <Button
            tone="quiet"
            onClick={() => {
              void toggleFullscreen();
              handleMouseMove();
            }}
            aria-label={isFullscreenActive ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="min-h-10 px-3 text-caption bg-surface/90 backdrop-blur-md shadow-md"
          >
            {isFullscreenActive ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
        </div>
      ) : null}

      {/* Top Reader Control Bar */}
      {hudVisible ? (
        <header className="z-20 shrink-0 border-b border-border bg-surface px-3 py-2 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <Button tone="quiet" onClick={onClose} className="min-h-10 px-3">
                <ArrowLeft className="h-4 w-4" />
                Library
              </Button>

              <div className="min-w-0">
                <p className="truncate text-label font-semibold text-foreground" title={chapter.seriesTitle}>
                  {chapter.seriesTitle}
                </p>
                <p className="text-caption text-muted tabular-nums">
                  Ch. {chapter.chapterNumber} · Page {currentPage} of {chapter.pageCount}
                  {activePageObj ? ` · ${formatBytes(activePageObj.bytes)}` : ''}
                </p>
              </div>

              {sortedSiblings.length > 1 ? (
                <div className="hidden md:block w-48">
                  <Select
                    aria-label="Switch chapter"
                    value={chapter.id}
                    onChange={(e) => {
                      const found = sortedSiblings.find((c) => c.id === e.target.value);
                      if (found) onSelectChapter(found);
                    }}
                    className="min-h-10 py-1 text-label"
                  >
                    {sortedSiblings.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        Ch. {ch.chapterNumber} — {ch.chapterTitle}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
            </div>

            {/* Primary Reader Functions: Wide Fit + Fullscreen + Layout + Direction */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Fit mode selector with prominent Wide cover button */}
              <div
                role="group"
                aria-label="Image screen fit mode"
                className="flex flex-wrap items-center rounded-control border border-border bg-background p-0.5"
              >
                <button
                  type="button"
                  onClick={() => onUpdatePreferences({ fitMode: 'wide' })}
                  className={`min-h-9 whitespace-nowrap rounded-control px-3 text-caption font-medium transition-colors ${
                    preferences.fitMode === 'wide'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                  title="Fit image across entire screen width so it covers the whole screen (Shortcut: W)"
                >
                  Wide cover [W]
                </button>
                <button
                  type="button"
                  onClick={() => onUpdatePreferences({ fitMode: 'cover-screen' })}
                  className={`min-h-9 whitespace-nowrap rounded-control px-3 text-caption font-medium transition-colors ${
                    preferences.fitMode === 'cover-screen'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                  title="Lock image to exact viewport width and height"
                >
                  Lock screen
                </button>
                <button
                  type="button"
                  onClick={() => onUpdatePreferences({ fitMode: 'contain-height' })}
                  className={`min-h-9 whitespace-nowrap rounded-control px-3 text-caption font-medium transition-colors ${
                    preferences.fitMode === 'contain-height'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                  title="Fit full page height inside screen"
                >
                  Fit height
                </button>
                <button
                  type="button"
                  onClick={() => onUpdatePreferences({ fitMode: 'original' })}
                  className={`min-h-9 whitespace-nowrap rounded-control px-3 text-caption font-medium transition-colors ${
                    preferences.fitMode === 'original'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                  title="Original 1:1 pixel resolution"
                >
                  1:1
                </button>
              </div>

              {/* Layout mode: Single / Double / Long strip */}
              <div
                role="group"
                aria-label="Page layout mode"
                className="hidden sm:flex items-center rounded-control border border-border bg-background p-0.5"
              >
                {(
                  [
                    { id: 'single', label: 'Single' },
                    { id: 'double', label: 'Spread' },
                    { id: 'strip', label: 'Long strip' },
                  ] as Array<{ id: ReaderLayoutMode; label: string }>
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => onUpdatePreferences({ layoutMode: mode.id })}
                    className={`min-h-9 whitespace-nowrap rounded-control px-2.5 text-caption font-medium transition-colors ${
                      preferences.layoutMode === mode.id
                        ? 'bg-surface-elevated text-foreground'
                        : 'text-muted hover:text-foreground'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {/* Reading direction toggle (RTL / LTR) */}
              {preferences.layoutMode !== 'strip' ? (
                <Button
                  tone="quiet"
                  onClick={() =>
                    onUpdatePreferences({
                      direction: (preferences.direction === 'rtl' ? 'ltr' : 'rtl') as ReaderDirection,
                    })
                  }
                  className="min-h-10 px-3 text-caption"
                  title="Switch reading direction between Japanese RTL and Western LTR"
                >
                  {preferences.direction === 'rtl' ? 'RTL ←' : 'LTR →'}
                </Button>
              ) : null}

              {/* Hide HUD button so image covers literally 100% of screen */}
              <Button
                tone="quiet"
                onClick={() => setHudVisible(false)}
                className="min-h-10 px-3 text-caption"
                title="Hide toolbars so image covers the entire screen (Shortcut: H)"
              >
                <EyeOff className="h-4 w-4" />
                <span className="hidden lg:inline">Hide bars [H]</span>
              </Button>

              {/* Fullscreen button */}
              <Button
                tone={isFullscreenActive ? 'primary' : 'quiet'}
                onClick={() => void toggleFullscreen()}
                className="min-h-10 px-3.5 text-caption"
                title="Toggle Fullscreen (Shortcut: F)"
              >
                {isFullscreenActive ? (
                  <>
                    <Minimize className="h-4 w-4" />
                    Exit fullscreen [F]
                  </>
                ) : (
                  <>
                    <Maximize className="h-4 w-4" />
                    Fullscreen [F]
                  </>
                )}
              </Button>
            </div>
          </div>
        </header>
      ) : null}

      {/* Main Manga Image Viewport */}
      <div
        ref={scrollViewportRef}
        onPointerDown={handlePointerDown}
        onClick={handleStageZoneClick}
        className={`manga-scroll-viewport no-scrollbar relative min-h-0 flex-1 ${
          !hudVisible && !isMouseActive
            ? 'cursor-none'
            : preferences.layoutMode !== 'strip'
              ? 'cursor-pointer'
              : ''
        }`}
      >
        {preferences.layoutMode === 'strip' ? (
          <div className="flex w-full flex-col items-center">
            {visiblePages.map((page, idx) => (
              <div
                key={page.index}
                data-page-index={page.index}
                className="manga-strip-page w-full flex justify-center"
              >
                <MangaImage
                  src={page.url}
                  alt={`${chapter.seriesTitle} Chapter ${chapter.chapterNumber} Page ${page.index}`}
                  fallbackTitle={`${chapter.seriesTitle} · Page ${page.index}`}
                  priority={idx < 2}
                  className={
                    preferences.fitMode === 'wide' || preferences.fitMode === 'cover-screen'
                      ? 'w-full max-w-full h-auto block'
                      : preferences.fitMode === 'contain-height'
                        ? 'max-w-4xl w-full h-auto object-contain block'
                        : 'w-auto max-w-full h-auto block'
                  }
                />
              </div>
            ))}

            {/* End of strip chapter navigation */}
            <div className="w-full border-t border-border bg-surface px-6 py-8 text-center">
              <p className="text-body font-medium text-foreground">
                Finished {chapter.seriesTitle} · Chapter {chapter.chapterNumber}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                {prevChapter ? (
                  <Button tone="quiet" onClick={() => onSelectChapter(prevChapter)}>
                    Previous: Ch. {prevChapter.chapterNumber}
                  </Button>
                ) : null}
                {nextChapter ? (
                  <Button tone="primary" onClick={() => onSelectChapter(nextChapter)}>
                    Next: Ch. {nextChapter.chapterNumber}
                  </Button>
                ) : null}
                <Button tone="quiet" onClick={onClose}>
                  Return to library
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={`flex min-h-full w-full ${
              preferences.fitMode === 'wide' || preferences.fitMode === 'cover-screen'
                ? 'items-start justify-stretch'
                : 'items-center justify-center'
            }`}
          >
            {visiblePages.map((page) => (
              <MangaImage
                key={page.index}
                src={page.url}
                alt={`${chapter.seriesTitle} Chapter ${chapter.chapterNumber} Page ${page.index}`}
                fallbackTitle={`${chapter.seriesTitle} · Page ${page.index}`}
                priority
                className={getImageFitClasses(preferences.fitMode, visiblePages.length === 2)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom Scrubber & Quick Navigation Bar */}
      {hudVisible && preferences.layoutMode !== 'strip' ? (
        <footer className="z-20 shrink-0 border-t border-border bg-surface px-4 py-2.5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button
                tone="quiet"
                onClick={preferences.direction === 'rtl' ? goNext : goPrev}
                disabled={
                  preferences.direction === 'rtl'
                    ? currentPage >= chapter.pageCount
                    : currentPage <= 1
                }
                className="min-h-10 px-3"
                aria-label={preferences.direction === 'rtl' ? 'Next page (RTL)' : 'Previous page'}
              >
                <ChevronLeft className="h-4 w-4" />
                {preferences.direction === 'rtl' ? 'Next' : 'Prev'}
              </Button>

              <Button
                tone="quiet"
                onClick={preferences.direction === 'rtl' ? goPrev : goNext}
                disabled={
                  preferences.direction === 'rtl'
                    ? currentPage <= 1
                    : currentPage >= chapter.pageCount
                }
                className="min-h-10 px-3"
                aria-label={preferences.direction === 'rtl' ? 'Previous page (RTL)' : 'Next page'}
              >
                {preferences.direction === 'rtl' ? 'Prev' : 'Next'}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-3 max-w-xl">
              <label htmlFor="reader-page-scrubber" className="sr-only">
                Jump to manga page
              </label>
              <input
                id="reader-page-scrubber"
                type="range"
                min={1}
                max={Math.max(1, chapter.pageCount)}
                step={1}
                value={currentPage}
                onChange={(e) => setCurrentPage(Number(e.target.value) || 1)}
                style={{
                  direction: preferences.direction === 'rtl' ? 'rtl' : 'ltr',
                }}
                className="h-2 w-full accent-primary cursor-pointer"
              />
              <span className="whitespace-nowrap text-caption font-medium text-foreground tabular-nums">
                {currentPage} / {chapter.pageCount}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {nextChapter && currentPage >= chapter.pageCount ? (
                <Button
                  tone="primary"
                  onClick={() => onSelectChapter(nextChapter)}
                  className="min-h-10 px-3 text-caption"
                >
                  Read Ch. {nextChapter.chapterNumber}
                </Button>
              ) : null}

              <a
                href={`/api/chapters/${encodeURIComponent(chapter.id)}/cbz`}
                download
                className="inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-control border border-border bg-background px-3 text-caption font-medium text-foreground hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Download className="h-3.5 w-3.5" />
                Export .cbz
              </a>
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
};

export const MangaReader = React.memo(MangaReaderComponent);
