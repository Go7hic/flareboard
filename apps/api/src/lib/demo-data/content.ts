/**
 * Text content for generated errors, assistant conversations and service logs.
 */

export type DemoError = {
  key: string;
  name: string;
  message: string;
  /** V8-style stack; `{origin}` and `{release}` are filled in. */
  stack: string;
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'fatal' | 'warning';
  handled: boolean;
};

const asset = (name: string) => `{origin}/assets/${name}`;

export const STORE_ERRORS: Record<string, DemoError> = {
  variantUndefined: {
    key: 'variant-undefined',
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'variantId')",
    stack: [
      "TypeError: Cannot read properties of undefined (reading 'variantId')",
      `    at selectedVariant (${asset('product-gallery.4f1c9a.js')}:1:18342)`,
      `    at ProductGallery.onSwatchClick (${asset('product-gallery.4f1c9a.js')}:1:19011)`,
      `    at HTMLButtonElement.handle (${asset('storefront.9b2e71.js')}:2:4410)`,
    ].join('\n'),
    file: asset('product-gallery.4f1c9a.js'),
    line: 1,
    column: 18342,
    severity: 'error',
    handled: false,
  },
  chunkLoad: {
    key: 'chunk-load',
    name: 'ChunkLoadError',
    message: 'Loading chunk 412 failed. (timeout: {origin}/assets/412.8d0e3b.js)',
    stack: [
      'ChunkLoadError: Loading chunk 412 failed.',
      `    at loadChunk (${asset('runtime.02ac5d.js')}:1:3112)`,
      `    at lazyRoute (${asset('storefront.9b2e71.js')}:1:88120)`,
      `    at renderRoute (${asset('storefront.9b2e71.js')}:1:90410)`,
    ].join('\n'),
    file: asset('runtime.02ac5d.js'),
    line: 1,
    column: 3112,
    severity: 'error',
    handled: false,
  },
  cartFetch: {
    key: 'cart-fetch',
    name: 'TypeError',
    message: 'Failed to fetch',
    stack: [
      'TypeError: Failed to fetch',
      `    at refreshCart (${asset('cart-drawer.71ce0f.js')}:1:2210)`,
      `    at CartDrawer.open (${asset('cart-drawer.71ce0f.js')}:1:4102)`,
      `    at HTMLAnchorElement.onCartClick (${asset('storefront.9b2e71.js')}:2:1290)`,
    ].join('\n'),
    file: asset('cart-drawer.71ce0f.js'),
    line: 1,
    column: 2210,
    severity: 'warning',
    handled: true,
  },
  currency: {
    key: 'currency',
    name: 'RangeError',
    message: 'Invalid currency code : undefined',
    stack: [
      'RangeError: Invalid currency code : undefined',
      '    at new NumberFormat (<anonymous>)',
      `    at formatPrice (${asset('checkout.c3a9e4.js')}:1:1532)`,
      `    at OrderSummary.render (${asset('checkout.c3a9e4.js')}:1:6120)`,
    ].join('\n'),
    file: asset('checkout.c3a9e4.js'),
    line: 1,
    column: 1532,
    severity: 'error',
    handled: false,
  },
  paymentTimeout: {
    key: 'payment-timeout',
    name: 'PaymentTimeoutError',
    message: 'PaymentIntent confirmation timed out after 15000ms',
    stack: [
      'PaymentTimeoutError: PaymentIntent confirmation timed out after 15000ms',
      `    at confirmPayment (${asset('checkout.c3a9e4.js')}:1:9921)`,
      `    at async CheckoutForm.submit (${asset('checkout.c3a9e4.js')}:1:11873)`,
    ].join('\n'),
    file: asset('checkout.c3a9e4.js'),
    line: 1,
    column: 9921,
    severity: 'fatal',
    handled: false,
  },
};

/** A different small bug each week: an issue that is new when it first appears. */
const WEEKLY_COMPONENTS = [
  ['SizeGuideModal', 'sizeChart', 'size-guide'],
  ['WishlistButton', 'wishlistId', 'wishlist'],
  ['ReviewCarousel', 'reviews', 'reviews'],
  ['StoreLocator', 'coordinates', 'store-locator'],
  ['GiftCardForm', 'balance', 'gift-card'],
  ['ColorSwatches', 'swatches', 'swatches'],
  ['BackInStockForm', 'inventory', 'back-in-stock'],
] as const;

export function weeklyError(week: number): DemoError {
  const [component, field, chunk] = WEEKLY_COMPONENTS[((week % WEEKLY_COMPONENTS.length) + WEEKLY_COMPONENTS.length) % WEEKLY_COMPONENTS.length]!;
  const file = asset(`${chunk}.${(week * 7919).toString(16).slice(-6)}.js`);
  return {
    key: `weekly-${week}`,
    name: 'TypeError',
    message: `Cannot read properties of null (reading '${field}')`,
    stack: [
      `TypeError: Cannot read properties of null (reading '${field}')`,
      `    at ${component}.render_w${week} (${file}:1:${900 + (week % 97) * 13})`,
      `    at renderWithHooks (${asset('storefront.9b2e71.js')}:1:44120)`,
    ].join('\n'),
    file,
    line: 1,
    column: 900 + (week % 97) * 13,
    severity: 'error',
    handled: false,
  };
}

export const DOCS_ERRORS: Record<string, DemoError> = {
  searchIndex: {
    key: 'search-index',
    name: 'SyntaxError',
    message: 'Unexpected token < in JSON at position 0',
    stack: [
      'SyntaxError: Unexpected token < in JSON at position 0',
      '    at JSON.parse (<anonymous>)',
      `    at loadSearchIndex (${asset('search.5e21b7.js')}:1:822)`,
      `    at async SearchBox.open (${asset('search.5e21b7.js')}:1:2380)`,
    ].join('\n'),
    file: asset('search.5e21b7.js'),
    line: 1,
    column: 822,
    severity: 'error',
    handled: false,
  },
  clipboard: {
    key: 'clipboard',
    name: 'NotAllowedError',
    message: 'Write permission denied.',
    stack: [
      'NotAllowedError: Write permission denied.',
      `    at copySnippet (${asset('code-block.0b9f44.js')}:1:640)`,
      `    at HTMLButtonElement.onCopy (${asset('code-block.0b9f44.js')}:1:1102)`,
    ].join('\n'),
    file: asset('code-block.0b9f44.js'),
    line: 1,
    column: 640,
    severity: 'warning',
    handled: true,
  },
};

export const ASSISTANT_QUESTIONS = [
  ['Does the {product} run true to size?', 'Most customers find it true to size. If you are between sizes, size up for a relaxed fit.'],
  ['Is the {product} machine washable?', 'Yes, on a cold wool cycle. Lay it flat to dry to keep its shape.'],
  ['When would the {product} arrive in {city}?', 'Orders placed today usually arrive in 3–5 business days in {city}.'],
  ['What goes well with the {product}?', 'It pairs well with our Selvedge Denim and the Leather Chelsea Boot.'],
  ['Can I return the {product} if it does not fit?', 'Yes. Returns are free within 30 days, and exchanges ship the same day.'],
  ['What is the {product} made of?', 'It is made from certified organic fibres from our partner mills.'],
  ['Do you have the {product} in navy?', 'Navy is back in stock in sizes S to L. XL restocks next week.'],
] as const;

export const CHECKOUT_LOGS = {
  started: 'checkout session created',
  reserved: 'inventory reserved',
  authorized: 'payment authorized',
  created: 'order created',
  declined: 'payment declined: card_declined',
  timeout: 'PaymentIntent confirmation timed out after 15000ms',
  lowStock: 'inventory low after reservation',
  retry: 'payment provider returned 503, retrying (attempt 2/3)',
} as const;
