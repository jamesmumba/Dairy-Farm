import { type Href, router, useRootNavigationState } from 'expo-router';

/**
 * Opens a page, or goes back to it when it is already open (this one or behind it). For links between pages that
 * point at each other (an animal and its records, a customer and their sales), so Back never loops
 * through copies of the same pages.
 */
export function useOpenOrBack() {
  const { routes } = useRootNavigationState();
  return (href: Href) => {
    const path = (typeof href === 'string' ? href : href.pathname).split('?')[0].replace(/^\//, '');
    const open = routes.some((r) => r.name === path || r.name === `${path}/index`);
    if (open) router.dismissTo(href);
    else router.push(href);
  };
}
