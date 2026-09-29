import { describe, expect, it } from 'vitest';
import { describeAutocapture, describeBuiltinEvent, describePageleave, eventDisplayName } from './autocapture';

describe('built-in event descriptions', () => {
  it('describes clicks, submits and changes with the best available label', () => {
    expect(describeAutocapture({ $event_type: 'click', $el_tag: 'button', $el_text: 'Sign up' })).toBe(
      "Clicked button 'Sign up'",
    );
    expect(describeAutocapture([{ key: '$event_type', value: 'click' }, { key: '$el_tag', value: 'a' }, { key: '$el_text', value: 'Pricing' }])).toBe(
      "Clicked link 'Pricing'",
    );
    expect(describeAutocapture({ $event_type: 'click', $el_tag: 'input', $el_type: 'submit', $el_name: 'go' })).toBe(
      "Clicked button 'go'",
    );
    expect(describeAutocapture({ $event_type: 'click', $el_tag: 'div' })).toBe('Clicked button');
    expect(describeAutocapture({ $event_type: 'submit', $el_tag: 'form', $el_name: 'signup' })).toBe(
      "Submitted form 'signup'",
    );
    expect(describeAutocapture({ $event_type: 'change', $el_tag: 'input', $el_type: 'email', $el_id: 'email' })).toBe(
      "Changed field 'email'",
    );
    expect(describeAutocapture({ $event_type: 'change', $el_tag: 'select', $el_name: 'plan' })).toBe(
      "Changed dropdown 'plan'",
    );
    expect(describeAutocapture({ $event_type: 'change', $el_tag: 'input', $el_type: 'checkbox' })).toBe(
      'Changed checkbox',
    );
  });

  it('shortens long labels', () => {
    const text = describeAutocapture({ $event_type: 'click', $el_tag: 'a', $el_text: 'x'.repeat(200) });
    expect(text.length).toBeLessThan(90);
    expect(text).toContain('…');
  });

  it('describes page leaves', () => {
    expect(describePageleave({ $time_on_page: 72, $max_scroll_depth: 80 })).toBe('Left after 1m 12s, scrolled 80%');
    expect(describePageleave({})).toBe('Left after 0s, scrolled 0%');
  });

  it('only handles built-in events', () => {
    expect(describeBuiltinEvent('signup', { plan: 'pro' })).toBeNull();
    expect(describeBuiltinEvent('$pageleave', { $time_on_page: 5 })).toContain('5s');
    expect(eventDisplayName('$autocapture')).toBe('Autocapture');
    expect(eventDisplayName('$pageleave')).toBe('Page leave');
    expect(eventDisplayName('signup')).toBe('signup');
  });
});
