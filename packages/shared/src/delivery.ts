export type WebhookDeliveryResult = {
  ok: boolean;
  status?: number;
  error?: string;
};

export async function postWebhook(
  url: string,
  payload: unknown,
  timeoutMs = 10_000,
): Promise<WebhookDeliveryResult> {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: 'Missing webhook URL' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid webhook URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Webhook URL must use http or https' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `Webhook returned ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
