import { Building2, UserRound } from 'lucide-react';
import { cn } from '../../lib/utils';

/** "Sofia Fischer" → "SF", "sofia@acme.com" → "S", "张伟" → "张". */
export function initialsOf(label: string): string {
  const base = label.includes('@') ? label.split('@')[0]! : label;
  const words = base
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (!words.length) return '?';
  const first = Array.from(words[0]!)[0] ?? '';
  const second = words.length > 1 && !label.includes('@') ? Array.from(words[words.length - 1]!)[0] ?? '' : '';
  return `${first}${second}`.toUpperCase();
}

/**
 * Neutral identity mark (console v2: no rainbow): initials for identified people, a person
 * glyph for anonymous visitors, a rounded square for groups.
 */
export function IdentityAvatar({
  label,
  anonymous = false,
  kind = 'person',
  size = 'md',
  className,
}: {
  /** Name or email (ignored when anonymous). */
  label?: string | null;
  anonymous?: boolean;
  kind?: 'person' | 'group';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const showGlyph = anonymous || !label;
  const Glyph = kind === 'group' ? Building2 : UserRound;
  return (
    <span
      className={cn(
        'audience-avatar',
        `audience-avatar--${size}`,
        kind === 'group' && 'audience-avatar--group',
        showGlyph && 'is-anonymous',
        className,
      )}
      aria-hidden
    >
      {showGlyph ? <Glyph strokeWidth={2} /> : initialsOf(label!)}
    </span>
  );
}
