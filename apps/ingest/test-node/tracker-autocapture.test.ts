import { describe, expect, it } from 'vitest';
import { createBrowser, defaultConfig } from './helpers/fake-browser';

async function loaded(config = defaultConfig(), script?: Record<string, string>) {
  const b = createBrowser({ config, script });
  b.run();
  await b.flush();
  return b;
}

function autocaptured(b: ReturnType<typeof createBrowser>) {
  return b.events('$autocapture').map((e) => e.payload.data ?? {});
}

describe('autocapture', () => {
  it('captures a button click with tag, id, classes, text and selector', async () => {
    const b = await loaded();
    const button = b.mount(
      b.el('nav', { class: 'top' }, b.el('button', { id: 'signup', class: 'btn primary', type: 'submit' }, ' Sign   up ')),
    ).firstChild as never;
    b.click(button);
    await b.flush();

    const [event] = b.events('$autocapture');
    expect(event?.payload).toMatchObject({ website: expect.any(String), url: '/pricing', tag: 'autocapture' });
    expect(event?.payload.data).toMatchObject({
      $event_type: 'click',
      $el_tag: 'button',
      $el_id: 'signup',
      $el_classes: 'btn primary',
      $el_type: 'submit',
      $el_text: 'Sign up',
      $el_selector: 'button#signup',
    });
  });

  it('resolves clicks on children to the link and records href and a short selector chain', async () => {
    const b = await loaded();
    const icon = b.el('span', { class: 'icon' }, 'Pricing');
    b.mount(
      b.el(
        'div',
        { class: 'l1' },
        b.el('div', { class: 'l2' }, b.el('ul', { class: 'menu' }, b.el('li', {}, b.el('a', { href: '/plans?ref=nav', class: 'nav-link' }, icon)))),
      ),
    );
    b.click(icon);
    await b.flush();

    expect(autocaptured(b)[0]).toMatchObject({
      $el_tag: 'a',
      $el_href: '/plans?ref=nav',
      $el_text: 'Pricing',
      $el_selector: 'div.l1 > div.l2 > ul.menu > li > a.nav-link',
    });
  });

  it('ignores clicks on non-interactive elements and captures [role=button] and button inputs', async () => {
    const b = await loaded();
    const div = b.mount(b.el('div', { class: 'card' }, 'Just text'));
    const role = b.mount(b.el('div', { role: 'button' }, 'Open'));
    const input = b.mount(b.el('input', { type: 'button', value: 'Go now', name: 'go' }));
    b.click(div);
    b.click(role);
    b.click(input);
    await b.flush();

    const data = autocaptured(b);
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ $el_tag: 'div', $el_text: 'Open' });
    // Inputs never contribute text, even their value.
    expect(data[1]).toMatchObject({ $el_tag: 'input', $el_type: 'button', $el_name: 'go' });
    expect(data[1]).not.toHaveProperty('$el_text');
    expect(JSON.stringify(data[1])).not.toContain('Go now');
  });

  it('records field changes and form submits without values', async () => {
    const b = await loaded();
    const email = b.el('input', { type: 'email', name: 'email', value: 'ada@example.com' });
    const plan = b.el('select', { name: 'plan' }, b.el('option', { value: 'pro' }, 'Pro plan'));
    const notes = b.el('textarea', { name: 'notes' }, 'typed private notes');
    const form = b.mount(b.el('form', { id: 'signup-form', name: 'signup' }, email, plan, notes));
    b.change(email);
    b.change(plan);
    b.change(notes);
    b.submit(form);
    await b.flush();

    const data = autocaptured(b);
    expect(data.map((d) => [d.$event_type, d.$el_tag, d.$el_name])).toEqual([
      ['change', 'input', 'email'],
      ['change', 'select', 'plan'],
      ['change', 'textarea', 'notes'],
      ['submit', 'form', 'signup'],
    ]);
    const all = JSON.stringify(b.sent);
    expect(all).not.toContain('ada@example.com');
    expect(all).not.toContain('Pro plan');
    expect(all).not.toContain('typed private notes');
    for (const d of data) expect(d).not.toHaveProperty('$el_text');
  });

  it('never captures password fields, hidden fields or sensitive-looking fields', async () => {
    const b = await loaded();
    const password = b.mount(b.el('input', { type: 'password', name: 'pw' }));
    const hidden = b.mount(b.el('input', { type: 'hidden', name: 'csrf' }));
    const card = b.mount(b.el('input', { type: 'text', autocomplete: 'cc-number', name: 'n' }));
    const otp = b.mount(b.el('input', { type: 'text', name: 'otp' }));
    for (const field of [password, hidden, card, otp]) b.change(field);
    await b.flush();
    expect(autocaptured(b)).toEqual([]);
  });

  it('drops text for sensitive elements and sensitive-looking text but keeps the click', async () => {
    const b = await loaded();
    const reveal = b.mount(b.el('button', { id: 'reveal', 'data-action': 'show-password' }, 'Show'));
    const cardText = b.mount(b.el('button', { class: 'pay' }, 'Pay with 4242 4242 4242 4242'));
    const emailText = b.mount(b.el('a', { href: '/me', class: 'me' }, 'Signed in as ada@example.com'));
    const tokenLink = b.mount(b.el('a', { href: '/reset?token=abc123', class: 'reset' }, 'Reset'));
    for (const target of [reveal, cardText, emailText, tokenLink]) b.click(target);
    await b.flush();

    const data = autocaptured(b);
    expect(data).toHaveLength(4);
    for (const d of data) expect(d).not.toHaveProperty('$el_text');
    expect(data[2]).toMatchObject({ $el_href: '/me' });
    expect(data[3]).not.toHaveProperty('$el_href');
    expect(JSON.stringify(b.sent)).not.toMatch(/4242|ada@example\.com|abc123/);
  });

  it('skips anything inside data-fb-no-capture or .ph-no-capture and excluded child text', async () => {
    const b = await loaded();
    const inFb = b.el('button', {}, 'Delete account');
    const inPh = b.el('a', { href: '/x' }, 'Private');
    b.mount(b.el('section', { 'data-fb-no-capture': '' }, inFb));
    b.mount(b.el('div', { class: 'wrap ph-no-capture' }, inPh));
    const mixed = b.mount(b.el('button', {}, 'Hello ', b.el('span', { class: 'ph-no-capture' }, 'Jane Doe'), '!'));
    b.click(inFb);
    b.click(inPh);
    b.click(mixed);
    await b.flush();

    const data = autocaptured(b);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ $el_text: 'Hello !' });
    expect(JSON.stringify(b.sent)).not.toMatch(/Jane Doe|Delete account|Private/);
  });

  it('limits classes to 10 and text to 255 characters', async () => {
    const b = await loaded();
    const classes = Array.from({ length: 14 }, (_, i) => `c${i}`).join(' ');
    const button = b.mount(b.el('button', { class: classes }, 'x'.repeat(400)));
    b.click(button);
    await b.flush();

    const [data] = autocaptured(b);
    expect(String(data?.$el_classes).split(' ')).toHaveLength(10);
    expect(String(data?.$el_text)).toHaveLength(255);
  });

  it('throttles floods per page and drops rapid repeats of the same click', async () => {
    const b = await loaded();
    const same = b.mount(b.el('button', { id: 'same' }, 'Again'));
    for (let i = 0; i < 5; i++) b.click(same);
    const many = Array.from({ length: 30 }, (_, i) => b.mount(b.el('button', { id: `b${i}` }, `B${i}`)));
    for (const target of many) b.click(target);
    await b.flush();

    const data = autocaptured(b);
    expect(data.filter((d) => d.$el_id === 'same')).toHaveLength(1);
    // Burst of 10 tokens: the first 'same' click plus 9 others.
    expect(data).toHaveLength(10);
  });

  it('follows the website setting and lets data-autocapture override it', async () => {
    const off = await loaded(defaultConfig({ autocapture: false }));
    off.click(off.mount(off.el('button', {}, 'Buy')));
    await off.flush();
    expect(off.events('$autocapture')).toHaveLength(0);

    const forcedOn = await loaded(defaultConfig({ autocapture: false }), {
      'data-website-id': defaultConfig().websiteId as string,
      'data-autocapture': 'true',
    });
    forcedOn.click(forcedOn.mount(forcedOn.el('button', {}, 'Buy')));
    await forcedOn.flush();
    expect(forcedOn.events('$autocapture')).toHaveLength(1);

    const forcedOff = await loaded(defaultConfig({ autocapture: true }), {
      'data-website-id': defaultConfig().websiteId as string,
      'data-autocapture': 'false',
    });
    forcedOff.click(forcedOff.mount(forcedOff.el('button', {}, 'Buy')));
    await forcedOff.flush();
    expect(forcedOff.events('$autocapture')).toHaveLength(0);
  });

  it('holds clicks until the website setting is known', async () => {
    let resolve!: (cfg: Record<string, unknown>) => void;
    const b = createBrowser({ config: new Promise((r) => (resolve = r)) });
    b.run();
    b.click(b.mount(b.el('button', {}, 'Early')));
    await b.flush();
    expect(b.events('$autocapture')).toHaveLength(0);

    resolve(defaultConfig({ autocapture: true }));
    await b.flush();
    expect(autocaptured(b)).toEqual([expect.objectContaining({ $el_text: 'Early' })]);
    // Recorded on the page where the click happened.
    expect(b.events('$autocapture')[0]?.payload.url).toBe('/pricing');
  });

  it('drops held clicks when the website has autocapture off or the config fails', async () => {
    let resolve!: (cfg: Record<string, unknown> | null) => void;
    const b = createBrowser({ config: new Promise((r) => (resolve = r)) });
    b.run();
    b.click(b.mount(b.el('button', {}, 'Early')));
    resolve(null);
    await b.flush();
    expect(b.events('$autocapture')).toHaveLength(0);
    expect(b.pageviews()).toHaveLength(1);
  });

  it('never autocaptures the survey widget', async () => {
    const b = await loaded(
      defaultConfig({ surveys: [{ id: 's1', name: 'NPS', question: 'Plan?', type: 'choice', options: ['Pro'], displayRules: [] }] }),
    );
    (b.window.flareboard as { showSurvey(): void }).showSurvey();
    const box = b.document.getElementById('flareboard-survey');
    expect(box).not.toBeNull();
    const option = (box as unknown as { querySelectorAll(tag: string): never[] }).querySelectorAll('button')[0];
    b.click(option);
    await b.flush();
    expect(b.events('$autocapture')).toHaveLength(0);
  });
});
