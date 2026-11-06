import { useStorageStore } from '../../state/storage.ts';
import { messageFor } from '../../ui/messages.ts';
import { Banner } from '../../ui/Banner.tsx';

/** M3: a persistent banner while nothing can be saved. Sprint 6 refines it. */
export function StorageBanner() {
  const reason = useStorageStore((state) => state.degradeReason);
  if (!reason) return null;
  return (
    <Banner tone="warning">
      {messageFor({ code: reason === 'full' ? 'storage.full' : 'storage.unavailable' })}
    </Banner>
  );
}
