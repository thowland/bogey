// Notices a document opens with (D4, spec §6.1, §6.2): hybrid and dynamic XFA, and documents over
// LIMITS.slowPageCount pages. Each can be dismissed for the rest of the session. They are
// information, not failures, so they use the polite `status` role rather than `alert`.
import { useState } from 'react';
import { LIMITS } from '../../config.ts';
import { useDocumentStore } from '../../state/document.ts';
import { Banner } from '../../ui/Banner.tsx';
import { Button } from '../../ui/Button.tsx';
import { NOTICES } from '../../ui/messages.ts';
import { noticesFor, type NoticeKind } from './model.ts';

const TEXT: Record<NoticeKind, (pages: number) => string> = {
  'xfa-hybrid': () => NOTICES.xfaHybrid,
  'xfa-dynamic': () => NOTICES.xfaDynamic,
  'many-pages': (pages) => NOTICES.manyPages(pages),
};

export function DocumentNotices() {
  const info = useDocumentStore((state) => (state.status === 'ready' ? state.info : null));
  const id = useDocumentStore((state) => state.id);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  if (!info) return null;

  const notices = noticesFor(info, LIMITS.slowPageCount).filter(
    (kind) => !dismissed.has(`${id}:${kind}`),
  );
  return (
    <>
      {notices.map((kind) => (
        <Banner
          key={kind}
          actions={
            <Button
              variant="quiet"
              onClick={() => setDismissed((prev) => new Set(prev).add(`${id}:${kind}`))}
            >
              Dismiss
            </Button>
          }
        >
          {TEXT[kind](info.pageCount)}
        </Banner>
      ))}
    </>
  );
}
