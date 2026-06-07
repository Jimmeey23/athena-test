const SIDEBAR_BASE_CLASSES = [
  'z-10',
  'hidden',
  'min-h-0',
  'h-full',
  'flex-shrink-0',
  'flex-col',
  'overflow-y-auto',
  'overflow-x-hidden',
  'border-l',
  'border-slate-200/80',
  'bg-white/75',
  'py-3',
  'shadow-[-10px_0_40px_rgba(15,23,42,0.04)]',
  'backdrop-blur-xl',
  'transition-all',
  'duration-300',
  'md:flex',
].join(' ');

export function appSidebarClassName(expanded: boolean): string {
  return `${SIDEBAR_BASE_CLASSES} ${expanded ? 'w-56 px-2.5' : 'w-[72px] px-2'}`;
}
