declare module 'three' {
  export class AmbientLight {
    type: string;
    intensity: number;
    constructor(color?: number | string, intensity?: number);
  }

  export class DirectionalLight {
    type: string;
    intensity: number;
    position: { set: (x: number, y: number, z: number) => void };
    constructor(color?: number | string, intensity?: number);
  }
}
