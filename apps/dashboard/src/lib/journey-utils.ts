export const JOURNEY_STEP_SEP = ' → ';

export const JOURNEY_DEPTH_OPTIONS = [2, 3, 4, 5, 6, 7] as const;
export const DEFAULT_JOURNEY_DEPTH = 5;

export type JourneyPathRow = { path: string; count: number };

export type JourneyFlowResponse = {
  prefix: string[];
  depth: number;
  total: number;
  next: JourneyPathRow[];
  paths: JourneyPathRow[];
};

export type JourneyNodeState = 'selected' | 'connected' | 'inactive';

export type JourneyColumnNode = {
  name: string;
  count: number;
  columnIndex: number;
  state: JourneyNodeState;
};

export type JourneyEdge = {
  fromColumn: number;
  fromName: string;
  toColumn: number;
  toName: string;
  count: number;
};

export type JourneyColumn = {
  columnIndex: number;
  nodes: JourneyColumnNode[];
  visitorCount: number;
  dropOffPct: number | null;
};

export function parseJourneyPath(path: string): string[] {
  return path.split(JOURNEY_STEP_SEP).map((s) => s.trim()).filter(Boolean);
}

export function formatJourneyPath(steps: string[]): string {
  return steps.join(JOURNEY_STEP_SEP);
}

export function journeyFlowQuery(steps: string[], limit = 50): string {
  const params = new URLSearchParams();
  params.set('flow', '1');
  params.set('limit', String(limit));
  for (const step of steps) {
    params.append('step', step);
  }
  return `&${params.toString()}`;
}

export function journeyMatchesPrefix(path: string, prefix: string[]): boolean {
  if (!prefix.length) return true;
  const steps = parseJourneyPath(path);
  if (steps.length < prefix.length) return false;
  return prefix.every((step, i) => steps[i] === step);
}

export type JourneyColumnSelection = (string | null)[];

export function emptyJourneySelection(maxDepth: number): JourneyColumnSelection {
  return Array.from({ length: maxDepth }, () => null);
}

export function hasJourneySelection(selected: JourneyColumnSelection): boolean {
  return selected.some((step) => step !== null);
}

function pathMatchesColumnSelection(steps: string[], selected: JourneyColumnSelection): boolean {
  for (let i = 0; i < selected.length; i++) {
    const sel = selected[i];
    if (sel !== null && steps[i] !== sel) return false;
  }
  return true;
}

export function filterPathsByColumnSelection(
  paths: JourneyPathRow[],
  selected: JourneyColumnSelection,
): JourneyPathRow[] {
  if (!hasJourneySelection(selected)) return paths;
  return paths.filter(({ path }) => pathMatchesColumnSelection(parseJourneyPath(path), selected));
}

/** Matching visits for contiguous prefix from column 0. */
export function journeyMatchingVisits(
  paths: JourneyPathRow[],
  selected: JourneyColumnSelection,
): number {
  const prefix = getContiguousPrefix(selected);
  if (prefix.length > 0) {
    return filterPathsByPrefix(paths, prefix).reduce((sum, row) => sum + row.count, 0);
  }
  return filterPathsByColumnSelection(paths, selected).reduce((sum, row) => sum + row.count, 0);
}

export function filterPathsByPrefix(paths: JourneyPathRow[], prefix: string[]): JourneyPathRow[] {
  return prefix.length ? paths.filter((p) => journeyMatchesPrefix(p.path, prefix)) : paths;
}

/** Contiguous selection from column 0 (stops at first gap). */
export function getContiguousPrefix(selected: JourneyColumnSelection): string[] {
  const prefix: string[] = [];
  for (let i = 0; i < selected.length; i++) {
    if (selected[i] === null) break;
    prefix.push(selected[i]!);
  }
  return prefix;
}

/** Node names at columnIndex reachable from a path prefix. */
export function reachableNodeNames(
  paths: JourneyPathRow[],
  prefix: string[],
  columnIndex: number,
): Set<string> {
  const names = new Set<string>();
  for (const { path } of filterPathsByPrefix(paths, prefix)) {
    const steps = parseJourneyPath(path);
    if (steps.length > columnIndex) names.add(steps[columnIndex]);
  }
  return names;
}

function journeyNodeState(
  columnIndex: number,
  name: string,
  selected: JourneyColumnSelection,
  paths: JourneyPathRow[],
): JourneyNodeState {
  if (selected[columnIndex] === name) return 'selected';

  const prefix = getContiguousPrefix(selected);
  if (prefix.length > 0) {
    if (columnIndex < prefix.length && prefix[columnIndex] === name) return 'selected';
    if (columnIndex >= prefix.length - 1 && reachableNodeNames(paths, prefix, columnIndex).has(name)) {
      return 'connected';
    }
  }

  return 'inactive';
}

function isNodeHighlighted(
  columnIndex: number,
  name: string,
  selected: JourneyColumnSelection,
  paths: JourneyPathRow[],
): boolean {
  return journeyNodeState(columnIndex, name, selected, paths) !== 'inactive';
}

export function buildJourneyColumns(
  paths: JourneyPathRow[],
  maxDepth: number,
  selected: JourneyColumnSelection,
): JourneyColumn[] {
  const columnMaps: Map<string, number>[] = Array.from({ length: maxDepth }, () => new Map());

  // Always list every path at each step — never hide inactive nodes.
  for (const { path, count } of paths) {
    const steps = parseJourneyPath(path);
    for (let i = 0; i < Math.min(steps.length, maxDepth); i++) {
      const step = steps[i];
      columnMaps[i].set(step, (columnMaps[i].get(step) ?? 0) + count);
    }
  }

  const columns: JourneyColumn[] = [];
  let prevVisitorCount = 0;
  const prefix = getContiguousPrefix(selected);

  for (let i = 0; i < maxDepth; i++) {
    const nodes = [...columnMaps[i].entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        name,
        count,
        columnIndex: i,
        state: journeyNodeState(i, name, selected, paths),
      }));

    const highlighted = nodes.filter((n) => n.state !== 'inactive');
    const visitorCount =
      prefix.length > 0 && highlighted.length > 0
        ? highlighted.reduce((sum, n) => sum + n.count, 0)
        : nodes.reduce((sum, n) => sum + n.count, 0);
    const dropOffPct =
      i > 0 && prevVisitorCount > 0
        ? Math.round(((prevVisitorCount - visitorCount) / prevVisitorCount) * 100)
        : null;

    columns.push({ columnIndex: i, nodes, visitorCount, dropOffPct });
    if (visitorCount > 0) prevVisitorCount = visitorCount;
  }

  return columns;
}

export function buildJourneyEdges(
  paths: JourneyPathRow[],
  maxDepth: number,
  selected: JourneyColumnSelection,
): JourneyEdge[] {
  const edgeMap = new Map<string, JourneyEdge>();
  const prefix = getContiguousPrefix(selected);

  const addEdge = (fromColumn: number, fromName: string, toColumn: number, toName: string, count: number) => {
    const key = `${fromColumn}:${fromName}→${toColumn}:${toName}`;
    const existing = edgeMap.get(key);
    if (existing) existing.count += count;
    else edgeMap.set(key, { fromColumn, fromName, toColumn, toName, count });
  };

  if (prefix.length > 0) {
    const matching = filterPathsByPrefix(paths, prefix);
    for (const { path, count } of matching) {
      const steps = parseJourneyPath(path);
      for (let j = 0; j < Math.min(steps.length - 1, maxDepth - 1); j++) {
        const fromName = steps[j];
        const toName = steps[j + 1];
        if (!isNodeHighlighted(j, fromName, selected, paths)) continue;
        if (!isNodeHighlighted(j + 1, toName, selected, paths)) continue;
        addEdge(j, fromName, j + 1, toName, count);
      }
    }
  } else {
    for (let i = 0; i < maxDepth - 1; i++) {
      const fromName = selected[i];
      const toName = selected[i + 1];
      if (!fromName || !toName) continue;
      for (const { path, count } of paths) {
        const steps = parseJourneyPath(path);
        if (steps[i] === fromName && steps[i + 1] === toName) {
          addEdge(i, fromName, i + 1, toName, count);
        }
      }
    }
  }

  return [...edgeMap.values()].sort((a, b) => b.count - a.count);
}

export function journeyNodeKey(columnIndex: number, name: string): string {
  return `${columnIndex}:${name}`;
}

/** Umami-style: pick any column; link adjacent selected steps. */
export function applyJourneyNodeClick(
  selected: JourneyColumnSelection,
  columnIndex: number,
  name: string,
  maxDepth: number,
): JourneyColumnSelection {
  const next = [...selected];
  while (next.length < maxDepth) next.push(null);

  if (next[columnIndex] === name) {
    for (let j = columnIndex; j < maxDepth; j++) next[j] = null;
    return next;
  }

  next[columnIndex] = name;
  for (let j = columnIndex + 1; j < maxDepth; j++) next[j] = null;
  return next;
}

export function filterJourneyRows(rows: JourneyPathRow[], query: string): JourneyPathRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => row.path.toLowerCase().includes(q));
}

export function nodeConversionPct(nodeCount: number, previousVisitorCount: number): number {
  if (previousVisitorCount <= 0) return 0;
  return Math.round((nodeCount / previousVisitorCount) * 100);
}
