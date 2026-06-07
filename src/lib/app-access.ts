export type AppAccessRole = 'admin' | 'support' | string;

export const APP_TAB_VALUES = [
  'chat',
  'queue',
  'notifications',
  'tickets',
  'trainers',
  'reports',
  'insights',
  'momence',
  'settings',
] as const;

export type AppTabValue = typeof APP_TAB_VALUES[number];

const ADMIN_ONLY_TAB_VALUES = new Set<AppTabValue>(['reports', 'insights', 'momence', 'settings']);

export function visibleAppTabValues(accessRole: AppAccessRole): AppTabValue[] {
  return APP_TAB_VALUES.filter((value) => accessRole === 'admin' || !ADMIN_ONLY_TAB_VALUES.has(value));
}

export function canOpenAppTab(accessRole: AppAccessRole, value: string): boolean {
  return visibleAppTabValues(accessRole).includes(value as AppTabValue);
}
