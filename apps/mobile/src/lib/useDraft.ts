import { useCallback, useState } from 'react';
import { getJson, remove, setJson } from './localDb';

/**
 * Form state that survives navigation, app kills and restarts. The draft is kept on the
 * phone until `clear()` is called after a successful save.
 */
export function useDraft<T extends object>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => ({ ...initial(), ...(getJson<Partial<T>>(`draft.${key}`) ?? {}) }));

  const update = useCallback(
    (patch: Partial<T>) =>
      setValue((prev) => {
        const next = { ...prev, ...patch };
        setJson(`draft.${key}`, next);
        return next;
      }),
    [key],
  );

  const clear = useCallback(() => remove(`draft.${key}`), [key]);

  return [value, update, clear] as const;
}
