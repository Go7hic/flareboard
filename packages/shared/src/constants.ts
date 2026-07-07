export const ROLES = {
  admin: 'admin',
  user: 'user',
  viewOnly: 'view-only',
  teamOwner: 'team-owner',
  teamManager: 'team-manager',
  teamMember: 'team-member',
  teamViewOnly: 'team-view-only',
} as const;

export const COLLECTION_TYPE = {
  event: 'event',
  identify: 'identify',
  group: 'group',
  performance: 'performance',
  record: 'record',
  heatmap: 'heatmap',
  error: 'error',
  log: 'log',
  ai: 'ai',
} as const;

export const EVENT_TYPE = {
  pageView: 1,
  customEvent: 2,
  linkEvent: 3,
  pixelEvent: 4,
  performance: 5,
  heatmapClick: 6,
  heatmapScroll: 7,
  error: 8,
  log: 9,
  ai: 10,
} as const;

/** @deprecated Use HEATMAP_NORM_SIZE — kept for backward compat in API responses */
export const HEATMAP_GRID_SIZE = 20;

/** Device-independent normalized coordinate range (0 .. NORM_SIZE-1). */
export const HEATMAP_NORM_SIZE = 1000;

export const HEATMAP_DEVICE_CLASSES = ['', 'desktop', 'mobile', 'tablet'] as const;
export type HeatmapDeviceClass = (typeof HEATMAP_DEVICE_CLASSES)[number];

export const ENTITY_TYPE = {
  website: 1,
  link: 2,
  pixel: 3,
  board: 4,
} as const;

export const DATA_TYPE = {
  string: 1,
  number: 2,
  boolean: 3,
  date: 4,
  array: 5,
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
export type CollectionType = (typeof COLLECTION_TYPE)[keyof typeof COLLECTION_TYPE];
