// About (U5, spec §10.4, §11.1 T6, §11.7): what Bogey is, who wrote it, the license and where the
// source is, and the version and build, so a copy served from elsewhere can be told apart.
import { version } from '../../../package.json';
import { CANONICAL_URL } from '../../config.ts';
import { Page, Section } from './Page.tsx';
import styles from './Page.module.css';

export const CONTACT_EMAIL = 'th@wdogsystems.com';
const LICENSE_URL = 'https://www.gnu.org/licenses/gpl-3.0.html';
const MULLIGAN_URL = 'https://mulligan.beta-site.us';

export function AboutPage() {
  return (
    <Page title="About Bogey" lede={`Version ${version}`}>
      <Section title="What Bogey does">
        <p>
          Bogey fills in and signs PDF forms. You open a form, fill in its fields or type onto the
          page, place a signature you saved earlier, and download a flattened copy to send back. It
          runs entirely in your browser, on a computer or an iPad, and works offline once it has
          loaded, so the forms you fill in and the signatures you keep never leave your device.
        </p>
        <p>
          It is a companion to <a href={MULLIGAN_URL}>Mulligan</a>, which prepares app store
          screenshots and listing copy, and it is built the same way: a static site with a strict
          security policy, no server-side code and nothing to sign up for. The name follows
          Mulligan’s: in golf, a bogey is a hole finished one stroke over par.
        </p>
      </Section>

      <Section title="Author and contact">
        <p>
          Bogey was written by Tim Howland. Questions, problems and suggestions are welcome at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>

      <Section title="Source code and license">
        <p>Copyright © 2026 Tim Howland.</p>
        <p>
          Bogey is free software: you can redistribute it and change it under the terms of the{' '}
          <a href={LICENSE_URL}>GNU General Public License</a>, version 3 or later. It comes with no
          warranty. The complete source code is available from the author at the address above. It
          uses pdf.js from Mozilla to show documents and pdf-lib to write them, both under their own
          open-source licenses, and the Liberation Sans font under the SIL Open Font License.
        </p>
      </Section>

      <Section title="Version and build">
        <p>
          The published build is served only from{' '}
          <a href={CANONICAL_URL}>{CANONICAL_URL.replace('https://', '')}</a>. A copy served from
          anywhere else may have been changed, and its security policy may not be the one described
          on the Privacy page.
        </p>
        <dl className={styles.facts}>
          <dt>Version</dt>
          <dd>{version}</dd>
          <dt>Build</dt>
          <dd>
            <code>{__BOGEY_BUILD__}</code>
          </dd>
          <dt>Address</dt>
          <dd>{CANONICAL_URL}</dd>
        </dl>
      </Section>
    </Page>
  );
}
