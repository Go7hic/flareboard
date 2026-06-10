import clsx from 'clsx';
import { useMemo } from 'react';
import { createSessionAvatarSvg } from '../lib/session-avatar';

type SessionAvatarProps = {
  seed: string;
  size?: number;
  className?: string;
  title?: string;
};

export function SessionAvatar({ seed, size = 28, className, title }: SessionAvatarProps) {
  const svg = useMemo(() => createSessionAvatarSvg(seed, size), [seed, size]);

  return (
    <span
      className={clsx('session-avatar', className)}
      style={{ width: size, height: size }}
      title={title}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
