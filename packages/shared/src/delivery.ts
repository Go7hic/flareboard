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

  const checked = checkOutboundUrl(trimmed);
  if (!checked.ok) return { ok: false, error: checked.error };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(checked.url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      // A public host must not bounce the request to an internal one.
      redirect: 'manual',
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

export type OutboundUrlCheck = { ok: true; url: URL } | { ok: false; error: string };

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** IANA special-purpose IPv4 ranges: loopback, private, link-local, CGNAT, test, multicast, reserved. */
function isNonPublicIpv4([a, b, c]: number[]) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  );
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

/**
 * SSRF guard for customer-configured destinations (workflow webhooks, alert webhooks).
 * Only http(s) URLs to public DNS names or public IPv4 literals pass. Loopback, private,
 * link-local and other special-purpose addresses, single-label and internal-only names,
 * IPv6 literals and URLs with credentials are refused. The WHATWG parser has already
 * normalised numeric forms such as `http://2130706433/` or `http://0x7f.1/` to dotted IPv4,
 * so those are caught too. Callers must also send with `redirect: 'manual'` so a public
 * host cannot redirect the request inward.
 */
export function checkOutboundUrl(raw: string): OutboundUrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'URL must use http or https' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'URL must not include credentials' };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, error: 'URL host is missing' };
  if (host.startsWith('[') || host.includes(':')) {
    return { ok: false, error: 'IPv6 literal hosts are not allowed; use a hostname' };
  }
  const ipv4 = parseIpv4(host);
  if (ipv4) {
    return isNonPublicIpv4(ipv4)
      ? { ok: false, error: 'URL host is a private or reserved address' }
      : { ok: true, url };
  }
  if (
    host === 'localhost' ||
    !host.includes('.') ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    host === 'metadata.google.internal'
  ) {
    return { ok: false, error: 'URL host is not a public hostname' };
  }
  return { ok: true, url };
}
