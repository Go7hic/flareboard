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

async function loadSourceMapContent(env: Env, websiteId: string, release: string, file: string) {
  for (const candidate of fileCandidates(file)) {
    const row = await env.DB.prepare(
      `SELECT content
       FROM error_source_map
       WHERE website_id = ?1 AND release = ?2 AND file = ?3
       LIMIT 1`,
    )
      .bind(websiteId, release, candidate)
      .first<{ content: string }>();
    if (row?.content) return row.content;
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
  const resolved: ResolvedStackFrame[] = [];

  for (const frame of frames) {
    const content = await loadSourceMapContent(env, websiteId, normalizedRelease, frame.file);
    if (!content) {
      resolved.push({ ...frame, source: null, sourceLine: null, sourceColumn: null, resolved: false });
      continue;
    }
    resolved.push(resolveFrame(content, frame));
  }

  return resolved;
}
