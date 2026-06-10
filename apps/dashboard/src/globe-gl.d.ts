declare module 'react-globe.gl' {
  import type { Ref } from 'react';
  import type { Light, Scene } from 'three';

  type GlobeControls = {
    autoRotate: boolean;
    autoRotateSpeed: number;
    enablePan: boolean;
    enableZoom: boolean;
  };

  type GlobeLight = {
    type?: string;
    intensity?: number;
    position?: { set: (x: number, y: number, z: number) => void };
  };

  type GeoJsonGeometry = {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };

  export type GlobeRef = {
    pointOfView: (
      pov: { lat?: number; lng?: number; altitude?: number },
      ms?: number,
    ) => void;
    controls?: () => GlobeControls;
    lights?: () => GlobeLight[] | ((lights: GlobeLight[]) => void);
    scene?: () => Scene;
  };

  type GlobeProps = {
    ref?: Ref<GlobeRef>;
    width?: number;
    height?: number;
    backgroundColor?: string;
    backgroundImageUrl?: string | null;
    globeImageUrl?: string;
    bumpImageUrl?: string | null;
    showAtmosphere?: boolean;
    showGraticules?: boolean;
    atmosphereColor?: string;
    atmosphereAltitude?: number;
    globeCurvatureResolution?: number;
    globeMaterial?: import('three').Material;
    labelsData?: object[];
    labelLat?: string | ((obj: object) => number);
    labelLng?: string | ((obj: object) => number);
    labelText?: string | ((obj: object) => string);
    labelColor?: string | ((obj: object) => string);
    labelSize?: number | string | ((obj: object) => number);
    labelAltitude?: number | ((obj: object) => number);
    labelResolution?: number;
    labelIncludeDot?: boolean | ((obj: object) => boolean);
    labelDotRadius?: number | ((obj: object) => number);
    labelTypeFace?: object;
    labelsTransitionDuration?: number;
    polygonsData?: object[];
    polygonGeoJsonGeometry?: string | ((obj: object) => GeoJsonGeometry);
    polygonCapColor?: string | ((obj: object) => string);
    polygonSideColor?: string | ((obj: object) => string);
    polygonStrokeColor?: string | boolean | null | ((obj: object) => string);
    polygonAltitude?: number | ((obj: object) => number);
    pointsData?: object[];
    pointLat?: string;
    pointLng?: string;
    pointAltitude?: number;
    pointRadius?: number;
    pointColor?: (point: object) => string;
    pointResolution?: number;
    ringsData?: object[];
    ringLat?: string;
    ringLng?: string;
    ringColor?: (ring: object) => string;
    ringAltitude?: number;
    ringMaxRadius?: number;
    ringPropagationSpeed?: number;
    ringRepeatPeriod?: number;
    onGlobeReady?: () => void;
    onPointHover?: (point: object | null, prevPoint: object | null) => void;
    onZoom?: (pov: { lat: number; lng: number; altitude: number }) => void;
  };

  export default function Globe(props: GlobeProps): import('react').JSX.Element;
}
