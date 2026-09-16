import { useEffect, useRef } from 'react';
import {
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from 'three';
import { resolveTheme, themeChangeEventName } from '../../lib/theme';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uDark;
uniform vec2 uRes;
uniform vec2 uMouse;
uniform vec3 uSkyTop;
uniform vec3 uSkyBot;
uniform vec3 uFar;
uniform vec3 uMid;
uniform vec3 uNear;
uniform vec3 uSnow;
uniform vec3 uFog;
uniform vec3 uShaft;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float ridge(vec2 p) {
  return 1.0 - abs(fbm(p) * 2.0 - 1.0);
}

float range(vec2 p, float scale, float offset) {
  p.x += fbm(p * 0.55 + offset) * 0.55;
  return ridge(p * scale);
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / max(uRes.y, 1.0);
  uv.x = (uv.x - 0.5) * aspect * 0.62 + 0.5;
  uv += uMouse * 0.03;

  float t = uTime;

  vec3 col = mix(uSkyBot, uSkyTop, smoothstep(0.12, 0.92, vUv.y));

  if (uDark > 0.5) {
    vec2 sp = floor(vUv * uRes * 0.28);
    float star = hash(sp);
    float twinkle = 0.65 + 0.35 * sin(t * 1.4 + star * 40.0);
    col += vec3(1.05, 1.02, 0.96) * smoothstep(0.996, 1.0, star) * twinkle;
  }

  float farH = 0.46 + 0.14 * range(vec2(uv.x + t * 0.012, 0.15), 2.6, 0.0);
  float midH = 0.34 + 0.20 * range(vec2(uv.x - t * 0.02, 0.62), 3.8, 2.1);
  float nearH = 0.17 + 0.16 * range(vec2(uv.x + t * 0.008, 1.4), 5.4, 4.4);

  float y = vUv.y;

  if (y < farH) {
    float h = (farH - y) / max(farH, 0.001);
    float snow = smoothstep(0.42, 0.88, range(vec2(uv.x * 3.2, y * 8.0), 4.0, 8.0));
    vec3 rock = mix(uFar, uFar * 0.72, h);
    col = mix(rock, uSnow, snow * (0.28 + 0.35 * uDark) * (1.0 - h * 0.5));
  }

  float mistFar = fbm(vec2(uv.x * 1.6 - t * 0.05, y * 2.4 + t * 0.03));
  col = mix(col, uFog, mistFar * smoothstep(0.58, 0.28, y) * 0.45);

  if (y < midH) {
    float h = (midH - y) / max(midH, 0.001);
    float snow = smoothstep(0.5, 0.92, range(vec2(uv.x * 4.4, y * 10.0), 5.2, 11.0));
    vec3 rock = mix(uMid, uMid * 0.78, h);
    col = mix(rock, mix(rock, uSnow, snow * (0.4 + 0.25 * uDark)), 1.0);
  }

  float mistMid = fbm(vec2(uv.x * 2.2 + t * 0.04, y * 3.2 - t * 0.025));
  col = mix(col, uFog, mistMid * smoothstep(0.42, 0.12, y) * 0.38);

  if (y < nearH) {
    float h = (nearH - y) / max(nearH, 0.001);
    col = mix(uNear * (0.82 + 0.18 * (1.0 - h)), uNear, 1.0 - h * 0.35);
  }

  float shafts = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float x = vUv.x - 0.16 - fi * 0.17 + sin(t * 0.31 + fi * 1.1) * 0.028;
    float beam = exp(-pow(x * (16.0 + fi * 5.0), 2.0));
    shafts += beam * (0.16 - fi * 0.018) * smoothstep(-0.05, 0.72, y);
  }
  col += uShaft * shafts;

  float grain = hash(gl_FragCoord.xy + fract(t * 0.17) * 40.0) - 0.5;
  col += grain * 0.016;

  vec2 vc = vUv - vec2(0.5, 0.42);
  col *= 1.0 - 0.18 * dot(vc * vec2(1.15, 1.35), vc * vec2(1.15, 1.35));

  gl_FragColor = vec4(col, 1.0);
}
`;

type Palette = {
  skyTop: string;
  skyBot: string;
  far: string;
  mid: string;
  near: string;
  snow: string;
  fog: string;
  shaft: string;
};

const LIGHT: Palette = {
  skyTop: '#eef0f2',
  skyBot: '#d9dce0',
  far: '#9aa0a6',
  mid: '#6f757c',
  near: '#3f4348',
  snow: '#f4f5f6',
  fog: '#eceef0',
  shaft: '#f2f3f5',
};

const DARK: Palette = {
  skyTop: '#07080c',
  skyBot: '#10131a',
  far: '#2a3038',
  mid: '#161a20',
  near: '#090b0e',
  snow: '#c5ccd4',
  fog: '#1a1e26',
  shaft: '#6e7784',
};

function isWebglOk() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function paint(material: ShaderMaterial, dark: boolean) {
  const p = dark ? DARK : LIGHT;
  material.uniforms.uDark.value = dark ? 1 : 0;
  (material.uniforms.uSkyTop.value as Color).set(p.skyTop);
  (material.uniforms.uSkyBot.value as Color).set(p.skyBot);
  (material.uniforms.uFar.value as Color).set(p.far);
  (material.uniforms.uMid.value as Color).set(p.mid);
  (material.uniforms.uNear.value as Color).set(p.near);
  (material.uniforms.uSnow.value as Color).set(p.snow);
  (material.uniforms.uFog.value as Color).set(p.fog);
  (material.uniforms.uShaft.value as Color).set(p.shaft);
}

export function LandingHeroBackdrop() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !isWebglOk()) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
    });
    renderer.setClearColor(resolveTheme() === 'dark' ? 0x000000 : 0xffffff, 1);
    renderer.domElement.className = 'landing-hero-backdrop-canvas';
    wrap.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new PlaneGeometry(2, 2);
    const material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDark: { value: 0 },
        uRes: { value: new Vector2(1, 1) },
        uMouse: { value: new Vector2(0, 0) },
        uSkyTop: { value: new Color() },
        uSkyBot: { value: new Color() },
        uFar: { value: new Color() },
        uMid: { value: new Color() },
        uNear: { value: new Color() },
        uSnow: { value: new Color() },
        uFog: { value: new Color() },
        uShaft: { value: new Color() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);
    paint(material, resolveTheme() === 'dark');

    const mouse = new Vector2(0, 0);
    const mouseTarget = new Vector2(0, 0);
    let visible = true;
    let raf = 0;
    let start = performance.now();

    const host = wrap;

    function size() {
      const rect = host.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      material.uniforms.uRes.value.set(w * dpr, h * dpr);
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      mouse.lerp(mouseTarget, 0.045);
      material.uniforms.uMouse.value.copy(mouse);
      if (!reduced) {
        material.uniforms.uTime.value = (now - start) * 0.001;
      }
      renderer.render(scene, camera);
    }

    function onMove(e: PointerEvent) {
      if (reduced) return;
      mouseTarget.set(e.clientX / window.innerWidth - 0.5, 0.5 - e.clientY / window.innerHeight);
    }

    function onTheme() {
      const dark = resolveTheme() === 'dark';
      renderer.setClearColor(dark ? 0x000000 : 0xffffff, 1);
      paint(material, dark);
      if (reduced) renderer.render(scene, camera);
    }

    size();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(size);
    ro.observe(wrap);
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
      },
      { threshold: 0.05 },
    );
    io.observe(wrap);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener(themeChangeEventName, onTheme);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener(themeChangeEventName, onTheme);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={wrapRef} className="landing-hero-backdrop" aria-hidden="true" />;
}
