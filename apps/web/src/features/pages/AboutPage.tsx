import { CANONICAL_URL } from '../../config.ts';
import { Page } from './Page.tsx';

/** Sprint 10 completes this page (spec §11.7). */
export function AboutPage() {
  return (
    <Page title="About Bogey">
      <p>
        Bogey fills in and signs PDF forms inside the browser. It is a companion to Mulligan, and it
        is free software under the GNU General Public License, version 3 or later.
      </p>
      <dl>
        <dt>Canonical address</dt>
        <dd>{CANONICAL_URL}</dd>
        <dt>Build</dt>
        <dd>
          <code>{__BOGEY_BUILD__}</code>
        </dd>
      </dl>
    </Page>
  );
}
