import { isInAppFrame, normalizeStackFrame, parseStackTrace, stackFramePath, type StackFrame } from '@flareboard/shared';
import type { Env } from '../env';

/**
 * Source maps: metadata in D1 (`error_source_map`), content in R2 under
 * `sourcemaps/<websiteId>/<sourceMapId>.map` (REPLAY_BUCKET, see apps/api/wrangler.jsonc).
 * Rows uploaded before R2 kept the map in the `content` column; they stay readable and the cron
 * moves them (migrateInlineSourceMapsToR2). Website erasure deletes the prefix (data-deletion.ts).
 */

export const SOURCE_MAP_OBJECT_PREFIX = 'sourcemaps/';
/** Largest map accepted for R2 storage. */
export const MAX_SOURCE_MAP_BYTES = 20 * 1024 * 1024;
/** Without an R2 binding maps fall back to D1, whose rows are capped at 2 MB. */
const MAX_INLINE_SOURCE_MAP_BYTES = 1_900_000;
const CONTEXT_LINES = 5;
const MAX_CONTEXT_LINE_LENGTH = 240;
const MAX_RESOLVED_FRAMES = 50;
const MAX_MAPS_PER_STACK = 10;

export type ErrorSourceMapRow = {
  id: string;
  websiteId: string;
  release: string;
  file: string;
  size: number;
  createdAt: number | null;
  updatedAt: number | null;
};

export type SourceContext = {
  /** 1-based line number of lines[0]. */
  startLine: number;
  lines: string[];
};

export type ResolvedStackFrame = {
  raw: string;
  functionName: string | null;
  file: string;
  line: number | null;
  column: number | null;
  inApp: boolean;
  /** Original source path from the source map. */
  source: string | null;
  /** 1-based original line and column. */
  sourceLine: number | null;
  sourceColumn: number | null;
  resolved: boolean;
  /** Original lines around sourceLine when the map embeds sourcesContent. */
  context: SourceContext | null;
};

export class SourceMapUploadError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 = 400,
  ) {
    super(message);
  }
}

export function sourceMapObjectPrefix(websiteId: string) {
  return `${SOURCE_MAP_OBJECT_PREFIX}${websiteId}/`;
}

function sourceMapObjectKey(websiteId: string, sourceMapId: string) {
  return `${sourceMapObjectPrefix(websiteId)}${sourceMapId}.map`;
}

/** `https://cdn.example.com/assets/app.js.map?v=1` and `/assets/app.js.map` both become `assets/app.js.map`. */
export function normalizeSourceMapFile(file: string) {
  return stackFramePath(file.trim()) || file.trim();
}

type RawSourceMap = {
  version?: unknown;
  sources?: unknown;
  sourcesContent?: unknown;
  sourceRoot?: unknown;
  mappings?: unknown;
  sections?: unknown;
};

/** Rejects content that is not a JSON source map v3 we can resolve with. */
export function validateSourceMapContent(content: string) {
  let parsed: RawSourceMap;
  try {
    parsed = JSON.parse(content) as RawSourceMap;
  } catch {
    throw new SourceMapUploadError('Source map must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 3) {
    throw new SourceMapUploadError('Source map must be a version 3 source map.');
  }
  if (Array.isArray(parsed.sections)) {
    throw new SourceMapUploadError('Indexed source maps (with "sections") are not supported. Upload one map per file.');
  }
  if (typeof parsed.mappings !== 'string' || !Array.isArray(parsed.sources)) {
    throw new SourceMapUploadError('Source map needs "sources" and "mappings".');
  }
}

const SOURCE_MAP_COLUMNS = `source_map_id as id,
            website_id as websiteId,
            release,
            file,
            size,
            created_at as createdAt,
            updated_at as updatedAt`;

export async function storeErrorSourceMap(env: Env, websiteId: string, release: string, file: string, content: string) {
  const normalizedRelease = release.trim();
  const normalizedFile = normalizeSourceMapFile(file);
  if (!normalizedRelease) throw new SourceMapUploadError('Release is required');
  if (!normalizedFile) throw new SourceMapUploadError('File is required');
  if (!content) throw new SourceMapUploadError('Source map content is required');
  const size = new TextEncoder().encode(content).length;
  const bucket = env.REPLAY_BUCKET;
  const limit = bucket ? MAX_SOURCE_MAP_BYTES : MAX_INLINE_SOURCE_MAP_BYTES;
  if (size > limit) throw new SourceMapUploadError(`Source map is larger than ${limit} bytes.`, 413);
  validateSourceMapContent(content);

  const existing = await env.DB.prepare(
    `SELECT source_map_id as id FROM error_source_map WHERE website_id = ?1 AND release = ?2 AND file = ?3`,
  )
    .bind(websiteId, normalizedRelease, normalizedFile)
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const now = Date.now();

  let objectKey: string | null = null;
  if (bucket) {
    objectKey = sourceMapObjectKey(websiteId, id);
    await bucket.put(objectKey, content, { httpMetadata: { contentType: 'application/json' } });
  }

  await env.DB.prepare(
    `INSERT INTO error_source_map (source_map_id, website_id, release, file, content, object_key, size, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
     ON CONFLICT(website_id, release, file)
     DO UPDATE SET content = excluded.content,
                   object_key = excluded.object_key,
                   size = excluded.size,
                   updated_at = excluded.updated_at`,
  )
    .bind(id, websiteId, normalizedRelease, normalizedFile, objectKey ? '' : content, objectKey, size, now)
    .run();

  const row = await env.DB.prepare(
    `SELECT ${SOURCE_MAP_COLUMNS} FROM error_source_map WHERE website_id = ?1 AND release = ?2 AND file = ?3 LIMIT 1`,
  )
    .bind(websiteId, normalizedRelease, normalizedFile)
    .first<ErrorSourceMapRow>();
  if (!row) throw new Error('Source map upload failed');
  return row;
}

export async function listErrorSourceMaps(env: Env, websiteId: string, release?: string) {
  const normalizedRelease = release?.trim() || null;
  const rows = await env.DB.prepare(
    `SELECT ${SOURCE_MAP_COLUMNS}
     FROM error_source_map
     WHERE website_id = ?1
       AND (?2 IS NULL OR release = ?2)
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 200`,
  )
    .bind(websiteId, normalizedRelease)
    .all<ErrorSourceMapRow>();
  return rows.results ?? [];
}

export async function deleteErrorSourceMap(env: Env, websiteId: string, sourceMapId: string) {
  const row = await env.DB.prepare(
    `SELECT object_key as objectKey FROM error_source_map WHERE website_id = ?1 AND source_map_id = ?2`,
  )
    .bind(websiteId, sourceMapId)
    .first<{ objectKey: string | null }>();
  if (!row) return false;
  if (row.objectKey && env.REPLAY_BUCKET) await env.REPLAY_BUCKET.delete(row.objectKey);
  await env.DB.prepare(`DELETE FROM error_source_map WHERE website_id = ?1 AND source_map_id = ?2`)
    .bind(websiteId, sourceMapId)
    .run();
  return true;
}

/** Copies maps still stored inline in D1 to R2 and clears the column. Idempotent, bounded per call. */
export async function migrateInlineSourceMapsToR2(env: Env, limit = 25) {
  const bucket = env.REPLAY_BUCKET;
  if (!bucket) return { moved: 0 };
  const rows = await env.DB.prepare(
    `SELECT source_map_id as id, website_id as websiteId
     FROM error_source_map
     WHERE object_key IS NULL AND content <> ''
     LIMIT ?1`,
  )
    .bind(limit)
    .all<{ id: string; websiteId: string }>();
  let moved = 0;
  // One map at a time: rows can be close to 2 MB each.
  for (const { id, websiteId } of rows.results ?? []) {
    const row = await env.DB.prepare(`SELECT content FROM error_source_map WHERE source_map_id = ?1`)
      .bind(id)
      .first<{ content: string }>();
    if (!row?.content) continue;
    const objectKey = sourceMapObjectKey(websiteId, id);
    await bucket.put(objectKey, row.content, { httpMetadata: { contentType: 'application/json' } });
    await env.DB.prepare(
      `UPDATE error_source_map SET object_key = ?2, content = '' WHERE source_map_id = ?1 AND object_key IS NULL`,
    )
      .bind(id, objectKey)
      .run();
    moved++;
  }
  return { moved };
}

// ---------------------------------------------------------------------------------------------
// Resolution

function fileCandidates(file: string): string[] {
  const base = file.split('/').pop() ?? file;
  const mapFile = base.endsWith('.map') ? base : `${base}.map`;
  const pathMap = file.endsWith('.map') ? file : `${file}.map`;
  return Array.from(new Set([pathMap, file, mapFile, base, `assets/${mapFile}`, `assets/${base}`]));
}

type SourceMapRef = { id: string; file: string; release: string; objectKey: string | null; updatedAt: number | null };

async function loadSourceMapRefs(
  env: Env,
  websiteId: string,
  release: string | null,
  files: string[],
): Promise<Map<string, SourceMapRef>> {
  const candidates = [...new Set(files.flatMap(fileCandidates))];
  const byFile = new Map<string, SourceMapRef>();
  if (!candidates.length) return byFile;
  const rows = await env.DB.prepare(
    `SELECT source_map_id as id, file, release, object_key as objectKey, updated_at as updatedAt
     FROM error_source_map
     WHERE website_id = ?1
       AND (?2 IS NULL OR release = ?2)
       AND file IN (SELECT value FROM json_each(?3))
     ORDER BY updated_at DESC`,
  )
    .bind(websiteId, release, JSON.stringify(candidates))
    .all<SourceMapRef>();
  // Newest first, so a release-less lookup keeps the latest upload per file.
  for (const row of rows.results ?? []) {
    if (!byFile.has(row.file)) byFile.set(row.file, row);
  }
  return byFile;
}

function pickSourceMap(byFile: Map<string, SourceMapRef>, file: string) {
  for (const candidate of fileCandidates(file)) {
    const ref = byFile.get(candidate);
    if (ref) return ref;
  }
  return null;
}

const B64 = new Int8Array(128).fill(-1);
'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((char, index) => {
  B64[char.charCodeAt(0)] = index;
});

/** [generatedColumn, sourceIndex, sourceLine, sourceColumn] (0-based); length 1 when unmapped. */
type Segment = number[];

/**
 * Decodes the `mappings` VLQ string, keeping only the generated lines we need. Source index,
 * line and column are relative across the whole string, so every segment is decoded, but only
 * the wanted lines are stored.
 */
export function decodeMappings(mappings: string, wantedLines: Set<number>): Map<number, Segment[]> {
  const result = new Map<number, Segment[]>();
  const maxLine = Math.max(-1, ...wantedLines);
  let line = 0;
  let generatedColumn = 0;
  const state = [0, 0, 0, 0]; // sourceIndex, sourceLine, sourceColumn, nameIndex
  let fields: number[] = [];
  let value = 0;
  let shift = 0;

  const flushSegment = () => {
    if (!fields.length) return;
    generatedColumn += fields[0]!;
    let segment: Segment = [generatedColumn];
    if (fields.length >= 4) {
      state[0] += fields[1]!;
      state[1] += fields[2]!;
      state[2] += fields[3]!;
      if (fields.length >= 5) state[3] += fields[4]!;
      segment = [generatedColumn, state[0]!, state[1]!, state[2]!];
    }
    if (wantedLines.has(line)) {
      const list = result.get(line) ?? [];
      list.push(segment);
      result.set(line, list);
    }
    fields = [];
  };

  for (let index = 0; index < mappings.length; index++) {
    const char = mappings.charCodeAt(index);
    if (char === 59 /* ; */) {
      flushSegment();
      line++;
      generatedColumn = 0;
      if (line > maxLine) break;
      continue;
    }
    if (char === 44 /* , */) {
      flushSegment();
      continue;
    }
    const digit = char < 128 ? B64[char]! : -1;
    if (digit < 0) continue;
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  flushSegment();
  for (const segments of result.values()) segments.sort((a, b) => a[0]! - b[0]!);
  return result;
}

type ParsedMap = {
  sources: string[];
  sourcesContent: Array<string | null>;
  mappings: string;
  lines: Map<number, Segment[]>;
  contentLines: Map<number, string[]>;
};

function cleanSourcePath(source: string, sourceRoot: string) {
  const joined = sourceRoot && !/^[a-z]+:/i.test(source) ? `${sourceRoot.replace(/\/?$/, '/')}${source}` : source;
  return joined
    .replace(/^webpack:\/\/[^/]*\//, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\/\/?/i, '')
    .replace(/^(?:\.\.?\/)+/, '');
}

function parseSourceMap(content: string, wantedLines: Set<number>): ParsedMap | null {
  try {
    const raw = JSON.parse(content) as RawSourceMap;
    if (raw.version !== 3 || typeof raw.mappings !== 'string' || !Array.isArray(raw.sources)) return null;
    const sourceRoot = typeof raw.sourceRoot === 'string' ? raw.sourceRoot : '';
    return {
      sources: raw.sources.map((source) => (typeof source === 'string' ? cleanSourcePath(source, sourceRoot) : '')),
      sourcesContent: Array.isArray(raw.sourcesContent)
        ? raw.sourcesContent.map((value) => (typeof value === 'string' ? value : null))
        : [],
      mappings: raw.mappings,
      lines: decodeMappings(raw.mappings, wantedLines),
      contentLines: new Map(),
    };
  } catch {
    return null;
  }
}

function lookupSegment(segments: Segment[] | undefined, column: number) {
  if (!segments?.length) return null;
  let low = 0;
  let high = segments.length - 1;
  let match: Segment | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid]![0]! <= column) {
      match = segments[mid]!;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return match && match.length >= 4 ? match : null;
}

function sourceContext(map: ParsedMap, sourceIndex: number, line: number): SourceContext | null {
  const content = map.sourcesContent[sourceIndex];
  if (typeof content !== 'string') return null;
  let lines = map.contentLines.get(sourceIndex);
  if (!lines) {
    lines = content.split(/\r?\n/);
    map.contentLines.set(sourceIndex, lines);
  }
  if (line < 1 || line > lines.length) return null;
  const startLine = Math.max(1, line - CONTEXT_LINES);
  const endLine = Math.min(lines.length, line + CONTEXT_LINES);
  return {
    startLine,
    lines: lines.slice(startLine - 1, endLine).map((text) => text.slice(0, MAX_CONTEXT_LINE_LENGTH)),
  };
}

function unresolvedFrame(frame: StackFrame): ResolvedStackFrame {
  return {
    raw: frame.raw.trim(),
    functionName: frame.functionName,
    file: frame.file,
    line: frame.line,
    column: frame.column,
    inApp: isInAppFrame(frame),
    source: null,
    sourceLine: null,
    sourceColumn: null,
    resolved: false,
    context: null,
  };
}

function resolveFrame(map: ParsedMap, frame: StackFrame): ResolvedStackFrame {
  const base = unresolvedFrame(frame);
  if (frame.line == null) return base;
  // Browsers report 1-based columns, source maps store 0-based ones.
  const segment = lookupSegment(map.lines.get(frame.line - 1), Math.max(0, (frame.column ?? 1) - 1));
  if (!segment) return base;
  const [, sourceIndex, sourceLine, sourceColumn] = segment as [number, number, number, number];
  const source = map.sources[sourceIndex];
  if (!source) return base;
  return {
    ...base,
    source,
    sourceLine: sourceLine + 1,
    sourceColumn: sourceColumn + 1,
    resolved: true,
    context: sourceContext(map, sourceIndex, sourceLine + 1),
  };
}

async function readSourceMapContent(env: Env, ref: SourceMapRef) {
  if (ref.objectKey) {
    const object = await env.REPLAY_BUCKET?.get(ref.objectKey);
    return object ? object.text() : null;
  }
  const row = await env.DB.prepare(`SELECT content FROM error_source_map WHERE source_map_id = ?1`)
    .bind(ref.id)
    .first<{ content: string }>();
  return row?.content || null;
}

/**
 * Parses a stack (V8, Firefox or Safari format) and maps each frame through the source maps
 * uploaded for `release`. Without a release, only files with a content hash in their name are
 * looked up across releases (the hash makes the match unambiguous).
 */
export async function resolveErrorStack(
  env: Env,
  websiteId: string,
  release: string | null | undefined,
  stack: string,
): Promise<ResolvedStackFrame[]> {
  const frames = parseStackTrace(stack)
    .filter((frame) => !frame.native && frame.file)
    .slice(0, MAX_RESOLVED_FRAMES);
  if (!frames.length) return [];

  const normalizedRelease = release?.trim() || null;
  const lookupFiles = frames
    .filter((frame) => normalizedRelease || normalizeStackFrame(frame).file !== frame.file)
    .map((frame) => frame.file);
  const refs = await loadSourceMapRefs(env, websiteId, normalizedRelease, lookupFiles);

  const framesByMap = new Map<string, { ref: SourceMapRef; lines: Set<number> }>();
  const refByFrame = new Map<StackFrame, SourceMapRef>();
  for (const frame of frames) {
    if (normalizedRelease == null && normalizeStackFrame(frame).file === frame.file) continue;
    const ref = pickSourceMap(refs, frame.file);
    if (!ref || frame.line == null) continue;
    if (!framesByMap.has(ref.id)) {
      if (framesByMap.size >= MAX_MAPS_PER_STACK) continue;
      framesByMap.set(ref.id, { ref, lines: new Set() });
    }
    framesByMap.get(ref.id)!.lines.add(frame.line - 1);
    refByFrame.set(frame, ref);
  }

  const parsed = new Map<string, ParsedMap | null>();
  for (const { ref, lines } of framesByMap.values()) {
    const content = await readSourceMapContent(env, ref);
    parsed.set(ref.id, content ? parseSourceMap(content, lines) : null);
  }

  return frames.map((frame) => {
    const ref = refByFrame.get(frame);
    const map = ref ? parsed.get(ref.id) : null;
    return map ? resolveFrame(map, frame) : unresolvedFrame(frame);
  });
}
