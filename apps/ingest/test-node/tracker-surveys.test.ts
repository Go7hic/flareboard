import { describe, expect, it } from 'vitest';
import {
  SURVEY_DISPLAY_RULE_OPERATORS,
  deviceFromUserAgent,
  nextSurveyQuestion,
  surveyDisplayRuleMatches,
  surveyPalette,
  surveySampleBucket,
  type SurveyAnswerValue,
  type SurveyQuestion,
} from '@flareboard/shared';
import { TRACKER_SCRIPT } from '../src/tracker/script';
import { FakeElement, FakeStorage, createBrowser, defaultConfig, type FakeBrowser } from './helpers/fake-browser';

type Survey = Record<string, unknown>;

const base = { description: '', optional: false, buttonText: '', branching: [] };

function survey(questions: unknown[], extra: Survey = {}): Survey {
  return {
    id: 'sv1',
    name: 'Feedback',
    question: 'legacy',
    type: 'text',
    options: [],
    displayRules: [],
    version: 2,
    questions,
    appearance: { position: 'bottom-right', theme: 'light', accent: 'neutral', submitText: '', showThankYou: true, thankYouMessage: 'Thanks a lot', colors: surveyPalette('neutral') },
    sampleRate: 100,
    repeatIntervalDays: null,
    endsAt: null,
    ...extra,
  };
}

async function open(surveys: Survey[], options: Parameters<typeof createBrowser>[0] = {}) {
  const b = createBrowser({
    localStorage: new FakeStorage({ 'flareboard.distinct_id': 'user-1' }),
    ...options,
    config: defaultConfig({ autocapture: true, surveys }),
  });
  b.run();
  await b.flush();
  (b.window.flareboard as { showSurvey(): void }).showSurvey();
  return b;
}

function box(b: FakeBrowser) {
  return b.document.getElementById('flareboard-survey') as FakeElement | null;
}

function all(root: FakeElement | null, tag: string) {
  return root ? root.querySelectorAll(tag) : [];
}

function button(b: FakeBrowser, text: string) {
  const found = all(box(b), 'button').find((el) => el.textContent === text);
  if (!found) throw new Error(`no button "${text}" in: ${all(box(b), 'button').map((el) => el.textContent).join(', ')}`);
  return found;
}

function press(b: FakeBrowser, text: string) {
  button(b, text).onclick!();
}

function title(b: FakeBrowser) {
  return all(box(b), 'div').find((el) => el.id === 'fb-sv-q')?.textContent;
}

function responses(b: FakeBrowser) {
  return b.requests
    .filter((r) => r.url.endsWith('/api/surveys/response'))
    .map((r) => r.body as Record<string, unknown>);
}

describe('survey branching', () => {
  it('the tracker picks the same next question as nextSurveyQuestion', () => {
    const source = ['svCond', 'svNext'].map((name) => {
      const match = TRACKER_SCRIPT.split('\n').find((line) => line.startsWith(`function ${name}(`));
      expect(match).toBeTruthy();
      return match!;
    });
    const svNext = new Function(`${source.join('\n')}; return svNext;`)() as (
      qs: SurveyQuestion[],
      i: number,
      a: SurveyAnswerValue | undefined,
    ) => number | 'end';

    const questions = [
      {
        ...base,
        id: 'r',
        type: 'rating',
        scale: 'nps',
        lowerLabel: '',
        upperLabel: '',
        branching: [
          { when: { type: 'range', min: 0, max: 6 }, next: 'm' },
          { when: { type: 'range', min: 9, max: 10 }, next: 'end' },
        ],
      },
      { ...base, id: 's', type: 'single_choice', options: ['A', 'B'], hasOther: true, branching: [{ when: { type: 'choice', value: '$other' }, next: 'o' }, { when: { type: 'choice', value: 'B' }, next: 'end' }] },
      { ...base, id: 'm', type: 'multiple_choice', options: ['A', 'B', 'C'], hasOther: true, branching: [{ when: { type: 'choice', value: 'C' }, next: 'o' }, { when: { type: 'any' }, next: 'l' }] },
      // A stale rule pointing backwards falls through to the next question.
      { ...base, id: 'l', type: 'link', url: 'https://example.com', branching: [{ when: { type: 'any' }, next: 'r' }] },
      { ...base, id: 'o', type: 'open', placeholder: '', optional: true },
    ] as SurveyQuestion[];
    const answers: Array<SurveyAnswerValue | undefined> = [undefined, 0, 6, 7, 9, 10, 'A', 'B', 'free text', ['A'], ['C'], ['B', 'mine'], 'clicked', 'x'];
    for (let i = 0; i < questions.length; i++) {
      for (const answer of answers) {
        expect(svNext(questions, i, answer)).toBe(nextSurveyQuestion(questions, i, answer));
      }
    }
    expect(svNext(questions, 9, undefined)).toBe('end');
  });
});

describe('survey widget', () => {
  const flow = [
    { ...base, id: 'q1', type: 'rating', scale: 'nps', question: 'How likely are you to recommend us?', lowerLabel: 'Not likely', upperLabel: 'Very likely', branching: [{ when: { type: 'range', min: 0, max: 6 }, next: 'q3' }] },
    { ...base, id: 'q2', type: 'open', question: 'What do you love?', placeholder: 'Tell us' },
    { ...base, id: 'q3', type: 'single_choice', question: 'What should we fix?', options: ['Speed', 'Price'], hasOther: false, buttonText: 'Send it' },
  ];

  it('renders NPS 0-10 with labels, branches on the answer and submits the whole response', async () => {
    const b = await open([survey(flow)]);
    expect(box(b)?.getAttribute('role')).toBe('dialog');
    expect(title(b)).toBe('How likely are you to recommend us?');
    const scale = all(box(b), 'button').filter((el) => /^\d+$/.test(el.textContent));
    expect(scale.map((el) => el.textContent)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(all(box(b), 'span').map((el) => el.textContent)).toEqual(['Not likely', 'Very likely']);

    press(b, 'Next');
    expect(title(b)).toBe('How likely are you to recommend us?'); // required: nothing selected
    press(b, '3');
    expect(button(b, '3').getAttribute('aria-pressed')).toBe('true');
    press(b, 'Next');
    // 3 is a detractor score: the rule jumps over q2.
    expect(title(b)).toBe('What should we fix?');
    all(box(b), 'input')[1]!.checked = true;
    press(b, 'Send it');
    await b.flush();

    const [body] = responses(b);
    expect(body).toMatchObject({
      surveyId: 'sv1',
      answers: { q1: 3, q3: 'Price' },
      completed: true,
      distinctId: 'user-1',
      sessionId: 'session-1',
      urlPath: '/pricing',
    });
    expect(body?.responseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(all(box(b), 'div').some((el) => el.textContent === 'Thanks a lot')).toBe(true);
    expect(b.events('survey_response')).toHaveLength(1);
  });

  it('continues in order without a matching rule and uses the survey submit text on the last step', async () => {
    const b = await open([survey(flow, { appearance: { ...survey(flow).appearance as object, submitText: 'Done', showThankYou: false } })]);
    press(b, '9');
    press(b, 'Next');
    expect(title(b)).toBe('What do you love?');
    const textarea = all(box(b), 'textarea')[0]!;
    expect(textarea.getAttribute('aria-labelledby')).toBe('fb-sv-q');
    // Moving to the next step puts focus on its first control.
    expect(b.document.activeElement).toBe(textarea);
    textarea.value = '  The speed  ';
    press(b, 'Next');
    expect(button(b, 'Send it')).toBeTruthy();
    all(box(b), 'input')[0]!.checked = true;
    press(b, 'Send it');
    await b.flush();
    expect(responses(b)[0]?.answers).toEqual({ q1: 9, q2: 'The speed', q3: 'Speed' });
    expect(box(b)).toBeNull();
  });

  it('records multiple choice with "Other" text in option order', async () => {
    const q = { ...base, id: 'm', type: 'multiple_choice', question: 'Which features?', options: ['Flags', 'Replay', 'Funnels'], hasOther: true };
    const b = await open([survey([q])]);
    const inputs = all(box(b), 'input');
    expect(inputs.map((el) => el.type)).toEqual(['checkbox', 'checkbox', 'checkbox', 'checkbox', 'text']);
    expect(inputs[4]!.getAttribute('aria-label')).toBe('Other');
    inputs[2]!.checked = true;
    inputs[0]!.checked = true;
    inputs[4]!.value = 'Surveys';
    inputs[4]!.oninput!();
    expect(inputs[3]!.checked).toBe(true);
    // Field changes inside the survey never reach autocapture.
    b.change(inputs[4]!);
    press(b, 'Submit');
    await b.flush();
    expect(responses(b)[0]?.answers).toEqual({ m: ['Flags', 'Funnels', 'Surveys'] });
    expect(b.events('$autocapture')).toHaveLength(0);
  });

  it('lets optional questions be skipped and an "any" rule branch on a skip', async () => {
    const qs = [
      { ...base, id: 'a', type: 'open', question: 'Anything else?', optional: true, branching: [{ when: { type: 'any' }, next: 'c' }] },
      { ...base, id: 'b', type: 'open', question: 'Never shown' },
      { ...base, id: 'c', type: 'rating', scale: 5, question: 'Rate us', lowerLabel: '', upperLabel: '' },
    ];
    const b = await open([survey(qs)]);
    press(b, 'Skip');
    expect(title(b)).toBe('Rate us');
    expect(all(box(b), 'button').filter((el) => /^\d+$/.test(el.textContent))).toHaveLength(5);
    expect(() => button(b, 'Skip')).toThrow();
  });

  it('posts a partial response on dismiss and completes the same response id later in the flow', async () => {
    const b = await open([survey(flow)]);
    press(b, '8');
    press(b, 'Next');
    box(b)!.onkeydown!({ key: 'Escape' });
    await b.flush();
    const [partial] = responses(b);
    expect(partial).toMatchObject({ answers: { q1: 8 }, completed: false });
    expect(box(b)).toBeNull();

    // Dismissing before answering anything sends nothing.
    const c = await open([survey(flow)]);
    press(c, '×');
    await c.flush();
    expect(responses(c)).toHaveLength(0);
    expect(box(c)).toBeNull();
  });

  it('uses one response id for the whole display', async () => {
    const b = await open([survey(flow)]);
    press(b, '10');
    press(b, 'Next');
    all(box(b), 'textarea')[0]!.value = 'All of it';
    press(b, 'Next');
    press(b, '×');
    await b.flush();
    const [partial] = responses(b);
    expect(partial).toMatchObject({ answers: { q1: 10, q2: 'All of it' }, completed: false });
  });

  it('opens link steps in a new tab with noopener and records "clicked"', async () => {
    const q = { ...base, id: 'l', type: 'link', question: 'Read the docs', url: 'https://docs.example.com/start', buttonText: 'Open docs' };
    const b = await open([survey([q])]);
    press(b, 'Open docs');
    await b.flush();
    expect(b.window.opened).toEqual([['https://docs.example.com/start', '_blank', 'noopener']]);
    expect(responses(b)[0]?.answers).toEqual({ l: 'clicked' });
  });

  it('falls back to the legacy single-question fields without version 2', async () => {
    const legacy = { id: 'old', name: 'Old', question: 'Pick one', type: 'choice', options: ['Yes', 'No'], displayRules: [] };
    const b = await open([legacy]);
    expect(title(b)).toBe('Pick one');
    all(box(b), 'input')[0]!.checked = true;
    press(b, 'Submit');
    await b.flush();
    expect(responses(b)[0]).toMatchObject({ surveyId: 'old', answers: { q1: 'Yes' }, completed: true });
  });
});

describe('survey targeting', () => {
  const q = [{ ...base, id: 'q1', type: 'open', question: 'Hi?' }];

  it('samples people with the canonical hash', async () => {
    const bucket = surveySampleBucket('sv1', 'user-1');
    const out = await open([survey(q, { sampleRate: bucket })]);
    expect(box(out)).toBeNull();
    const inside = await open([survey(q, { sampleRate: bucket + 1 })]);
    expect(box(inside)).not.toBeNull();
  });

  it('shows once per person unless a repeat interval has passed, and never after endsAt', async () => {
    const localStorage = new FakeStorage({ 'flareboard.distinct_id': 'user-1' });
    const first = await open([survey(q)], { localStorage });
    expect(box(first)).not.toBeNull();
    expect(Number(localStorage.getItem('flareboard.survey:sv1'))).toBeGreaterThan(Date.now() - 60_000);
    const again = await open([survey(q)], { localStorage });
    expect(box(again)).toBeNull();

    const day = 86_400_000;
    localStorage.setItem('flareboard.survey:sv1', String(Date.now() - 8 * day));
    expect(box(await open([survey(q, { repeatIntervalDays: 7 })], { localStorage }))).not.toBeNull();
    localStorage.setItem('flareboard.survey:sv1', String(Date.now() - day));
    expect(box(await open([survey(q, { repeatIntervalDays: 7 })], { localStorage }))).toBeNull();

    // Surveys marked seen by older trackers ('1') still count as shown.
    const legacySeen = new FakeStorage({ 'flareboard.survey:sv1': '1' });
    expect(box(await open([survey(q)], { localStorage: legacySeen }))).toBeNull();

    expect(box(await open([survey(q, { endsAt: Date.now() - 1000 })]))).toBeNull();
  });

  it('never shows surveys to visitors who opted out', async () => {
    const b = await open([survey(q)], { localStorage: new FakeStorage({ 'flareboard.opt_out': '1' }) });
    expect(box(b)).toBeNull();
  });
});

describe('survey appearance', () => {
  const q = [{ ...base, id: 'q1', type: 'open', question: 'Hi?' }];
  const palette = surveyPalette('blue');

  function styled(theme: string, extra: Parameters<typeof createBrowser>[0] = {}, position = 'bottom-right') {
    return open(
      [survey(q, { appearance: { position, theme, accent: 'blue', submitText: '', showThankYou: true, thankYouMessage: '', colors: palette } })],
      extra,
    );
  }

  it('uses the dark palette for dark theme and for auto when the visitor prefers dark', async () => {
    const dark = await styled('dark');
    expect(box(dark)?.style.cssText).toContain(`background:${palette.dark.background}`);
    expect(button(dark, 'Submit').style.cssText).toContain(`background:${palette.dark.accent}`);

    const auto = await styled('auto', { prefersDark: true });
    expect(box(auto)?.style.cssText).toContain(`background:${palette.dark.background}`);

    const light = await styled('auto', { prefersDark: false });
    expect(box(light)?.style.cssText).toContain(`background:${palette.light.background}`);
    expect(button(light, 'Submit').style.cssText).toContain(`color:${palette.light.accentText}`);
    expect(box(light)?.style.cssText).not.toContain('#0d9488');
  });

  it('positions the widget', async () => {
    expect(box(await styled('light', {}, 'center'))?.style.cssText).toContain('left:50%;top:50%');
    expect(box(await styled('light', {}, 'top-left'))?.style.cssText).toContain('left:18px;top:18px');
    expect(box(await styled('light', {}, 'bottom-right'))?.style.cssText).toContain('right:18px;bottom:18px');
  });
});

function trackerFunction<T>(name: string, prelude = '') {
  const line = TRACKER_SCRIPT.split('\n').find((item) => item.startsWith(`function ${name}(`));
  expect(line).toBeTruthy();
  return new Function(`${prelude}${line}; return ${name};`)() as T;
}

describe('survey display rules', () => {
  const q = [{ ...base, id: 'q1', type: 'open', question: 'Hi?' }];
  const rule = (field: string, operator: string, value = '', key?: string) => ({ field, operator, value, ...(key ? { key } : {}) });
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const TABLET = 'Mozilla/5.0 (Android 14; Tablet; rv:128.0) Gecko/128.0 Firefox/128.0';
  const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
  const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
  const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';

  async function shownOnLoad(rules: unknown[], options: Parameters<typeof createBrowser>[0] = {}) {
    return box(await open([survey(q, { displayRules: rules })], { url: 'https://shop.example.test/checkout/pay', ...options })) != null;
  }

  /** Loads the page (rules must not match yet), then sends one track() call. */
  async function shownAfterTrack(rules: unknown[], name: string, data?: Record<string, unknown>) {
    const b = await open([survey(q, { displayRules: rules })]);
    expect(box(b)).toBeNull();
    (b.window.flareboard as { track(n: string, d?: unknown): void }).track(name, data);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await b.flush();
    return box(b) != null;
  }

  it('compares like surveyDisplayRuleMatches for every operator', () => {
    const svRuleOp = trackerFunction<(op: string, v: unknown, x: unknown) => boolean>('svRuleOp');
    const actual = [null, '', 'Checkout', '/checkout/pay', 'pay', 'fr-FR'];
    const expected = ['', 'checkout', 'CHECKOUT', '/checkout', 'pay', '/checkout/pay', 'fr', 'zz'];
    for (const op of [...SURVEY_DISPLAY_RULE_OPERATORS, 'unknown']) {
      for (const a of actual) {
        for (const x of expected) expect(svRuleOp(op, a, x), `${a} ${op} ${x}`).toBe(surveyDisplayRuleMatches(op, a, x));
      }
    }
  });

  it('labels devices like the console', () => {
    const svDevice = trackerFunction<() => string>('svDevice', 'var nv={get userAgent(){return globalThis.__ua}};');
    for (const ua of [IPHONE, IPAD, ANDROID_TABLET, TABLET, DESKTOP, ANDROID_PHONE, 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)', '']) {
      (globalThis as { __ua?: string }).__ua = ua;
      expect(svDevice(), ua).toBe(deviceFromUserAgent(ua));
    }
    delete (globalThis as { __ua?: string }).__ua;
  });

  it('matches path with every operator', async () => {
    const cases: Array<[string, string, boolean]> = [
      ['equals', '/checkout/pay', true],
      ['equals', '/checkout', false],
      ['contains', 'CHECKOUT', true],
      ['contains', 'pricing', false],
      ['starts_with', '/checkout', true],
      ['starts_with', '/pay', false],
      ['ends_with', '/pay', true],
      ['ends_with', '/checkout', false],
      ['not_equals', '/pricing', true],
      ['not_equals', '/checkout/pay', false],
      ['not_contains', 'pricing', true],
      ['not_contains', 'checkout', false],
      ['exists', '', true],
      ['not_exists', '', false],
    ];
    for (const [operator, value, shown] of cases) {
      expect(await shownOnLoad([rule('path', operator, value)]), `path ${operator} ${value}`).toBe(shown);
    }
  });

  it('matches language', async () => {
    const french = { language: 'fr-FR' };
    expect(await shownOnLoad([rule('language', 'equals', 'FR-fr')], french)).toBe(true);
    expect(await shownOnLoad([rule('language', 'starts_with', 'fr')], french)).toBe(true);
    expect(await shownOnLoad([rule('language', 'starts_with', 'en')], french)).toBe(false);
    expect(await shownOnLoad([rule('language', 'not_equals', 'en-US')], french)).toBe(true);
    expect(await shownOnLoad([rule('language', 'exists')], { language: '' })).toBe(false);
    expect(await shownOnLoad([rule('language', 'not_exists')], { language: '' })).toBe(true);
  });

  it('matches device: mobile, tablet or desktop from the user agent', async () => {
    expect(await shownOnLoad([rule('device', 'equals', 'mobile')], { userAgent: IPHONE })).toBe(true);
    expect(await shownOnLoad([rule('device', 'equals', 'mobile')], { userAgent: DESKTOP })).toBe(false);
    expect(await shownOnLoad([rule('device', 'equals', 'tablet')], { userAgent: TABLET })).toBe(true);
    // iPads say "Mobile" and Android tablets do not: both are tablets, as in the console.
    expect(await shownOnLoad([rule('device', 'equals', 'tablet')], { userAgent: IPAD })).toBe(true);
    expect(await shownOnLoad([rule('device', 'equals', 'tablet')], { userAgent: ANDROID_TABLET })).toBe(true);
    expect(await shownOnLoad([rule('device', 'equals', 'mobile')], { userAgent: ANDROID_PHONE })).toBe(true);
    expect(await shownOnLoad([rule('device', 'equals', 'desktop')], { userAgent: DESKTOP })).toBe(true);
    expect(await shownOnLoad([rule('device', 'not_equals', 'desktop')], { userAgent: IPHONE })).toBe(true);
  });

  it('matches the triggering event, which is absent on page load', async () => {
    expect(await shownOnLoad([rule('event', 'equals', 'checkout_started')])).toBe(false);
    expect(await shownOnLoad([rule('event', 'not_exists')])).toBe(true);
    expect(await shownOnLoad([rule('event', 'not_equals', 'checkout_started')])).toBe(true);
    expect(await shownAfterTrack([rule('event', 'equals', 'checkout_started')], 'checkout_started')).toBe(true);
    expect(await shownAfterTrack([rule('event', 'equals', 'checkout_started')], 'signup')).toBe(false);
    expect(await shownAfterTrack([rule('event', 'starts_with', 'checkout_')], 'checkout_completed')).toBe(true);
    expect(await shownAfterTrack([rule('event', 'ends_with', '_started')], 'trial_started')).toBe(true);
    expect(await shownAfterTrack([rule('event', 'contains', 'out')], 'checkout_started')).toBe(true);
    expect(await shownAfterTrack([rule('event', 'exists')], 'anything')).toBe(true);
    expect(await shownAfterTrack([rule('event', 'not_contains', 'checkout'), rule('event', 'exists')], 'checkout_started')).toBe(false);
  });

  it('matches properties of the triggering track() call', async () => {
    const plan = (operator: string, value = '') => [rule('property', operator, value, 'plan')];
    expect(await shownOnLoad(plan('equals', 'pro'))).toBe(false);
    expect(await shownAfterTrack(plan('equals', 'PRO'), 'upgrade', { plan: 'pro' })).toBe(true);
    expect(await shownAfterTrack(plan('equals', 'pro'), 'upgrade', { plan: 'free' })).toBe(false);
    expect(await shownAfterTrack(plan('exists'), 'upgrade', { plan: 'team' })).toBe(true);
    expect(await shownAfterTrack(plan('exists'), 'upgrade', { seats: 3 })).toBe(false);
    expect(await shownAfterTrack([rule('property', 'equals', '3', 'seats'), rule('event', 'equals', 'upgrade')], 'upgrade', { seats: 3 })).toBe(true);
    expect(await shownAfterTrack([rule('property', 'equals', 'true', 'trial')], 'upgrade', { trial: true })).toBe(true);
    // A survey with a trigger event still needs its rules to pass.
    const b = await open([survey(q, { triggerEvent: 'upgrade', displayRules: plan('not_equals', 'free') })]);
    expect(box(b)).toBeNull();
    (b.window.flareboard as { track(n: string, d?: unknown): void }).track('upgrade', { plan: 'free' });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await b.flush();
    expect(box(b)).toBeNull();
  });

  it('ignores rules it does not know and requires every rule to match', async () => {
    expect(await shownOnLoad([rule('country', 'equals', 'us')])).toBe(false);
    expect(await shownOnLoad([rule('path', 'contains', 'checkout'), rule('language', 'equals', 'de-DE')])).toBe(false);
    expect(await shownOnLoad([rule('path', 'contains', 'checkout'), rule('language', 'equals', 'en-US')])).toBe(true);
  });

  it('leaves surveys without event rules to page loads', async () => {
    expect(await shownAfterTrack([rule('path', 'equals', '/nowhere')], 'signup')).toBe(false);
  });
});
