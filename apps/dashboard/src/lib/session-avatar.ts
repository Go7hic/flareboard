import { createAvatar } from '@dicebear/core';
import { openPeeps } from '@dicebear/collection';

/** Soft pastel circle backgrounds — same palette family as Umami. */
const PASTEL_BACKGROUNDS = [
  'b6e3f4',
  'c0aede',
  'd1d4f9',
  'ffd5dc',
  'ffdfbf',
  'c1f0d0',
  'f9e8a8',
  'e8d5f2',
  'd4e4f7',
] as const;

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getSessionAvatarBackground(seed: string): string {
  return PASTEL_BACKGROUNDS[hashSeed(seed) % PASTEL_BACKGROUNDS.length];
}

export function createSessionAvatarSvg(seed: string, size = 32): string {
  return createAvatar(openPeeps, {
    seed,
    size,
    backgroundColor: [getSessionAvatarBackground(seed)],
  }).toString();
}

export function createSessionAvatarElement(seed: string, size = 32): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'session-avatar';
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = createSessionAvatarSvg(seed, size);
  return el;
}
