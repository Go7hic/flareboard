/** Major city labels for the realtime globe (lat/lng, WGS84). Sizes are angular degrees (globe.gl labelSize). */
export const GLOBE_CITY_LABELS: { lat: number; lng: number; text: string; size: number }[] = [
  { lat: 51.5074, lng: -0.1278, text: 'London', size: 1.35 },
  { lat: 48.8566, lng: 2.3522, text: 'Paris', size: 1.28 },
  { lat: 52.52, lng: 13.405, text: 'Berlin', size: 1.2 },
  { lat: 40.4168, lng: -3.7038, text: 'Madrid', size: 1.2 },
  { lat: 41.9028, lng: 12.4964, text: 'Rome', size: 1.12 },
  { lat: 52.3676, lng: 4.9041, text: 'Amsterdam', size: 1.05 },
  { lat: 55.7558, lng: 37.6173, text: 'Moscow', size: 1.28 },
  { lat: 30.0444, lng: 31.2357, text: 'Cairo', size: 1.2 },
  { lat: 25.2048, lng: 55.2708, text: 'Dubai', size: 1.12 },
  { lat: 28.6139, lng: 77.209, text: 'New Delhi', size: 1.2 },
  { lat: 19.076, lng: 72.8777, text: 'Mumbai', size: 1.2 },
  { lat: 35.6762, lng: 139.6503, text: 'Tokyo', size: 1.35 },
  { lat: 37.5665, lng: 126.978, text: 'Seoul', size: 1.12 },
  { lat: 1.3521, lng: 103.8198, text: 'Singapore', size: 1.05 },
  { lat: 22.3193, lng: 114.1694, text: 'Hong Kong', size: 1.05 },
  { lat: 40.7128, lng: -74.006, text: 'New York', size: 1.35 },
  { lat: 34.0522, lng: -118.2437, text: 'Los Angeles', size: 1.2 },
  { lat: 41.8781, lng: -87.6298, text: 'Chicago', size: 1.12 },
  { lat: 43.6532, lng: -79.3832, text: 'Toronto', size: 1.12 },
  { lat: -23.5505, lng: -46.6333, text: 'São Paulo', size: 1.2 },
  { lat: -34.6037, lng: -58.3816, text: 'Buenos Aires', size: 1.12 },
  { lat: -33.8688, lng: 151.2093, text: 'Sydney', size: 1.2 },
  { lat: -37.8136, lng: 144.9631, text: 'Melbourne', size: 1.05 },
  { lat: -26.2041, lng: 28.0473, text: 'Johannesburg', size: 1.05 },
  { lat: 6.5244, lng: 3.3792, text: 'Lagos', size: 1.05 },
  { lat: 39.9042, lng: 116.4074, text: 'Beijing', size: 1.28 },
  { lat: 31.2304, lng: 121.4737, text: 'Shanghai', size: 1.28 },
];

/** ISO alpha-2 codes for country labels on the globe. */
export const GLOBE_COUNTRY_CODES = [
  'US', 'CA', 'MX', 'BR', 'AR', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'CH', 'AT', 'PL',
  'SE', 'NO', 'FI', 'DK', 'IE', 'PT', 'GR', 'TR', 'RU', 'UA', 'RO', 'CZ', 'HU',
  'EG', 'ZA', 'NG', 'KE', 'SA', 'AE', 'IL', 'IR', 'IQ', 'PK', 'IN', 'BD', 'CN', 'JP', 'KR',
  'TH', 'VN', 'ID', 'MY', 'SG', 'PH', 'AU', 'NZ',
] as const;
