import { describe, expect, it } from 'vitest';
import { pendingStoreMigrations, STORE_MIGRATIONS } from '../../src/store/schema';

const migrations = [1, 2, 3, 4, 5, 6].map((version) => ({ version }));
const legacy = [1, 2, 3, 6];
const versions = (meta: Array<[string, string]>) =>
  pendingStoreMigrations(new Map(meta), migrations, legacy).map((migration) => migration.version);

describe('website store migrations', () => {
  it('runs every migration on a new store, in version order', () => {
    expect(versions([])).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('applies lower versions merged after a higher one (legacy store at 6 misses 4 and 5)', () => {
    expect(versions([['schema_version', '6']])).toEqual([4, 5]);
  });

  it('treats a legacy store at 3 as having 1-3 only', () => {
    expect(versions([['schema_version', '3']])).toEqual([4, 5, 6]);
  });

  it('skips versions recorded individually, whatever the order they ran in', () => {
    expect(
      versions([
        ['schema_version', '6'],
        ['migration:4', '1'],
      ]),
    ).toEqual([5]);
  });

  it('has unique versions', () => {
    const all = STORE_MIGRATIONS.map((migration) => migration.version);
    expect(new Set(all).size).toBe(all.length);
  });
});
