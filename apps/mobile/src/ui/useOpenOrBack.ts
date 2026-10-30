import { type Href, router, useRootNavigationState } from 'expo-router';

/**
 * Opens a page, or goes back to it when that same page (same screen and record) is already open behind
 * this one. For links between pages that point at each other (an animal and its records, a health
 * concern and its treatments, a customer and their sales), so Back never loops through copies.
 */
export function useOpenOrBack() {
  const { routes, index } = useRootNavigationState();
  return (href: Href) => {
    const [path, query] = (typeof href === 'string' ? href : href.pathname).split('?');
    const name = path.replace(/^\//, '');
    const params: Record<string, string> = {
      ...Object.fromEntries(new URLSearchParams(query ?? '')),
      ...(typeof href === 'string' ? {} : Object.fromEntries(Object.entries(href.params ?? {}).map(([k, v]) => [k, String(v)]))),
    };
    const same = (r: (typeof routes)[number]) =>
      (r.name === name || r.name === `${name}/index`) && Object.entries(params).every(([k, v]) => String((r.params as Record<string, unknown> | undefined)?.[k]) === v);
    const at = routes.findLastIndex(same);
    if (at === index) return;
    if (at >= 0) router.dismiss(index - at);
    else router.push(href);
  };
}
