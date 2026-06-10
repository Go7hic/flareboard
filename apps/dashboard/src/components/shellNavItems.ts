import type { SidebarNavIconName } from './SidebarNavIcon';

export const shellNavItems = [
  { to: '/dashboard', labelKey: 'dashboard', icon: 'dashboard' as SidebarNavIconName },
  { to: '/websites', labelKey: 'websites', icon: 'websites' as SidebarNavIconName, end: true },
  { to: '/teams', labelKey: 'teams', icon: 'teams' as SidebarNavIconName },
  { to: '/links', labelKey: 'links', icon: 'links' as SidebarNavIconName },
  { to: '/reports', labelKey: 'reports', icon: 'reports' as SidebarNavIconName },
  { to: '/boards', labelKey: 'boards', icon: 'boards' as SidebarNavIconName },
  { to: '/admin', labelKey: 'admin', icon: 'admin' as SidebarNavIconName },
  { to: '/billing', labelKey: 'billing', icon: 'billing' as SidebarNavIconName, hostedOnly: true },
] as const;

export type ShellNavItem = (typeof shellNavItems)[number];

export function filterShellNavItems(items: readonly ShellNavItem[], hosted: boolean, isAdmin: boolean) {
  return items.filter((item) => {
    if (item.to === '/admin' && !isAdmin) return false;
    if ('hostedOnly' in item && item.hostedOnly && !hosted) return false;
    return true;
  });
}
