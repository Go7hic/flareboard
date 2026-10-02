import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../lib/i18n';
import { Button } from '../ui/button';

/**
 * Copies `text` and confirms with a check for two seconds. `iconOnly` keeps the label for
 * screen readers and the tooltip only (table rows, inline values).
 */
export function CopyButton({
  text,
  label = t('copyToClipboard'),
  copiedLabel = t('copied'),
  iconOnly = false,
  variant = 'ghost',
  size = 'sm',
  className,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  iconOnly?: boolean;
  variant?: 'ghost' | 'outline' | 'secondary';
  size?: 'sm' | 'default';
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const Icon = copied ? Check : Copy;
  const current = copied ? copiedLabel : label;
  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? (size === 'sm' ? 'icon-sm' : 'icon') : size}
      className={className}
      onClick={() => void onCopy()}
      aria-label={current}
      title={current}
    >
      <Icon aria-hidden strokeWidth={2} />
      {iconOnly ? null : current}
    </Button>
  );
}
