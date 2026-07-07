import { useEffect, useState } from 'react';

/**
 * Returns a copy of `value` that only updates after it has stopped changing
 * for `delayMs`. Keep the raw value in the input for responsiveness and use
 * the debounced value in query keys to avoid a refetch per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
