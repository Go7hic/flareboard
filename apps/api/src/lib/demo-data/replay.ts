import type { Rng } from './rng';

/**
 * Builds small but real rrweb recordings for demo sessions: per page a Meta event and a full
 * snapshot of a styled page that looks like the page visited, then mouse movement, scrolling,
 * clicks, a masked input where the page has one, and the recorder's `$console` / `$network`
 * custom events (apps/ingest/src/tracker/recorder.ts). One page = one chunk, like a real visit
 * where every page load starts a new recording.
 */

/** rrweb EventType / IncrementalSource / MouseInteractions values. */
const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const META = 4;
const CUSTOM = 5;
const SOURCE_MUTATION = 0;
const SOURCE_MOUSE_MOVE = 1;
const SOURCE_MOUSE_INTERACTION = 2;
const SOURCE_SCROLL = 3;
const SOURCE_INPUT = 5;
const MOUSE_UP = 0;
const MOUSE_DOWN = 1;
const CLICK = 2;
const FOCUS = 5;

export type RrwebEvent = { type: number; timestamp: number; data: Record<string, unknown> };

export type ReplayPageKind =
  | 'home'
  | 'collection'
  | 'product'
  | 'cart'
  | 'checkout'
  | 'pricing'
  | 'blog'
  | 'account'
  | 'docs'
  | 'docs-search';

export type ReplayPage = {
  path: string;
  title: string;
  kind: ReplayPageKind;
  startAt: number;
  endAt: number;
  /** Console messages to emit on this page. */
  console?: Array<{ level: 'log' | 'info' | 'warn' | 'error' | 'debug'; message: string; at: number }>;
  /** Network calls to emit on this page. */
  network?: Array<{ method: string; url: string; status: number; duration: number; size: number | null; at: number }>;
  /** Product / article name shown on the page. */
  heading?: string;
  price?: string;
};

export type ReplayChunk = {
  events: RrwebEvent[];
  startedAt: number;
  endedAt: number;
  clickCount: number;
  inputCount: number;
  consoleLogCount: number;
  consoleWarnCount: number;
  consoleErrorCount: number;
  networkErrorCount: number;
};

type SerializedNode =
  | { type: 0; id: number; childNodes: SerializedNode[] }
  | { type: 1; id: number; name: string; publicId: string; systemId: string }
  | { type: 2; id: number; tagName: string; attributes: Record<string, string>; childNodes: SerializedNode[] }
  | { type: 3; id: number; textContent: string; isStyle?: true };

type Spec = { tag: string; attrs?: Record<string, string>; ref?: string; children?: Array<Spec | string> };

function h(tag: string, attrs: Record<string, string> | null, ...children: Array<Spec | string>): Spec {
  const ref = attrs?.ref;
  const clean = attrs ? { ...attrs } : {};
  delete clean.ref;
  return { tag, attrs: clean, ref, children };
}

/** Serializes a spec tree with sequential ids (1 = document) and collects `ref` element ids. */
function serialize(body: Spec, css: string, title: string) {
  let next = 1;
  const refs: Record<string, number> = {};
  const build = (spec: Spec | string): SerializedNode => {
    if (typeof spec === 'string') return { type: 3, id: next++, textContent: spec };
    const id = next++;
    if (spec.ref) refs[spec.ref] = id;
    return {
      type: 2,
      id,
      tagName: spec.tag,
      attributes: spec.attrs ?? {},
      childNodes: (spec.children ?? []).map(build),
    };
  };
  const documentId = next++;
  const doctype: SerializedNode = { type: 1, id: next++, name: 'html', publicId: '', systemId: '' };
  const htmlId = next++;
  const headId = next++;
  const styleId = next++;
  const styleText: SerializedNode = { type: 3, id: next++, textContent: css, isStyle: true };
  const titleId = next++;
  const titleText: SerializedNode = { type: 3, id: next++, textContent: title };
  const bodyNode = build(body);
  const node: SerializedNode = {
    type: 0,
    id: documentId,
    childNodes: [
      doctype,
      {
        type: 2,
        id: htmlId,
        tagName: 'html',
        attributes: { lang: 'en' },
        childNodes: [
          {
            type: 2,
            id: headId,
            tagName: 'head',
            attributes: {},
            childNodes: [
              { type: 2, id: styleId, tagName: 'style', attributes: {}, childNodes: [styleText] },
              { type: 2, id: titleId, tagName: 'title', attributes: {}, childNodes: [titleText] },
            ],
          },
          bodyNode,
        ],
      },
    ],
  };
  return { node, refs, documentId };
}

const STORE_CSS = `*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#fafafa}
header{display:flex;align-items:center;justify-content:space-between;height:64px;padding:0 32px;background:#fff;border-bottom:1px solid #eaeaea}
.logo{font-weight:700;font-size:18px}nav a{margin-left:24px;color:#444;text-decoration:none;font-size:14px}.cart{font-weight:600}
main{max-width:1120px;margin:0 auto;padding:32px}.hero{background:#111;color:#fff;border-radius:12px;padding:48px;margin-bottom:32px}
.hero h1{margin:0 0 12px;font-size:36px}.btn{display:inline-block;background:#111;color:#fff;border:0;border-radius:6px;padding:12px 20px;font-size:15px}
.hero .btn{background:#fff;color:#111}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}
.card{background:#fff;border:1px solid #eaeaea;border-radius:8px;padding:16px}.thumb{height:140px;border-radius:6px;background:#e9e7e2;margin-bottom:12px}
.price{font-weight:600;margin-top:6px}.pdp{display:grid;grid-template-columns:1fr 1fr;gap:40px}.photo{height:420px;border-radius:12px;background:#e4e1da}
.muted{color:#666;font-size:14px}input{width:100%;padding:10px 12px;border:1px solid #d4d4d4;border-radius:6px;font-size:15px;margin:6px 0 14px}
.row{display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid #eee}.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
article p{line-height:1.7;color:#333}footer{padding:32px;text-align:center;color:#888;font-size:13px}`;

const DOCS_CSS = `*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#fff}
header{display:flex;align-items:center;gap:24px;height:56px;padding:0 24px;border-bottom:1px solid #eaeaea}.logo{font-weight:700}
.search{flex:1;max-width:360px}input{width:100%;padding:8px 12px;border:1px solid #d4d4d4;border-radius:6px;font-size:14px}
.layout{display:grid;grid-template-columns:240px 1fr;min-height:900px}aside{border-right:1px solid #eaeaea;padding:24px}
aside a{display:block;color:#444;text-decoration:none;font-size:14px;padding:6px 0}article{padding:40px 56px;max-width:860px}
h1{font-size:32px;margin:0 0 16px}p{line-height:1.7;color:#333}pre{position:relative;background:#111;color:#eaeaea;padding:16px;border-radius:6px;font-size:13px}
.copy{position:absolute;top:8px;right:8px;background:#333;color:#fff;border:0;border-radius:4px;padding:4px 8px;font-size:12px}
.feedback{margin-top:40px;padding:16px;border:1px solid #eaeaea;border-radius:6px}.btn{background:#111;color:#fff;border:0;border-radius:6px;padding:8px 14px}`;

const PRODUCTS = ['Linen Overshirt', 'Canvas Tote', 'Merino Beanie', 'Trail Runner', 'Ceramic Mug', 'Wool Throw', 'Field Jacket', 'Leather Wallet'];

function storeHeader(): Spec {
  return h(
    'header',
    null,
    h('div', { class: 'logo' }, 'Northwind Supply'),
    h(
      'nav',
      null,
      h('a', { href: '/collections/new', ref: 'nav-new' }, 'New arrivals'),
      h('a', { href: '/collections/apparel' }, 'Apparel'),
      h('a', { href: '/pricing' }, 'Membership'),
      h('a', { href: '/blog' }, 'Journal'),
      h('a', { href: '/cart', class: 'cart', ref: 'cart' }, 'Cart (', h('span', { ref: 'cart-count' }, '0'), ')'),
    ),
  );
}

function productGrid(count: number, rng: Rng): Spec {
  const cards: Spec[] = [];
  for (let i = 0; i < count; i++) {
    const name = PRODUCTS[(i + rng.int(0, 7)) % PRODUCTS.length]!;
    cards.push(
      h(
        'div',
        { class: 'card', ref: i === 0 ? 'card-0' : `card-${i}` },
        h('div', { class: 'thumb' }),
        h('div', null, name),
        h('div', { class: 'price' }, `$${rng.int(24, 180)}.00`),
      ),
    );
  }
  return h('div', { class: 'grid' }, ...cards);
}

function storeBody(page: ReplayPage, rng: Rng): Spec {
  let content: Spec;
  switch (page.kind) {
    case 'home':
      content = h(
        'main',
        null,
        h(
          'section',
          { class: 'hero' },
          h('h1', null, 'Made to last. Priced to wear.'),
          h('p', null, 'Everyday essentials from independent makers.'),
          h('a', { class: 'btn', href: '/collections/new', ref: 'cta' }, 'Shop new arrivals'),
        ),
        productGrid(8, rng),
      );
      break;
    case 'collection':
      content = h('main', null, h('h1', null, page.heading ?? 'New arrivals'), productGrid(12, rng));
      break;
    case 'product':
      content = h(
        'main',
        null,
        h(
          'div',
          { class: 'pdp' },
          h('div', { class: 'photo' }),
          h(
            'div',
            null,
            h('h1', null, page.heading ?? 'Linen Overshirt'),
            h('div', { class: 'price' }, page.price ?? '$98.00'),
            h('p', { class: 'muted' }, 'Garment-dyed, relaxed fit. Free returns within 30 days.'),
            h('label', null, 'Quantity'),
            h('input', { type: 'number', value: '1', ref: 'qty' }),
            h('button', { class: 'btn', ref: 'add' }, 'Add to cart'),
          ),
        ),
      );
      break;
    case 'cart':
      content = h(
        'main',
        null,
        h('h1', null, 'Your cart'),
        h('div', { class: 'row' }, h('span', null, page.heading ?? 'Linen Overshirt'), h('span', null, page.price ?? '$98.00')),
        h('div', { class: 'row' }, h('span', null, 'Shipping'), h('span', null, 'Free')),
        h('p', null, h('button', { class: 'btn', ref: 'checkout' }, 'Checkout')),
      );
      break;
    case 'checkout':
      content = h(
        'main',
        null,
        h('h1', null, 'Checkout'),
        h('label', null, 'Email'),
        h('input', { type: 'email', name: 'email', ref: 'email' }),
        h('label', null, 'Card number'),
        h('input', { type: 'text', name: 'card-number', autocomplete: 'cc-number', ref: 'card' }),
        h('button', { class: 'btn', ref: 'pay' }, `Pay ${page.price ?? '$98.00'}`),
      );
      break;
    case 'pricing':
      content = h(
        'main',
        null,
        h('h1', null, 'Northwind membership'),
        h(
          'div',
          { class: 'plans' },
          ...['Basic', 'Plus', 'Pro'].map((plan, i) =>
            h(
              'div',
              { class: 'card', ref: `plan-${i}` },
              h('h3', null, plan),
              h('div', { class: 'price' }, ['Free', '$9 / month', '$19 / month'][i]!),
              h('button', { class: 'btn', ref: `plan-cta-${i}` }, 'Choose'),
            ),
          ),
        ),
      );
      break;
    case 'account':
      content = h(
        'main',
        null,
        h('h1', null, 'Create your account'),
        h('label', null, 'Email'),
        h('input', { type: 'email', name: 'email', ref: 'email' }),
        h('label', null, 'Password'),
        h('input', { type: 'password', name: 'password', ref: 'password' }),
        h('button', { class: 'btn', ref: 'signup' }, 'Sign up'),
      );
      break;
    default:
      content = h(
        'main',
        null,
        h(
          'article',
          null,
          h('h1', null, page.heading ?? 'How we source our linen'),
          h('p', null, 'We work with a family-run mill in Lithuania that has been weaving flax for four generations.'),
          h('p', null, 'Every bolt is washed twice, so it arrives soft and keeps its shape after years of wear.'),
          h('a', { class: 'btn', href: '/collections/apparel', ref: 'cta' }, 'Shop the collection'),
        ),
      );
  }
  return h('body', null, storeHeader(), content, h('footer', null, '© Northwind Supply — demo store'));
}

function docsBody(page: ReplayPage): Spec {
  const sections = ['Getting started', 'Install the tracker', 'Track events', 'Identify users', 'Feature flags', 'API reference'];
  return h(
    'body',
    null,
    h(
      'header',
      null,
      h('div', { class: 'logo' }, 'Acme Docs'),
      h('div', { class: 'search' }, h('input', { type: 'search', placeholder: 'Search docs', ref: 'search' })),
    ),
    h(
      'div',
      { class: 'layout' },
      h('aside', null, ...sections.map((label, i) => h('a', { href: '#', ref: `side-${i}` }, label))),
      h(
        'article',
        null,
        h('h1', null, page.heading ?? 'Getting started'),
        h('p', null, 'Add the snippet to every page you want to measure. It loads asynchronously and never blocks rendering.'),
        h(
          'pre',
          null,
          '<script defer src="https://cdn.acme.dev/t.js" data-site="acme"></script>',
          h('button', { class: 'copy', ref: 'copy' }, 'Copy'),
        ),
        h('p', null, 'Events appear in the dashboard within a few seconds.'),
        h('div', { class: 'feedback' }, 'Was this page helpful? ', h('button', { class: 'btn', ref: 'helpful' }, 'Yes')),
      ),
    ),
  );
}

/** Approximate on-screen position of a referenced element (desktop layout, 1280 wide). */
function targetPoint(ref: string, width: number, rng: Rng): { x: number; y: number } {
  const jitter = () => rng.int(-6, 6);
  const scale = width / 1280;
  const table: Record<string, [number, number]> = {
    'nav-new': [760, 32],
    cart: [1180, 32],
    cta: [180, 300],
    'card-0': [230, 520],
    'card-1': [510, 520],
    'card-2': [790, 520],
    qty: [900, 330],
    add: [800, 390],
    checkout: [120, 260],
    email: [400, 160],
    card: [400, 240],
    pay: [120, 300],
    password: [400, 240],
    signup: [120, 300],
    'plan-cta-1': [640, 330],
    'plan-cta-2': [1000, 330],
    search: [400, 28],
    copy: [900, 250],
    helpful: [480, 420],
    'side-1': [90, 110],
    'side-2': [90, 140],
  };
  const [x, y] = table[ref] ?? [640, 360];
  return { x: Math.round(x * scale) + jitter(), y: y + jitter() };
}

/** Where a visitor on this kind of page clicks, in order. */
function clickPlan(kind: ReplayPageKind): string[] {
  switch (kind) {
    case 'home':
      return ['cta'];
    case 'collection':
      return ['card-1'];
    case 'product':
      return ['qty', 'add'];
    case 'cart':
      return ['checkout'];
    case 'checkout':
      return ['email', 'card', 'pay'];
    case 'pricing':
      return ['plan-cta-1'];
    case 'account':
      return ['email', 'password', 'signup'];
    case 'docs':
      return ['side-1', 'copy', 'helpful'];
    case 'docs-search':
      return ['search', 'side-2'];
    default:
      return ['cta'];
  }
}

const INPUT_TEXT: Record<string, number> = { email: 18, card: 16, password: 12, search: 9, qty: 1 };

function chunkForPage(
  page: ReplayPage,
  options: { origin: string; docs: boolean; width: number; height: number; rng: Rng; cartCount: number },
): ReplayChunk {
  const { rng, width, height } = options;
  const body = options.docs ? docsBody(page) : storeBody(page, rng);
  const { node, refs, documentId } = serialize(body, options.docs ? DOCS_CSS : STORE_CSS, page.title);
  const events: RrwebEvent[] = [];
  const start = page.startAt;
  const end = Math.max(page.endAt, start + 1500);
  events.push({ type: META, timestamp: start, data: { href: `${options.origin}${page.path}`, width, height } });
  events.push({ type: FULL_SNAPSHOT, timestamp: start + 12, data: { node, initialOffset: { left: 0, top: 0 } } });
  if (!options.docs && refs['cart-count'] !== undefined && options.cartCount > 0) {
    // The cart badge is filled in by client code right after load.
    events.push({
      type: INCREMENTAL,
      timestamp: start + 40,
      data: { source: SOURCE_MUTATION, texts: [{ id: refs['cart-count']! + 1, value: String(options.cartCount) }], attributes: [], removes: [], adds: [] },
    });
  }

  let clickCount = 0;
  let inputCount = 0;
  const plan = clickPlan(page.kind).filter((ref) => refs[ref] !== undefined);
  const span = end - start;
  let cursor = { x: Math.round(width / 2), y: Math.round(height / 3) };
  let t = start + 400;
  let scrollY = 0;
  const step = Math.max(600, Math.floor((span - 800) / (plan.length + 2)));

  const moveTo = (target: { x: number; y: number }, at: number, targetId: number) => {
    const positions: Array<{ x: number; y: number; id: number; timeOffset: number }> = [];
    const samples = 6;
    for (let i = 1; i <= samples; i++) {
      const f = i / samples;
      positions.push({
        x: Math.round(cursor.x + (target.x - cursor.x) * f + rng.int(-4, 4)),
        y: Math.round(cursor.y + (target.y - cursor.y) * f + rng.int(-4, 4)),
        id: targetId,
        timeOffset: -Math.round((samples - i) * 60),
      });
    }
    events.push({ type: INCREMENTAL, timestamp: at, data: { source: SOURCE_MOUSE_MOVE, positions } });
    cursor = target;
  };

  // Browse: a scroll down the page and back, with the pointer drifting.
  if (page.kind === 'home' || page.kind === 'collection' || page.kind === 'blog' || page.kind === 'docs') {
    for (let i = 0; i < 3; i++) {
      scrollY += rng.int(180, 420);
      events.push({ type: INCREMENTAL, timestamp: t, data: { source: SOURCE_SCROLL, id: documentId, x: 0, y: scrollY } });
      t += rng.int(250, 500);
    }
    moveTo({ x: rng.int(200, width - 200), y: rng.int(200, height - 150) }, t, documentId);
    t += rng.int(300, 700);
    events.push({ type: INCREMENTAL, timestamp: t, data: { source: SOURCE_SCROLL, id: documentId, x: 0, y: 0 } });
    scrollY = 0;
    t += rng.int(200, 400);
  }

  for (const ref of plan) {
    const id = refs[ref]!;
    const point = targetPoint(ref, width, rng);
    moveTo(point, t, id);
    t += rng.int(120, 260);
    events.push({ type: INCREMENTAL, timestamp: t, data: { source: SOURCE_MOUSE_INTERACTION, type: MOUSE_DOWN, id, ...point } });
    events.push({ type: INCREMENTAL, timestamp: t + 70, data: { source: SOURCE_MOUSE_INTERACTION, type: MOUSE_UP, id, ...point } });
    events.push({ type: INCREMENTAL, timestamp: t + 72, data: { source: SOURCE_MOUSE_INTERACTION, type: CLICK, id, ...point } });
    clickCount++;
    const typed = INPUT_TEXT[ref];
    if (typed !== undefined) {
      events.push({ type: INCREMENTAL, timestamp: t + 80, data: { source: SOURCE_MOUSE_INTERACTION, type: FOCUS, id } });
      // Inputs are masked by the recorder: same length, all `*`.
      let at = t + 300;
      const length = ref === 'qty' ? 1 : typed + rng.int(-3, 3);
      for (let n = 1; n <= length; n += Math.max(1, Math.floor(length / 4))) {
        events.push({ type: INCREMENTAL, timestamp: at, data: { source: SOURCE_INPUT, text: '*'.repeat(n), isChecked: false, id } });
        inputCount++;
        at += rng.int(90, 220);
      }
      events.push({ type: INCREMENTAL, timestamp: at, data: { source: SOURCE_INPUT, text: '*'.repeat(length), isChecked: false, id } });
      inputCount++;
      t = at;
    }
    if (ref === 'add' && refs['cart-count'] !== undefined) {
      events.push({
        type: INCREMENTAL,
        timestamp: t + 260,
        data: { source: SOURCE_MUTATION, texts: [{ id: refs['cart-count']! + 1, value: String(options.cartCount + 1) }], attributes: [], removes: [], adds: [] },
      });
    }
    t += step;
    if (t > end - 300) t = end - 300;
  }

  let consoleLogCount = 0;
  let consoleWarnCount = 0;
  let consoleErrorCount = 0;
  let networkErrorCount = 0;
  for (const entry of page.console ?? []) {
    events.push({
      type: CUSTOM,
      timestamp: Math.min(Math.max(entry.at, start + 20), end),
      data: { tag: '$console', payload: { level: entry.level, message: entry.message } },
    });
    if (entry.level === 'error') consoleErrorCount++;
    else if (entry.level === 'warn') consoleWarnCount++;
    else consoleLogCount++;
  }
  for (const entry of page.network ?? []) {
    const failed = entry.status === 0;
    events.push({
      type: CUSTOM,
      timestamp: Math.min(Math.max(entry.at, start + 20), end),
      data: {
        tag: '$network',
        payload: { method: entry.method, url: entry.url, status: entry.status, duration: entry.duration, size: entry.size, failed },
      },
    });
    if (failed || entry.status >= 400) networkErrorCount++;
  }
  // Last pointer movement right before the page is left.
  moveTo({ x: rng.int(100, width - 100), y: rng.int(80, height - 80) }, end, documentId);

  events.sort((a, b) => a.timestamp - b.timestamp || rank(a) - rank(b));
  return {
    events,
    startedAt: events[0]!.timestamp,
    endedAt: events[events.length - 1]!.timestamp,
    clickCount,
    inputCount,
    consoleLogCount,
    consoleWarnCount,
    consoleErrorCount,
    networkErrorCount,
  };
}

/** Meta before the full snapshot when timestamps tie. */
function rank(event: RrwebEvent) {
  return event.type === META ? 0 : event.type === FULL_SNAPSHOT ? 1 : 2;
}

export function buildReplayChunks(input: {
  origin: string;
  docs: boolean;
  mobile: boolean;
  pages: ReplayPage[];
  rng: Rng;
}): ReplayChunk[] {
  const width = input.mobile ? 390 : 1280;
  const height = input.mobile ? 844 : 800;
  let cartCount = 0;
  return input.pages.map((page) => {
    const chunk = chunkForPage(page, { origin: input.origin, docs: input.docs, width, height, rng: input.rng, cartCount });
    if (page.kind === 'product') cartCount += 1;
    return chunk;
  });
}
