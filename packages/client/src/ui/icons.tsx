import type { ReactNode, SVGProps } from 'react';

/** Stroke icons drawn on a 24px grid. They inherit `currentColor` and are decorative by default. */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
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

export const TableIcon = (p: IconProps) => (
  <Icon {...p}><ellipse cx="12" cy="12" rx="9.5" ry="6.5" /><ellipse cx="12" cy="12" rx="5.5" ry="3" strokeDasharray="2 2.2" /></Icon>
);
export const TrophyIcon = (p: IconProps) => (
  <Icon {...p}><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 6H5a2.5 2.5 0 0 0 3 4M16 6h3a2.5 2.5 0 0 1-3 4M12 13v4M8.5 20h7M9.5 17h5" /></Icon>
);
export const ChartIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 20h16" /><path d="M7 16v-4M12 16V7M17 16v-6" /></Icon>
);
export const TargetIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></Icon>
);
export const ShopIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8Z" /><path d="M9 10V6.5a3 3 0 0 1 6 0V10" /></Icon>
);
export const ChatIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4.5 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" /></Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>
);
export const UsersIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17 14a5.5 5.5 0 0 1 3.5 5" /></Icon>
);
export const SendIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 12 20 4l-5 16-3.5-6.5L4 12Z" /><path d="m11.5 13.5 3-3" /></Icon>
);
export const GiftIcon = (p: IconProps) => (
  <Icon {...p}><rect x="4" y="9" width="16" height="11" rx="1" /><path d="M3 9h18M12 9v11" /><path d="M12 9c-1.5-3.5-5-4-5-1.5S10 9 12 9Zm0 0c1.5-3.5 5-4 5-1.5S14 9 12 9Z" /></Icon>
);
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></Icon>
);
export const SeatIcon = (p: IconProps) => (
  <Icon {...p}><path d="M7 4v9h10" /><path d="M7 13v7M17 13v7M7 9h8" /></Icon>
);
export const DoorIcon = (p: IconProps) => (
  <Icon {...p}><path d="M14 4H6v16h8" /><path d="M11 12h9M17 9l3 3-3 3" /></Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
);
export const MinusIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 12h14" /></Icon>
);
export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Icon>
);
export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}><path d="M20 11a8 8 0 1 0-2.3 6.3" /><path d="M20 4v7h-7" /></Icon>
);
export const CrownIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 8l4 4 4-7 4 7 4-4-1.5 10h-13L4 8Z" /></Icon>
);
