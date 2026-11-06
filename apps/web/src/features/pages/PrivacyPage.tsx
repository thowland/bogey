import { Page } from './Page.tsx';

/** Sprint 10 completes this page (spec §11.3, §11.7). */
export function PrivacyPage() {
  return (
    <Page title="Privacy">
      <p>
        Bogey is a set of static files. Everything it does with a PDF, including reading it, filling
        it in and producing the signed copy, happens in this browser tab, and there is no server
        behind the site that could receive a document.
      </p>
      <h2>How to check it</h2>
      <p>
        The site is served with a Content-Security-Policy header that allows the page to load only
        its own files and to connect only to its own address, which accepts nothing but downloads of
        those files. You can see the header in your browser’s developer tools, under the network
        tab, on the response for this page. While you work on a document, the same tab shows that
        nothing is sent.
      </p>
      <h2>What stays on this device</h2>
      <p>
        Documents you open, your signatures and your saved details are kept in this browser’s
        storage so that a reload loses nothing. They never leave the device, and Clear everything in
        the settings menu removes them.
      </p>
    </Page>
  );
}
