import type { IconProps } from '../ui';

/** Table-only stroke icons on the same 24px grid as the ui icons. */
function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>
);
export const SoundOnIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></Icon>
);
export const SoundOffIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></Icon>
);
export const SmileIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14a4 4 0 0 0 7 0" /><path d="M9 9.8h.01M15 9.8h.01" strokeWidth={2.6} /></Icon>
);
export const PauseIcon = (p: IconProps) => (
  <Icon {...p}><path d="M9 6v12M15 6v12" /></Icon>
);
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 4l16 16" /><path d="M9.9 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.6 7.3A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1" /><path d="M10 10.2a2.8 2.8 0 0 0 3.9 3.9" /></Icon>
);
