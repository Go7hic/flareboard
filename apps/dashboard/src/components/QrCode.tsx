import { useMemo } from 'react';
import { encodeQr } from '../lib/qr';

type QrCodeProps = {
  /** Text to encode (for example an otpauth:// URI). */
  value: string;
  /** Rendered width and height in CSS pixels. */
  size?: number;
  /** Accessible name for the image. */
  label: string;
};

/**
 * Renders `value` as a QR code in inline SVG. The colors are fixed rather than theme tokens:
 * authenticator apps expect dark modules on a light tile, so dark mode must not invert them.
 */
export function QrCode({ value, size = 184, label }: QrCodeProps) {
  const qr = useMemo(() => encodeQr(value), [value]);
  const quiet = 4;
  const dim = qr.size + quiet * 2;
  let path = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y * qr.size + x]) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      shapeRendering="crispEdges"
      className="qr-code"
    >
      <rect width={dim} height={dim} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
