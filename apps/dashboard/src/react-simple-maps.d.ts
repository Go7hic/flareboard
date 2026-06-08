declare module 'react-simple-maps' {
  import type { ReactNode, CSSProperties } from 'react';

  export interface Geography {
    rsmKey: string;
    id: string | number;
    properties: Record<string, unknown>;
  }

  export interface ComposableMapProps {
    projectionConfig?: {
      scale?: number;
      center?: [number, number];
      rotate?: [number, number, number];
    };
    width?: number;
    height?: number;
    style?: CSSProperties;
    children?: ReactNode;
  }

  export interface GeographiesProps {
    geography: string | object;
    children: (args: { geographies: Geography[] }) => ReactNode;
  }

  export interface GeographyProps {
    geography: Geography;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    style?: Record<string, { outline?: string; fill?: string; opacity?: number }>;
  }

  export interface MarkerProps {
    coordinates: [number, number];
    children?: ReactNode;
  }

  export function ComposableMap(props: ComposableMapProps): JSX.Element;
  export function Geographies(props: GeographiesProps): JSX.Element;
  export function Geography(props: GeographyProps): JSX.Element;
  export function Marker(props: MarkerProps): JSX.Element;
  export function useMapContext(): {
    projection?: (coords: [number, number]) => [number, number] | null;
  };
}
