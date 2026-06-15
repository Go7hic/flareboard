import { describe, expect, it } from 'vitest';
import { fetchWorkerJson } from '../helpers/fetch-worker';

type ConfigResponse = {
  locale: string;
  environment: string;
  version: string;
  hosted: boolean;
  registrationEnabled: boolean;
  scripts: string[];
};

describe('GET /api/config', () => {
  it('returns baseline config fields', async () => {
    const { response, body } = await fetchWorkerJson<ConfigResponse>('/api/config');
    expect(response.status).toBe(200);
    expect(body.environment).toBe('development');
    expect(body.version).toBe('2.0.0');
    expect(body.scripts).toEqual(['script.js', 'recorder.js']);
  });

  it('prefers locale query param over Accept-Language', async () => {
    const { body } = await fetchWorkerJson<ConfigResponse>('/api/config?locale=ja-JP', {
      headers: { 'Accept-Language': 'zh-CN' },
    });
    expect(body.locale).toBe('ja-JP');
  });

  it('resolves locale from Accept-Language', async () => {
    const { body: zh } = await fetchWorkerJson<ConfigResponse>('/api/config', {
      headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
    expect(zh.locale).toBe('zh-CN');

    const { body: de } = await fetchWorkerJson<ConfigResponse>('/api/config', {
      headers: { 'Accept-Language': 'de-DE,de;q=0.9' },
    });
    expect(de.locale).toBe('de-DE');

    const { body: en } = await fetchWorkerJson<ConfigResponse>('/api/config', {
      headers: { 'Accept-Language': 'es-ES,es;q=0.9' },
    });
    expect(en.locale).toBe('en-US');
  });
});
