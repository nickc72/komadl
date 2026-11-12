import React, { Component, type ComponentProps, type ReactNode, useState } from 'react';

export const Surface = ({
  inset = false,
  className = '',
  ...props
}: ComponentProps<'div'> & { inset?: boolean }) => (
  <div
    className={`min-w-0 [:where(&)]:rounded-card [:where(&)]:text-foreground ${
      inset
        ? '[:where(&)]:bg-background [:where(&)]:border [:where(&)]:border-border'
        : '[:where(&)]:bg-surface [:where(&)]:border [:where(&)]:border-border [:where(&)]:shadow-surface'
    } ${className}`}
    {...props}
  />
);

const buttonTones = {
  primary:
    '[:where(&)]:bg-primary [:where(&)]:text-primary-foreground [:where(&)]:border [:where(&)]:border-transparent',
  quiet:
    '[:where(&)]:border [:where(&)]:border-border [:where(&)]:bg-surface [:where(&)]:text-foreground hover:[:where(&)]:bg-surface-elevated',
  ghost:
    '[:where(&)]:border [:where(&)]:border-transparent [:where(&)]:bg-transparent [:where(&)]:text-muted hover:[:where(&)]:text-foreground hover:[:where(&)]:bg-surface-elevated',
  danger:
    '[:where(&)]:border [:where(&)]:border-border [:where(&)]:bg-surface [:where(&)]:text-danger hover:[:where(&)]:bg-surface-elevated',
};

export const Button = ({
  tone = 'primary',
  type = 'button',
  className = '',
  ...props
}: ComponentProps<'button'> & { tone?: keyof typeof buttonTones }) => (
  <button
    type={type}
    className={`[:where(&)]:inline-flex [:where(&)]:min-h-11 [:where(&)]:items-center [:where(&)]:justify-center [:where(&)]:gap-2 whitespace-nowrap [:where(&)]:rounded-control [:where(&)]:px-4 [:where(&)]:text-label [:where(&)]:font-medium transition-[transform,opacity,background-color,color,border-color] duration-150 ease-out hover:brightness-95 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${buttonTones[tone]} ${className}`}
    {...props}
  />
);

export const Field = ({
  label,
  hint,
  htmlFor,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) => (
  <div className={`min-w-0 flex flex-col gap-1.5 ${className}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-label font-medium text-foreground">
        {label}
      </label>
      {hint ? <span className="text-caption text-muted">{hint}</span> : null}
    </div>
    {children}
  </div>
);

export const Input = ({ className = '', ...props }: ComponentProps<'input'>) => (
  <input
    className={`min-h-11 w-full min-w-0 rounded-control border border-border bg-background px-3.5 text-body text-foreground placeholder:text-muted/60 transition-colors duration-150 ease-out focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${className}`}
    {...props}
  />
);

export const Select = ({ className = '', ...props }: ComponentProps<'select'>) => (
  <select
    className={`min-h-11 w-full min-w-0 rounded-control border border-border bg-background px-3 text-body text-foreground transition-colors duration-150 ease-out focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${className}`}
    {...props}
  />
);

export const MangaImage = ({
  src,
  alt,
  fallbackTitle,
  className = '',
  imgClassName = '',
  loading,
  priority = false,
}: {
  src: string;
  alt: string;
  fallbackTitle: string;
  className?: string;
  imgClassName?: string;
  loading?: 'lazy' | 'eager';
  priority?: boolean;
}) => {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex flex-col items-center justify-center bg-gradient-to-b from-surface-elevated to-background p-6 text-center ${className}`}
      >
        <span className="text-label font-medium text-foreground">{fallbackTitle}</span>
        <span className="mt-1 text-caption text-muted">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={loading ?? (priority ? 'eager' : 'lazy')}
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`manga-page-img ${className} ${imgClassName}`.trim()}
    />
  );
};

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-dvh bg-background text-foreground flex items-center justify-center p-6">
          <Surface className="max-w-lg w-full p-6">
            <div role="alert" className="space-y-4">
              <h1 className="text-title text-foreground">Archive interface encountered an error</h1>
              <p className="text-body text-muted">{this.state.error.message}</p>
              <Button onClick={() => window.location.reload()}>Reload application</Button>
            </div>
          </Surface>
        </div>
      );
    }
    return this.props.children;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 10 || exp === 0 ? Math.round(val) : val.toFixed(1)} ${units[exp]}`;
}
