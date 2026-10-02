import { useMemo, useState } from 'react';
import { ChevronRight, Database, FileCode2 } from 'lucide-react';
import { SectionCard } from '../SectionCard';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import type { WarehouseSchemaResponse } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { warehouseSourceLabel } from './WarehouseDialogs';

function tableQuery(name: string) {
  return `SELECT *\nFROM ${name}\nWHERE website_id = ?1\nLIMIT 50`;
}

/** A table row that expands to its columns and a "query this table" action. */
function TableItem({
  name,
  meta,
  description,
  columns,
  emptyText,
  onUse,
  useLabel,
}: {
  name: string;
  meta?: string;
  description?: string;
  columns: string[];
  emptyText?: string;
  onUse?: () => void;
  useLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cn('q-schema-item', open && 'is-open')}>
      <button type="button" className="q-schema-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronRight className={cn('q-stack-chevron', open && 'is-open')} size={14} strokeWidth={2} aria-hidden />
        <span className="q-schema-name">{name}</span>
        {meta ? <span className="q-schema-meta">{meta}</span> : null}
      </button>
      {open ? (
        <div className="q-schema-body">
          {description ? <p className="q-field-hint">{description}</p> : null}
          {columns.length ? (
            <div className="q-schema-columns">
              {columns.map((column) => (
                <span key={column} className="q-schema-column">
                  {column}
                </span>
              ))}
            </div>
          ) : emptyText ? (
            <p className="q-field-hint">{emptyText}</p>
          ) : null}
          {onUse ? (
            <Button type="button" variant="outline" size="xs" onClick={onUse}>
              {useLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Side column of the query tab: example queries grouped by area, imported data and the site
 * tables (expand for columns). Picking one loads its SQL into the editor.
 */
export function WarehouseSchemaPanel({
  schema,
  loading,
  onUseSql,
}: {
  schema: WarehouseSchemaResponse | undefined;
  loading: boolean;
  onUseSql: (sql: string) => void;
}) {
  const groups = useMemo(() => {
    const byCategory = new Map<string, Array<{ name: string; sql: string }>>();
    for (const example of schema?.examples ?? []) {
      const key = example.category ?? '';
      byCategory.set(key, [...(byCategory.get(key) ?? []), example]);
    }
    return [...byCategory.entries()];
  }, [schema?.examples]);
  const imported = schema?.importedSources ?? [];

  return (
    <div className="stack q-schema">
      <SectionCard flush title={t('warehouseExamples')}>
        {loading && !schema ? (
          <div className="q-schema-skeleton">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <div className="q-example-groups">
            {groups.map(([category, examples]) => (
              <div key={category || 'other'} className="q-example-group">
                {category ? <h3 className="q-example-category">{category}</h3> : null}
                <ul className="q-example-list">
                  {examples.map((example) => (
                    <li key={example.name}>
                      <button type="button" className="q-example" onClick={() => onUseSql(example.sql)}>
                        <FileCode2 aria-hidden />
                        <span>{example.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {imported.length ? (
        <SectionCard flush title={t('warehouseImportedData')}>
          <ul className="q-schema-list">
            {imported.flatMap((source) =>
              source.tables.map((table, index) => (
                <TableItem
                  key={`${source.id}:${table.name}`}
                  name={table.name}
                  meta={`${source.name} · ${warehouseSourceLabel(source.type)} · ${t('warehouseImportedRows').replace('{count}', formatNumber(table.rowCount))}`}
                  columns={table.columns}
                  emptyText={t('warehouseNoImportedFields')}
                  useLabel={t('warehouseUseExample')}
                  onUse={index === 0 && source.exampleSql ? () => onUseSql(source.exampleSql!) : undefined}
                />
              )),
            )}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard flush title={t('warehouseSiteTables')}>
        {loading && !schema ? (
          <div className="q-schema-skeleton">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : schema?.tables.length ? (
          <ul className="q-schema-list">
            {schema.tables.map((table) => (
              <TableItem
                key={table.name}
                name={table.name}
                meta={t('qualityColumnsCount').replace('{count}', formatNumber(table.columns.length))}
                description={table.description}
                columns={table.columns}
                useLabel={t('warehouseUseTable')}
                onUse={() => onUseSql(tableQuery(table.name))}
              />
            ))}
          </ul>
        ) : (
          <div className="q-schema-skeleton">
            <Database aria-hidden className="q-schema-empty-icon" />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
