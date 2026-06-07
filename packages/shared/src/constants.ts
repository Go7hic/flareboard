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
  performance: 'performance',
  record: 'record',
} as const;

export const EVENT_TYPE = {
  pageView: 1,
  customEvent: 2,
  linkEvent: 3,
  pixelEvent: 4,
  performance: 5,
} as const;

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
