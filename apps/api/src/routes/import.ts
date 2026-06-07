import type { Context } from 'hono';
import { importCsvSchema } from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite, canMutateWebsite } from '../lib/access';
import { importCsv } from '../lib/import-data';
import { getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

const MAX_IMPORT_BYTES = 20_000_000;

async function parseImportBody(c: Ctx): Promise<{ format: string; csv: string } | null> {
  const contentType = c.req.header('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData().catch(() => null);
    if (!form) return null;
    const format = String(form.get('format') ?? 'flareboard');
    const file = form.get('file');
    if (file && typeof file === 'object' && 'arrayBuffer' in file) {
      const blob = file as File;
      if (blob.size > MAX_IMPORT_BYTES) return null;
      const csv = await blob.text();
      return { format, csv };
    }
    const csvField = form.get('csv');
    if (typeof csvField === 'string' && csvField.length) {
      return { format, csv: csvField };
    }
    return null;
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return null;
  const format = String((body as { format?: string }).format ?? 'flareboard');
  const csv = (body as { csv?: string }).csv;
  if (typeof csv !== 'string') return null;
  return { format, csv };
}

export async function handleImport(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const raw = await parseImportBody(c);
  if (!raw) return badRequest('Invalid import payload — use JSON {format, csv} or multipart file');

  const parsed = importCsvSchema.safeParse(raw);
  if (!parsed.success) return badRequest(parsed.error.message);

  const result = await importCsv(c.env, websiteId, parsed.data.format, parsed.data.csv);
  return json(result);
}
