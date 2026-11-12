import React, { useEffect, useMemo, useState } from 'react';
import { Check, Code2, Copy, Download, RotateCcw, Save } from 'lucide-react';
import type { EngineInfo, GalleryDlConfig } from '../types';
import { buildGalleryDlConfigJson } from '../utils/galleryDl';
import { Button, Field, Input, Surface, formatBytes } from './ui';

interface ConfigPanelProps {
  config: GalleryDlConfig;
  engine: EngineInfo | null;
  onSaveConfig: (next: GalleryDlConfig) => Promise<void>;
  onResetLibrary: () => Promise<void>;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({
  config,
  engine,
  onSaveConfig,
  onResetLibrary,
}) => {
  const [draft, setDraft] = useState<GalleryDlConfig>(config);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [copiedJson, setCopiedJson] = useState<boolean>(false);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [resetting, setResetting] = useState<boolean>(false);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const jsonPreview = useMemo(() => buildGalleryDlConfigJson(draft), [draft]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(null);
    try {
      await onSaveConfig(draft);
      setSavedNotice('Saved configuration to ./downloads/gallery-dl.conf');
    } catch (err) {
      setSavedNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonPreview);
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleDownloadConf = () => {
    const blob = new Blob([jsonPreview], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gallery-dl.conf';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
      <Surface className="p-5 sm:p-6 lg:col-span-7">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <div>
            <h2 className="text-title text-foreground">Extractor & archive configuration</h2>
            <p className="mt-1 text-label text-muted">
              Configure directory templates, request pacing, and postprocessors written to <code className="font-mono text-foreground">./downloads/gallery-dl.conf</code>.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-border pt-4">
            <Field label="Base archive directory" htmlFor="cfg-base-dir">
              <Input
                id="cfg-base-dir"
                value={draft.baseDirectory}
                onChange={(e) => setDraft({ ...draft, baseDirectory: e.target.value })}
                className="font-mono text-label"
              />
            </Field>

            <Field label="Filename format" htmlFor="cfg-filename">
              <Input
                id="cfg-filename"
                value={draft.filenameTemplate}
                onChange={(e) => setDraft({ ...draft, filenameTemplate: e.target.value })}
                className="font-mono text-label"
              />
            </Field>
          </div>

          <Field
            label="Subdirectory structure template"
            hint="Tokens: {category}, {manga}, {chapter:03d}"
            htmlFor="cfg-dir-template"
          >
            <Input
              id="cfg-dir-template"
              value={draft.directoryTemplate}
              onChange={(e) => setDraft({ ...draft, directoryTemplate: e.target.value })}
              className="font-mono text-label"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Sleep between requests (seconds)" htmlFor="cfg-sleep">
              <Input
                id="cfg-sleep"
                type="number"
                min={0}
                max={30}
                step={0.25}
                value={draft.sleepRequest}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    sleepRequest: Math.max(0, Math.min(30, Number(e.target.value) || 0)),
                  })
                }
              />
            </Field>

            <Field label="HTTP retry count" htmlFor="cfg-retries">
              <Input
                id="cfg-retries"
                type="number"
                min={0}
                max={20}
                step={1}
                value={draft.retries}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    retries: Math.max(0, Math.min(20, Math.floor(Number(e.target.value) || 0))),
                  })
                }
              />
            </Field>
          </div>

          <Field label="HTTP User-Agent" htmlFor="cfg-ua">
            <Input
              id="cfg-ua"
              value={draft.userAgent}
              onChange={(e) => setDraft({ ...draft, userAgent: e.target.value })}
              className="font-mono text-caption"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="HTTP/SOCKS proxy URL" hint="Optional" htmlFor="cfg-proxy">
              <Input
                id="cfg-proxy"
                value={draft.proxyUrl}
                onChange={(e) => setDraft({ ...draft, proxyUrl: e.target.value })}
                placeholder="http://127.0.0.1:8080"
                className="font-mono text-label"
              />
            </Field>

            <Field label="Cookies Netscape file path" hint="Optional" htmlFor="cfg-cookies">
              <Input
                id="cfg-cookies"
                value={draft.cookiesPath}
                onChange={(e) => setDraft({ ...draft, cookiesPath: e.target.value })}
                placeholder="./cookies.txt"
                className="font-mono text-label"
              />
            </Field>
          </div>

          <div className="divide-y divide-border border-t border-b border-border">
            <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
              <div>
                <p className="text-label font-medium text-foreground">Write sidecar JSON metadata</p>
                <p className="text-caption text-muted">
                  Saves extractor metadata alongside downloaded pages (<code className="font-mono">--write-metadata</code>).
                </p>
              </div>
              <input
                type="checkbox"
                checked={draft.writeMetadata}
                onChange={(e) => setDraft({ ...draft, writeMetadata: e.target.checked })}
                className="h-5 w-5 accent-primary"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
              <div>
                <p className="text-label font-medium text-foreground">Convert Pixiv Ugoira animations</p>
                <p className="text-caption text-muted">
                  Enables Ugoira WebM postprocessor in exported <code className="font-mono">gallery-dl.conf</code>.
                </p>
              </div>
              <input
                type="checkbox"
                checked={draft.ugoiraConvert}
                onChange={(e) => setDraft({ ...draft, ugoiraConvert: e.target.checked })}
                className="h-5 w-5 accent-primary"
              />
            </label>
          </div>

          {savedNotice ? (
            <p role="status" className="text-label text-success">
              {savedNotice}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save gallery-dl.conf'}
            </Button>

            {confirmReset ? (
              <div className="flex items-center gap-2">
                <span className="text-caption text-muted">Restore default shelf?</span>
                <Button
                  tone="danger"
                  disabled={resetting}
                  onClick={() => {
                    setResetting(true);
                    void onResetLibrary().finally(() => {
                      setResetting(false);
                      setConfirmReset(false);
                    });
                  }}
                >
                  Confirm reset
                </Button>
                <Button tone="quiet" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button tone="quiet" onClick={() => setConfirmReset(true)}>
                <RotateCcw className="h-4 w-4" />
                Reset initial archive
              </Button>
            )}
          </div>
        </form>
      </Surface>

      <div className="min-w-0 space-y-6 lg:col-span-5 lg:sticky lg:self-start lg:top-6">
        <Surface className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-title text-foreground">Generated gallery-dl.conf</h2>
            <div className="flex items-center gap-2">
              <Button tone="quiet" onClick={() => void handleCopyJson()} className="min-h-9 px-3 text-caption">
                {copiedJson ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedJson ? 'Copied' : 'Copy'}
              </Button>
              <Button tone="quiet" onClick={handleDownloadConf} className="min-h-9 px-3 text-caption">
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
            </div>
          </div>

          <Surface inset className="p-4 overflow-x-auto">
            <pre className="font-mono text-caption leading-relaxed text-foreground">
              {jsonPreview}
            </pre>
          </Surface>

          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-label font-medium text-foreground">Run KomaDL on your machine</p>
                <p className="text-caption text-muted">
                  Download the full source bundle (<code className="font-mono">npm install &amp;&amp; npm run dev</code>)
                </p>
              </div>
              <a
                href="/api/source-code.zip"
                download="komadl-local-project.zip"
                className="inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-control bg-primary px-3.5 text-caption font-medium text-primary-foreground hover:brightness-95"
              >
                <Code2 className="h-4 w-4" />
                Download project (.zip)
              </a>
            </div>
          </div>

          {engine ? (
            <div className="border-t border-border pt-4 divide-y divide-border text-caption">
              <div className="flex items-baseline justify-between gap-4 py-2">
                <span className="text-muted">Local extractor mode</span>
                <span className="font-medium text-foreground">
                  {engine.galleryDlBinaryFound
                    ? `gallery-dl ${engine.galleryDlVersion}`
                    : 'Built-in HTTP & MangaDex extractor'}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2">
                <span className="text-muted">Host Python runtime</span>
                <span className="font-mono text-foreground">
                  {engine.pythonVersion || 'Not detected'}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2">
                <span className="text-muted">Archive storage</span>
                <span className="text-foreground tabular-nums">
                  {engine.totalSeries} series · {engine.totalChapters} chapters · {engine.totalPages} pages ({formatBytes(engine.totalBytes)})
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2">
                <span className="text-muted">Disk directory</span>
                <span className="truncate font-mono text-foreground" title={engine.archiveRoot}>
                  ./downloads
                </span>
              </div>
            </div>
          ) : null}
        </Surface>
      </div>
    </div>
  );
};
