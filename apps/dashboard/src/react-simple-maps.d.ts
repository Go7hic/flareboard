declare module 'react-simple-maps' {
  import type { ReactNode, CSSProperties } from 'react';

  export interface Geography {
    rsmKey: string;
    id: string | number;
    properties: Record<string, unknown>;
  }

  export interface ComposableMapProps {
    projectionConfig?: Record<string, number>;
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

  export function ComposableMap(props: ComposableMapProps): JSX.Element;
  export function Geographies(props: GeographiesProps): JSX.Element;
  export function Geography(props: GeographyProps): JSX.Element;
}
