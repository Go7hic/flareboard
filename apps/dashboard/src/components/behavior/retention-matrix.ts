/**
 * Weekly cohort retention (`/api/reports/retention`) as a matrix: one row per cohort week with its
 * size (week 0) and, for weeks 1…N, the users who came back and their share of the cohort.
 * The API leaves out weeks with no returning users, so a started week without a row counts as 0;
 * weeks that have not started yet stay empty.
 */

export type RetentionApiRow = { cohortWeek: string; weekOffset: number; users: number };

export type RetentionCell = {
  offset: number;
  /** null: the week has not started yet. */
  users: number | null;
  pct: number | null;
  /** The week has started but not ended (its numbers still grow). */
  inProgress: boolean;
};

export type RetentionCohort = {
  week: string;
  startMs: number;
  size: number;
  cells: RetentionCell[];
};

export type RetentionAverage = {
  offset: number;
  /** Returning users ÷ cohort size over every cohort that reached this week (weighted mean). */
  pct: number | null;
  users: number;
  size: number;
  cohorts: number;
};

export type RetentionMatrix = {
  cohorts: RetentionCohort[];
  /** 1…N: week 0 is the cohort itself, shown as its size. */
  offsets: number[];
  averages: RetentionAverage[];
  /** Highest retention share in the table (the top of the color scale). */
  maxPct: number;
  totalUsers: number;
};

const WEEK = 7 * 86_400_000;

function weekStartMs(week: string): number {
  const [y, m, d] = week.split('-').map(Number);
  if (!y || !m || !d) return Number.NaN;
  return Date.UTC(y, m - 1, d);
}

export function buildRetentionMatrix(rows: RetentionApiRow[], now: number): RetentionMatrix {
  const weeks = [...new Set(rows.map((row) => row.cohortWeek))].sort();
  const maxOffset = rows.reduce((max, row) => Math.max(max, row.weekOffset), 0);
  const offsets = Array.from({ length: maxOffset }, (_, index) => index + 1);
  const lookup = new Map(rows.map((row) => [`${row.cohortWeek}:${row.weekOffset}`, row.users]));

  let maxPct = 0;
  const cohorts = weeks.map((week): RetentionCohort => {
    const startMs = weekStartMs(week);
    const size = lookup.get(`${week}:0`) ?? 0;
    const cells = offsets.map((offset): RetentionCell => {
      const periodStart = startMs + offset * WEEK;
      const started = Number.isFinite(periodStart) ? periodStart <= now : true;
      const recorded = lookup.get(`${week}:${offset}`);
      const users = recorded ?? (started ? 0 : null);
      const pct = users != null && size > 0 ? (users / size) * 100 : null;
      if (pct != null) maxPct = Math.max(maxPct, pct);
      return { offset, users, pct, inProgress: started && periodStart + WEEK > now };
    });
    return { week, startMs, size, cells };
  });

  const averages = offsets.map((offset, index): RetentionAverage => {
    let users = 0;
    let size = 0;
    let count = 0;
    for (const cohort of cohorts) {
      const cell = cohort.cells[index];
      if (!cell || cell.users == null || cohort.size <= 0) continue;
      users += cell.users;
      size += cohort.size;
      count += 1;
    }
    return { offset, pct: size > 0 ? (users / size) * 100 : null, users, size, cohorts: count };
  });

  return {
    cohorts,
    offsets,
    averages,
    maxPct,
    totalUsers: cohorts.reduce((sum, cohort) => sum + cohort.size, 0),
  };
}

/** Steps of the sequential ramp (one hue, light → dark), capped so ink text stays readable. */
export const RETENTION_RAMP = [0.08, 0.16, 0.26, 0.38, 0.52, 0.68] as const;

/** Ramp step for a share relative to the table's maximum (0 for no returns). */
export function retentionRampStep(pct: number | null, maxPct: number): number {
  if (pct == null || pct <= 0 || maxPct <= 0) return 0;
  const intensity = Math.min(1, pct / maxPct);
  const index = Math.min(RETENTION_RAMP.length - 1, Math.floor(intensity * RETENTION_RAMP.length));
  return RETENTION_RAMP[index]!;
}
