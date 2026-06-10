import { useEffect, useState } from 'react';
import { getCartographicEarthTextureUrl } from './globe-cartographic-texture';

/** DataFast-style cartographic palette on a dark starfield canvas. */
export const GLOBE_CANVAS_BG = '#0a0a0a';
export const GLOBE_STARFIELD_URL =
  'https://unpkg.com/three-globe@2.38.0/example/img/night-sky.png';

/** Dark sans labels on pastel land. */
export const GLOBE_CITY_LABEL_COLOR = '#333333';
export const GLOBE_COUNTRY_LABEL_COLOR = '#2d3748';
export const GLOBE_COUNTRY_LABEL_SIZE = 1.0;

export const GLOBE_ATMOSPHERE_COLOR = '#89cff0';
export const GLOBE_ATMOSPHERE_ALTITUDE = 0.15;

export const GLOBE_LABEL_FONT_URL =
  'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/fonts/droid/droid_sans_regular.typeface.json';

export function useGlobeLabelFont(): object | undefined {
  const [font, setFont] = useState<object | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch(GLOBE_LABEL_FONT_URL)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setFont(data);
      })
      .catch(() => {
        /* fall back to globe.gl default helvetiker */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return font;
}

export function useCartographicEarthTexture(): string | undefined {
  const [textureUrl, setTextureUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getCartographicEarthTextureUrl()
      .then((url) => {
        if (!cancelled) setTextureUrl(url);
      })
      .catch(() => {
        /* globe stays hidden until texture is ready */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return textureUrl;
}
