import { useMe, useLobby } from '../../app/client';
import { useNav } from '../../app/nav';
import { Button, EmptyState, Modal } from '../../ui';

export interface ProfileCardModalProps {
  playerId: string;
  onClose(): void;
}

/** Placeholder — replaced in wave 2 with the full profile card. */
export function ProfileCardModal({ playerId, onClose }: ProfileCardModalProps) {
  const me = useMe();
  const member = useLobby()?.members.find((m) => m.id === playerId);
  const nav = useNav();
  const name = playerId === me.id ? me.name : member?.name ?? 'Player profile';
  return (
    <Modal
      open
      onClose={onClose}
      title={name}
      size="sm"
      footer={
        playerId !== me.id && (
          <Button
            variant="brass"
            onClick={() => {
              nav.openMessages(playerId);
              onClose();
            }}
          >
            Send a message
          </Button>
        )
      }
    >
      <EmptyState compact title="Coming up" body="Profile cards with stats, badges and recent form land here soon." />
    </Modal>
  );
}
