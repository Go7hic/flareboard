import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '../ui/button';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';

/** Copies `value`; the icon (and label, when shown) flips to "Copied" for two seconds. */
export function CopyButton({
  value,
  label,
  iconOnly = false,
  size = 'sm',
  variant = 'ghost',
  className,
}: {
  value: string;
  /** Visible label; defaults to "Copy". */
  label?: string;
  iconOnly?: boolean;
  size?: 'sm' | 'xs' | 'default';
  variant?: 'ghost' | 'outline' | 'secondary';
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const text = copied ? t('copied') : (label ?? t('copyToClipboard'));
  const Icon = copied ? Check : Copy;

  if (iconOnly) {
    return (
      <Button
        type="button"
        variant={variant}
        size={size === 'xs' ? 'icon-xs' : size === 'sm' ? 'icon-sm' : 'icon'}
        className={cn('q-copy', className)}
        aria-label={text}
        title={text}
        onClick={(event) => {
          event.stopPropagation();
          void copy();
        }}
      >
        <Icon aria-hidden />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn('q-copy', className)}
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
    >
      <Icon aria-hidden />
      {text}
    </Button>
  );
}
