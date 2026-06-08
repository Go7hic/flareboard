/** Approximate country centroids [longitude, latitude] for ISO 3166-1 alpha-2. */
const CENTROIDS: Record<string, [number, number]> = {
  US: [-98.5795, 39.8283],
  CN: [104.1954, 35.8617],
  GB: [-3.436, 55.3781],
  DE: [10.4515, 51.1657],
  FR: [2.2137, 46.2276],
  IN: [78.9629, 20.5937],
  BR: [-51.9253, -14.235],
  CA: [-106.3468, 56.1304],
  AU: [133.7751, -25.2744],
  JP: [138.2529, 36.2048],
  KR: [127.7669, 35.9078],
  RU: [105.3188, 61.524],
  MX: [-102.5528, 23.6345],
  ES: [-3.7492, 40.4637],
  IT: [12.5674, 41.8719],
  NL: [5.2913, 52.1326],
  SE: [18.6435, 60.1282],
  PL: [19.1451, 51.9194],
  TR: [35.2433, 38.9637],
  ID: [113.9213, -0.7893],
  TH: [100.9925, 15.87],
  VN: [108.2772, 14.0583],
  PH: [121.774, 12.8797],
  MY: [101.9758, 4.2105],
  SG: [103.8198, 1.3521],
  HK: [114.1694, 22.3193],
  TW: [120.9605, 23.6978],
  AR: [-63.6167, -38.4161],
  CL: [-71.543, -35.6751],
  CO: [-74.2973, 4.5709],
  PE: [-75.0152, -9.19],
  ZA: [22.9375, -30.5595],
  EG: [30.8025, 26.8206],
  NG: [8.6753, 9.082],
  KE: [37.9062, -0.0236],
  AE: [53.8478, 23.4241],
  SA: [45.0792, 23.8859],
  IL: [34.8516, 31.0461],
  UA: [31.1656, 48.3794],
  RO: [24.9668, 45.9432],
  CZ: [15.473, 49.8175],
  AT: [14.5501, 47.5162],
  CH: [8.2275, 46.8182],
  BE: [4.4699, 50.5039],
  PT: [-8.2245, 39.3999],
  IE: [-8.2439, 53.4129],
  DK: [9.5018, 56.2639],
  FI: [25.7482, 61.9241],
  NO: [8.4689, 60.472],
  NZ: [174.886, -40.9006],
  PK: [69.3451, 30.3753],
  BD: [90.3563, 23.685],
  IR: [53.688, 32.4279],
  IQ: [43.6793, 33.2232],
  GR: [21.8243, 39.0742],
  HU: [19.5033, 47.1625],
};

export function getCountryCentroid(code: string): [number, number] | null {
  const upper = code.trim().toUpperCase();
  if (upper.length !== 2) return null;
  return CENTROIDS[upper] ?? null;
}

/** Stable jitter so multiple sessions in one country don't stack on one pixel. */
export function jitterCoords(
  base: [number, number],
  sessionId: string,
  index: number,
): [number, number] {
  let hash = index;
  for (let i = 0; i < sessionId.length; i += 1) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) | 0;
  }
  const angle = ((hash % 360) * Math.PI) / 180;
  const radius = 0.35 + (Math.abs(hash) % 100) / 200;
  return [base[0] + Math.cos(angle) * radius, base[1] + Math.sin(angle) * radius * 0.6];
}
