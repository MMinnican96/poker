import type { MouseEvent, ReactNode } from 'react';
import { useClient } from './client';

export interface ExternalLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
}

/**
 * A link to another site. Inside the Discord Activity iframe a plain
 * `target="_blank"` link is blocked, so the click goes through the SDK's
 * `openExternalLink` (Discord may ask the player to confirm). Outside Discord
 * (mock mode, tests) it is an ordinary new-tab link.
 */
export function ExternalLink({ href, children, className }: ExternalLinkProps) {
  const { sdk } = useClient().session;
  const onClick = sdk
    ? (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        sdk.commands.openExternalLink({ url: href }).catch(() => undefined);
      }
    : undefined;
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={onClick} className={className}>
      {children}
    </a>
  );
}
