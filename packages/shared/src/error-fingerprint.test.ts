import { describe, expect, it } from 'vitest';
import {
  computeErrorFingerprint,
  formatStackFromFrames,
  hashFingerprint,
  isErrorFingerprint,
  isInAppFrame,
  messageFingerprint,
  normalizeErrorMessage,
  normalizeStackFrame,
  parseStackTrace,
} from './error-fingerprint';

// Chrome 126, Vite build (`[name]-[hash].js`), React click handler.
const CHROME_BUILD_A = `TypeError: Cannot read properties of undefined (reading 'price')
    at lineTotal (https://shop.example.com/assets/cart-C3sPvF1q.js:1:2045)
    at Array.map (<anonymous>)
    at renderCart (https://shop.example.com/assets/cart-C3sPvF1q.js:1:2311)
    at Object.onClick (https://shop.example.com/assets/index-Bx81kLm2.js:12:9876)
    at HTMLButtonElement.<anonymous> (https://shop.example.com/assets/vendor-BAvLS_R-.js:1:222)
    at async Promise.all (index 0)`;

// Same code, next deploy: new hashes, shifted columns, a query string on one file.
const CHROME_BUILD_B = `TypeError: Cannot read properties of undefined (reading 'price')
    at lineTotal (https://shop.example.com/assets/cart-Df0a9QeZ.js:1:2101)
    at Array.map (<anonymous>)
    at renderCart (https://shop.example.com/assets/cart-Df0a9QeZ.js:1:2398)
    at Object.onClick (https://shop.example.com/assets/index-Kq71mNp0.js?v=2:12:10004)
    at HTMLButtonElement.<anonymous> (https://shop.example.com/assets/vendor-XpQ2_r9a.js:1:230)`;

// Firefox 128: `fn@url:line:col`, async cause prefix, nested anonymous names.
const FIREFOX = `lineTotal@https://shop.example.com/assets/cart-C3sPvF1q.js:1:2045
renderCart@https://shop.example.com/assets/cart-C3sPvF1q.js:1:2311
onClick@https://shop.example.com/assets/index-Bx81kLm2.js:12:9876
setup/<@https://shop.example.com/assets/index-Bx81kLm2.js:3:14
promise callback*boot@https://shop.example.com/assets/index-Bx81kLm2.js line 40 > eval:1:7
`;

// Safari 17: `global code`, `[native code]`, bare anonymous location.
const SAFARI = `lineTotal@https://shop.example.com/assets/cart-C3sPvF1q.js:1:2045
map@[native code]
renderCart@https://shop.example.com/assets/cart-C3sPvF1q.js:1:2311
https://shop.example.com/assets/index-Bx81kLm2.js:12:9876
global code@https://shop.example.com/assets/index-Bx81kLm2.js:1:1`;

// webpack 5 / CRA: `[name].[contenthash:8].chunk.js`, numeric chunk ids.
const WEBPACK_A = `Error: Payment declined for order 81723
    at submitPayment (https://app.example.com/static/js/checkout.3f2a1c9e.chunk.js:2:1180)
    at handleSubmit (https://app.example.com/static/js/787.91ab44c1.chunk.js:1:540)
    at onSubmit (https://app.example.com/static/js/main.7d0e2b1f.js:1:99)`;
const WEBPACK_B = `Error: Payment declined for order 92001
    at submitPayment (https://app.example.com/static/js/checkout.a81c0d77.chunk.js:2:1205)
    at handleSubmit (https://app.example.com/static/js/512.0c9f3e2a.chunk.js:1:561)
    at onSubmit (https://app.example.com/static/js/main.5e6a7b88.js:1:101)`;

describe('parseStackTrace', () => {
  it('parses V8 frames and skips the header line', () => {
    const frames = parseStackTrace(CHROME_BUILD_A);
    expect(frames).toHaveLength(6);
    expect(frames[0]).toMatchObject({
      functionName: 'lineTotal',
      url: 'https://shop.example.com/assets/cart-C3sPvF1q.js',
      file: 'assets/cart-C3sPvF1q.js',
      line: 1,
      column: 2045,
      native: false,
    });
    expect(frames[1]).toMatchObject({ functionName: 'Array.map', native: true, file: '' });
    expect(frames[5]).toMatchObject({ functionName: 'async Promise.all', native: true });
  });

  it('parses V8 anonymous, eval and query-string locations', () => {
    const frames = parseStackTrace(
      [
        'Error: x',
        '    at https://a.example.com/js/app.js?v=3#frag:4:5',
        '    at eval (eval at compile (https://a.example.com/js/app.js:1:2), <anonymous>:1:1)',
        '    at new Widget (http://localhost:5173/src/widget.ts:10:3)',
        '    at C:\\app\\dist\\main.js:7:9',
      ].join('\n'),
    );
    expect(frames.map((frame) => [frame.functionName, frame.file, frame.line, frame.column])).toEqual([
      [null, 'js/app.js', 4, 5],
      ['eval', 'js/app.js', null, null],
      ['new Widget', 'src/widget.ts', 10, 3],
      [null, 'C:\\app\\dist\\main.js', 7, 9],
    ]);
  });

  it('parses Firefox frames with async causes and eval locations', () => {
    const frames = parseStackTrace(FIREFOX);
    expect(frames.map((frame) => [frame.functionName, frame.file, frame.line, frame.column])).toEqual([
      ['lineTotal', 'assets/cart-C3sPvF1q.js', 1, 2045],
      ['renderCart', 'assets/cart-C3sPvF1q.js', 1, 2311],
      ['onClick', 'assets/index-Bx81kLm2.js', 12, 9876],
      ['setup/<', 'assets/index-Bx81kLm2.js', 3, 14],
      ['boot', 'assets/index-Bx81kLm2.js', null, null],
    ]);
  });

  it('parses Safari frames including native code and bare locations', () => {
    const frames = parseStackTrace(SAFARI);
    expect(frames.map((frame) => [frame.functionName, frame.file, frame.native])).toEqual([
      ['lineTotal', 'assets/cart-C3sPvF1q.js', false],
      ['map', '', true],
      ['renderCart', 'assets/cart-C3sPvF1q.js', false],
      [null, 'assets/index-Bx81kLm2.js', false],
      ['global code', 'assets/index-Bx81kLm2.js', false],
    ]);
  });

  it('does not mistake message lines containing @ for frames', () => {
    expect(parseStackTrace('Error: invite for ana@example.com failed\n    at send (https://x.example.com/a.js:1:2)')).toHaveLength(1);
    expect(parseStackTrace('')).toEqual([]);
    expect(parseStackTrace(undefined)).toEqual([]);
  });
});

describe('in-app frames and normalization', () => {
  it('drops extension, node_modules, CDN and vendor chunk frames', () => {
    const stack = [
      'Error: x',
      '    at inject (chrome-extension://abcdefghijklmnop/content.js:1:2)',
      '    at hook (webkit-masked-url://hidden/:1:2)',
      '    at gtag (https://www.googletagmanager.com/gtag/js?id=G-1:1:2)',
      '    at dispatch (https://app.example.com/node_modules/.vite/deps/react-dom.js:9:9)',
      '    at commit (https://app.example.com/_next/static/chunks/framework-2c79e2a64abdb08b.js:9:9)',
      '    at run (https://app.example.com/assets/vendor.4f5e6d7c.js:1:1)',
      '    at jq (https://app.example.com/js/jquery-3.7.1.min.js:2:3)',
      '    at mine (https://app.example.com/assets/react-app.js:3:4)',
    ].join('\n');
    const inApp = parseStackTrace(stack).filter(isInAppFrame);
    expect(inApp.map((frame) => frame.functionName)).toEqual(['mine']);
  });

  it('strips content hashes, numeric chunk ids, receivers and ids from frames', () => {
    const [frame] = parseStackTrace('    at Object.handler_48213 (https://x.example.com/_next/static/chunks/pages/checkout-2f4e8c1a9b.js:1:2)');
    expect(normalizeStackFrame(frame!)).toEqual({ file: '_next/static/chunks/pages/checkout.js', function: 'handler_<n>' });

    const cases: Array<[string, string]> = [
      ['https://x.example.com/assets/app.3f2a1c9.js', 'assets/app.js'],
      ['https://x.example.com/assets/index-C3sPvF1q.js', 'assets/index.js'],
      ['https://x.example.com/static/js/main.3f2a1c9e.chunk.js', 'static/js/main.chunk.js'],
      ['https://x.example.com/static/js/787.91ab44c1.chunk.js', 'static/js/<n>.chunk.js'],
      ['https://x.example.com/static/0a1b2c3d4e5f6a7b.js', 'static/<hash>.js'],
      ['https://x.example.com/_next/static/Xy7Aq9Kd2mPq-1234abcd/_buildManifest.js', '_next/static/<hash>/_buildManifest.js'],
      ['https://x.example.com/assets/my-checkout.js', 'assets/my-checkout.js'],
    ];
    for (const [url, file] of cases) {
      const [parsed] = parseStackTrace(`    at f (${url}:1:1)`);
      expect(normalizeStackFrame(parsed!).file, url).toBe(file);
    }

    const names: Array<[string, string]> = [
      ['    at async loadCart (https://x.example.com/a.js:1:1)', 'loadCart'],
      ['    at HTMLButtonElement.<anonymous> (https://x.example.com/a.js:1:1)', '<anonymous>'],
      ['    at Cart.add [as addItem] (https://x.example.com/a.js:1:1)', 'add'],
      ['    at chunk_3f2a1c (https://x.example.com/a.js:1:1)', 'chunk_<hex>'],
      ['    at load_1b4e28ba-2fa1-11d2-883f-0016d3cca427 (https://x.example.com/a.js:1:1)', 'load_<uuid>'],
      ['setup/<@https://x.example.com/a.js:1:1', '<anonymous>'],
      ['outer/inner@https://x.example.com/a.js:1:1', 'inner'],
    ];
    for (const [line, name] of names) {
      const [parsed] = parseStackTrace(line);
      expect(normalizeStackFrame(parsed!).function, line).toBe(name);
    }
  });

  it('normalizes dynamic parts of messages', () => {
    expect(normalizeErrorMessage('User 123 not found')).toBe('User <n> not found');
    expect(normalizeErrorMessage("Cannot read properties of undefined (reading 'price')")).toBe(
      'Cannot read properties of undefined (reading <str>)',
    );
    expect(normalizeErrorMessage(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`)).toBe(
      'Unexpected token <str>, <str>... is not valid JSON',
    );
    expect(normalizeErrorMessage("Can't find variable: gtag")).toBe("Can't find variable: gtag");
    expect(normalizeErrorMessage('Order 1b4e28ba-2fa1-11d2-883f-0016d3cca427 failed for ana.lee+test@example.co.uk')).toBe(
      'Order <uuid> failed for <email>',
    );
    expect(normalizeErrorMessage('Invalid pointer 0x7ffd5e8c at node deadbeef99 (facade)')).toBe(
      'Invalid pointer <hex> at node <hex> (facade)',
    );
    expect(normalizeErrorMessage('  Timeout   after 30.5s  ')).toBe('Timeout after <n>s');
  });
});

describe('computeErrorFingerprint', () => {
  it('groups the same error across deploys with different content hashes and columns', () => {
    const a = computeErrorFingerprint({ type: 'TypeError', message: "Cannot read properties of undefined (reading 'price')", stack: CHROME_BUILD_A });
    const b = computeErrorFingerprint({ type: 'TypeError', message: "Cannot read properties of undefined (reading 'price')", stack: CHROME_BUILD_B });
    expect(a.method).toBe('stack');
    expect(a.frames).toEqual([
      { file: 'assets/cart.js', function: 'lineTotal' },
      { file: 'assets/cart.js', function: 'renderCart' },
      { file: 'assets/index.js', function: 'onClick' },
    ]);
    expect(b.fingerprint).toBe(a.fingerprint);

    const webpackA = computeErrorFingerprint({ type: 'Error', message: 'Payment declined for order 81723', stack: WEBPACK_A });
    const webpackB = computeErrorFingerprint({ type: 'Error', message: 'Payment declined for order 92001', stack: WEBPACK_B });
    expect(webpackA.method).toBe('stack');
    expect(webpackB.fingerprint).toBe(webpackA.fingerprint);
  });

  it('groups the same frames reported by Chrome, Firefox and Safari', () => {
    const chrome = computeErrorFingerprint({ type: 'TypeError', stack: CHROME_BUILD_A });
    const firefox = computeErrorFingerprint({ type: 'TypeError', stack: FIREFOX.split('\n').slice(0, 3).join('\n') });
    const safari = computeErrorFingerprint({
      type: 'TypeError',
      stack: SAFARI.split('\n').slice(0, 3).join('\n') + '\nonClick@https://shop.example.com/assets/index-Bx81kLm2.js:12:9876',
    });
    expect(firefox.fingerprint).toBe(chrome.fingerprint);
    expect(safari.fingerprint).toBe(chrome.fingerprint);
  });

  it('separates different error types and different call sites', () => {
    const base = computeErrorFingerprint({ type: 'TypeError', stack: CHROME_BUILD_A }).fingerprint;
    expect(computeErrorFingerprint({ type: 'RangeError', stack: CHROME_BUILD_A }).fingerprint).not.toBe(base);
    const otherCaller = CHROME_BUILD_A.replace('at renderCart', 'at renderWishlist');
    expect(computeErrorFingerprint({ type: 'TypeError', stack: otherCaller }).fingerprint).not.toBe(base);
  });

  it('uses only the top five in-app frames and ignores injected extension frames', () => {
    const frames = Array.from({ length: 8 }, (_, i) => `    at step${'abcdefgh'[i]} (https://x.example.com/assets/app-C3sPvF1q.js:1:${i + 1})`);
    const deep = computeErrorFingerprint({ type: 'Error', stack: ['Error: deep', ...frames].join('\n') });
    const differentTail = computeErrorFingerprint({
      type: 'Error',
      stack: ['Error: deep', ...frames.slice(0, 5), '    at somethingElse (https://x.example.com/assets/other.js:1:1)'].join('\n'),
    });
    const withExtension = computeErrorFingerprint({
      type: 'Error',
      stack: ['Error: deep', '    at hook (chrome-extension://abc/inject.js:1:1)', ...frames].join('\n'),
    });
    expect(deep.frames).toHaveLength(5);
    expect(differentTail.fingerprint).toBe(deep.fingerprint);
    expect(withExtension.fingerprint).toBe(deep.fingerprint);
  });

  it('falls back to type + normalized message when no in-app frame remains', () => {
    const vendorOnly = computeErrorFingerprint({
      type: 'Error',
      message: 'Minified React error #310; visit https://react.dev/errors/310',
      stack: 'Error: Minified React error #310\n    at Ze (https://x.example.com/assets/vendor-BAvLS_R-.js:1:9)',
    });
    expect(vendorOnly.method).toBe('message');
    expect(vendorOnly.fingerprint).toBe(messageFingerprint('Error', 'Minified React error #311; visit https://react.dev/errors/311'));

    const a = computeErrorFingerprint({ type: 'NotFoundError', message: 'User 123 not found' });
    const b = computeErrorFingerprint({ type: 'NotFoundError', message: 'User 98765 not found' });
    const c = computeErrorFingerprint({ type: 'NotFoundError', message: 'Team 1 not found' });
    expect(a).toMatchObject({ method: 'message', frames: [] });
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(c.fingerprint).not.toBe(a.fingerprint);
    expect(computeErrorFingerprint({ type: '', message: 'x' }).fingerprint).toBe(messageFingerprint('Error', 'x'));
  });

  it('honours a caller-supplied $exception_fingerprint', () => {
    const custom = computeErrorFingerprint({ type: 'Error', message: 'a', stack: CHROME_BUILD_A, custom: 'checkout-timeout' });
    expect(custom.method).toBe('custom');
    expect(computeErrorFingerprint({ type: 'TypeError', message: 'b', custom: 'checkout-timeout' }).fingerprint).toBe(custom.fingerprint);
    expect(computeErrorFingerprint({ custom: ['checkout', 'timeout'] }).method).toBe('custom');
    expect(computeErrorFingerprint({ message: 'a', custom: '   ' }).method).toBe('message');
  });

  it('produces stable 16-hex fingerprints (changing these regroups every issue)', () => {
    expect(hashFingerprint('')).toMatch(/^[0-9a-f]{16}$/);
    expect(isErrorFingerprint(messageFingerprint('TypeError', 'x'))).toBe(true);
    expect(isErrorFingerprint('TypeError|x')).toBe(false);
    expect(hashFingerprint('flareboard')).toBe(hashFingerprint('flareboard'));
    expect(messageFingerprint('NotFoundError', 'User 1 not found')).toBe(STABLE_MESSAGE_FINGERPRINT);
    expect(computeErrorFingerprint({ type: 'TypeError', stack: CHROME_BUILD_A }).fingerprint).toBe(STABLE_STACK_FINGERPRINT);
  });
});

describe('formatStackFromFrames', () => {
  it('renders oldest-first structured frames as a V8 stack that fingerprints like the original', () => {
    const stack = formatStackFromFrames([
      { function: 'Object.onClick', abs_path: 'https://shop.example.com/assets/index-Bx81kLm2.js', lineno: 12, colno: 9876 },
      { function: 'renderCart', filename: 'https://shop.example.com/assets/cart-C3sPvF1q.js', lineno: 1, colno: 2311 },
      { function: 'lineTotal', abs_path: 'https://shop.example.com/assets/cart-C3sPvF1q.js', lineno: 1, colno: 2045 },
      { abs_path: 'https://shop.example.com/assets/boot.js' },
    ]);
    expect(stack.split('\n')[0]).toBe('    at https://shop.example.com/assets/boot.js');
    expect(stack.split('\n')[1]).toBe('    at lineTotal (https://shop.example.com/assets/cart-C3sPvF1q.js:1:2045)');
    const fromFrames = computeErrorFingerprint({ type: 'TypeError', stack: stack.split('\n').slice(1).join('\n') });
    expect(fromFrames.fingerprint).toBe(computeErrorFingerprint({ type: 'TypeError', stack: CHROME_BUILD_A }).fingerprint);
  });
});

const STABLE_MESSAGE_FINGERPRINT = '46b7b7e14e384028';
const STABLE_STACK_FINGERPRINT = 'c42f4725bd56530a';
