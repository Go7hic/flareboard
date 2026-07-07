import type { Env } from '../env';

export type StackFrameInput = {
  raw: string;
  functionName: string | null;
  file: string;
  line: number;
  column: number;
};

export type ResolvedStackFrame = StackFrameInput & {
  source: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
  resolved: boolean;
};

function parseStackFrames(stack: string): StackFrameInput[] {
  const frames: StackFrameInput[] = [];
  for (const line of stack.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;
    const match = trimmed.match(/at\s+(?:(.+?)\s+\()?(?:https?:\/\/[^/]+(\/[^:)]+)|([^:)]+)):(\d+):(\d+)\)?$/);
    if (!match) continue;
    const [, functionName, urlPath, barePath, lineText, columnText] = match;
    const file = (urlPath ?? barePath ?? '').replace(/^\//, '');
    if (!file) continue;
    frames.push({
      raw: line,
      functionName: functionName?.trim() || null,
      file,
      line: Number(lineText),
      column: Number(columnText),
    });
  }
  return frames;
}

function fileCandidates(file: string): string[] {
  const base = file.split('/').pop() ?? file;
  const mapFile = base.endsWith('.map') ? base : `${base}.map`;
  return Array.from(new Set([file, base, mapFile, `assets/${base}`, `assets/${mapFile}`]));
}

const CANDIDATE_CHUNK_SIZE = 90;

/**
 * Loads source-map content for every candidate file name in a few batched IN
 * queries instead of one lookup per candidate per stack frame.
 */
async function loadSourceMapContents(env: Env, websiteId: string, release: string, files: string[]) {
  const candidates = [...new Set(files.flatMap(fileCandidates))];
  const byFile = new Map<string, string>();
  for (let offset = 0; offset < candidates.length; offset += CANDIDATE_CHUNK_SIZE) {
    const chunk = candidates.slice(offset, offset + CANDIDATE_CHUNK_SIZE);
    const placeholders = chunk.map((_, index) => `?${index + 3}`).join(', ');
    const rows = await env.DB.prepare(
      `SELECT file, content
       FROM error_source_map
       WHERE website_id = ?1 AND release = ?2 AND file IN (${placeholders})`,
    )
      .bind(websiteId, release, ...chunk)
      .all<{ file: string; content: string }>();
    for (const row of rows.results ?? []) {
      if (row.content) byFile.set(row.file, row.content);
    }
  }
  return byFile;
}

function pickSourceMapContent(byFile: Map<string, string>, file: string) {
  for (const candidate of fileCandidates(file)) {
    const content = byFile.get(candidate);
    if (content) return content;
  }
  return null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeVLQ(mappings: string, state: { index: number }): number {
  let result = 0;
  let shift = 0;
  let digit = 0;
  do {
    if (state.index >= mappings.length) return 0;
    digit = B64.indexOf(mappings[state.index++]);
    result += (digit & 31) << shift;
    shift += 5;
  } while (digit >= 32);
  const negative = result & 1;
  result >>>= 1;
  return negative ? -result : result;
}

type MappingSegment = {
  generatedColumn: number;
  sourceIndex: number;
  sourceLine: number;
  sourceColumn: number;
};

function parseMappings(mappings: string): MappingSegment[][] {
  const lines: MappingSegment[][] = [[]];
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let generatedColumn = 0;
  const state = { index: 0 };

  while (state.index < mappings.length) {
    const char = mappings[state.index];
    if (char === ';') {
      lines.push([]);
      generatedColumn = 0;
      state.index++;
      continue;
    }
    if (char === ',') {
      state.index++;
      continue;
    }

    generatedColumn += decodeVLQ(mappings, state);
    if (state.index >= mappings.length || mappings[state.index] === ';' || mappings[state.index] === ',') {
      continue;
    }

    sourceIndex += decodeVLQ(mappings, state);
    if (state.index >= mappings.length || mappings[state.index] === ';' || mappings[state.index] === ',') {
      continue;
    }

    sourceLine += decodeVLQ(mappings, state);
    if (state.index >= mappings.length || mappings[state.index] === ';' || mappings[state.index] === ',') {
      continue;
    }

    sourceColumn += decodeVLQ(mappings, state);

    const lineIndex = lines.length - 1;
    lines[lineIndex].push({
      generatedColumn,
      sourceIndex,
      sourceLine,
      sourceColumn,
    });
  }

  return lines;
}

function lookupOriginal(
  map: { sources: string[]; mappings: string },
  generatedLine: number,
  generatedColumn: number,
): { source: string | null; sourceLine: number | null; sourceColumn: number | null } {
  const lineSegments = parseMappings(map.mappings)[generatedLine - 1] ?? [];
  if (!lineSegments.length) {
    return { source: map.sources[0] ?? null, sourceLine: null, sourceColumn: null };
  }

  let match = lineSegments[0];
  for (const segment of lineSegments) {
    if (segment.generatedColumn <= generatedColumn) match = segment;
    else break;
  }

  return {
    source: map.sources[match.sourceIndex] ?? null,
    sourceLine: match.sourceLine + 1,
    sourceColumn: match.sourceColumn,
  };
}

function resolveFrame(mapJson: string, frame: StackFrameInput): ResolvedStackFrame {
  try {
    const map = JSON.parse(mapJson) as { version?: number; sources?: string[]; mappings?: string };
    if (map.version !== 3 || !Array.isArray(map.sources) || typeof map.mappings !== 'string') {
      return { ...frame, source: null, sourceLine: null, sourceColumn: null, resolved: false };
    }
    const original = lookupOriginal(
      { sources: map.sources, mappings: map.mappings },
      frame.line,
      frame.column,
    );
    return {
      ...frame,
      source: original.source,
      sourceLine: original.sourceLine,
      sourceColumn: original.sourceColumn,
      resolved: Boolean(original.source),
    };
  } catch {
    return { ...frame, source: null, sourceLine: null, sourceColumn: null, resolved: false };
  }
}

export async function resolveErrorStack(
  env: Env,
  websiteId: string,
  release: string | null | undefined,
  stack: string,
): Promise<ResolvedStackFrame[]> {
  const normalizedRelease = release?.trim();
  if (!normalizedRelease || !stack.trim()) return [];

  const frames = parseStackFrames(stack);
  if (!frames.length) return [];
  const contentByFile = await loadSourceMapContents(
    env,
    websiteId,
    normalizedRelease,
    frames.map((frame) => frame.file),
  );

  return frames.map((frame) => {
    const content = pickSourceMapContent(contentByFile, frame.file);
    if (!content) {
      return { ...frame, source: null, sourceLine: null, sourceColumn: null, resolved: false };
    }
    return resolveFrame(content, frame);
  });
}
