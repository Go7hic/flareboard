import { describe, expect, it } from 'vitest';
import { deviceFromUserAgent } from '@flareboard/shared';
import { parseBrowser, parseOs } from '../../src/routes/collect';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

describe('user agent parsing', () => {
  it('classifies operating systems', () => {
    expect(parseOs(UA.iphone)).toBe('iOS');
    expect(parseOs(UA.ipad)).toBe('iOS');
    expect(parseOs(UA.androidTablet)).toBe('Android');
    expect(parseOs(UA.mac)).toBe('macOS');
  });

  it('classifies devices', () => {
    expect(deviceFromUserAgent(UA.iphone)).toBe('mobile');
    expect(deviceFromUserAgent(UA.ipad)).toBe('tablet');
    expect(deviceFromUserAgent(UA.androidPhone)).toBe('mobile');
    expect(deviceFromUserAgent(UA.androidTablet)).toBe('tablet');
    expect(deviceFromUserAgent(UA.mac)).toBe('desktop');
  });

  it('classifies browsers', () => {
    expect(parseBrowser(UA.edge)).toBe('Edge');
    expect(parseBrowser(UA.chromeIos)).toBe('Chrome');
    expect(parseBrowser(UA.mac)).toBe('Safari');
  });
});
