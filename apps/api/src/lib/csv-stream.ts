import { csvRow } from '@flareboard/shared';

/**
 * Streams a CSV body: the header first, then one chunk per batch the generator yields, so large
 * exports are read from the store page by page instead of being built in memory. Cells go
 * through `csvRow` (quoting and spreadsheet-formula neutralization).
 */
export function csvStream(header: string[], batches: AsyncIterator<unknown[][]>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let headerSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(encoder.encode(`${csvRow(header)}\n`));
        return;
      }
      try {
        const { value, done } = await batches.next();
        if (done) {
          controller.close();
          return;
        }
        if (value.length) controller.enqueue(encoder.encode(value.map((row) => `${csvRow(row)}\n`).join('')));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await batches.return?.();
    },
  });
}

export function csvDownload(
  filename: string,
  header: string[],
  batches: AsyncIterator<unknown[][]>,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(csvStream(header, batches), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export async function* inBatches<T>(rows: T[], size = 500): AsyncGenerator<T[]> {
  for (let offset = 0; offset < rows.length; offset += size) yield rows.slice(offset, offset + size);
}
