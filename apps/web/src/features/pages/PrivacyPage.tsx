// Privacy (U5, spec §10.4, §11.3, §11.5, §11.7): what is kept on the device and where, how to see
// for yourself that nothing is sent, Clear everything, and how offline use and updates work.
import { LIMITS } from '../../config.ts';
import { ClearEverything } from '../settings/ClearEverything.tsx';
import { Page, Section } from './Page.tsx';
import styles from './Page.module.css';

export function PrivacyPage() {
  return (
    <Page
      title="Privacy"
      lede="Bogey has no server to send anything to. This page explains what it keeps in your browser, how to check that nothing leaves it, and how to remove what it keeps."
    >
      <Section title="Nothing is sent">
        <p>
          Bogey is a set of static files: a web page, its scripts, and the fonts and image decoders
          the PDF viewer needs. Everything it does with a document, from reading it to filling it in
          and producing the signed copy, runs in this browser tab, and there is no server behind the
          site that could receive a document, a signature or anything you type. There are no
          accounts, cookies, analytics or advertising.
        </p>
        <p>
          The site is served with a Content Security Policy, a header that tells the browser what
          the page is allowed to do. Bogey’s policy lets the page load only its own files and
          connect only to its own address, and that address accepts nothing except requests to
          download those files; it keeps no record of them either, because its access logging is
          turned off. If the page’s scripts were ever changed to send your work somewhere, the
          browser would refuse to connect to any other address, and Bogey’s own address has nowhere
          to put what it receives.
        </p>
      </Section>

      <Section title="Checking it yourself">
        <p>You can watch what the page does with your browser’s developer tools.</p>
        <ol>
          <li>
            Open the developer tools: in Chrome or Edge, View › Developer › Developer Tools; in
            Firefox, Tools › Browser Tools › Web Developer Tools; in Safari, turn on “Show features
            for web developers” in Settings › Advanced, then choose Develop › Show Web Inspector.
          </li>
          <li>
            Choose the Network tab and reload the page. Select the first request, for the page
            itself, and look at its response headers. The Content-Security-Policy header includes{' '}
            <code>{"default-src 'none'"}</code>, <code>{"connect-src 'self'"}</code> and{' '}
            <code>{"form-action 'none'"}</code>, which together mean the page can fetch nothing from
            anywhere else and send nothing anywhere at all.
          </li>
          <li>
            Clear the list, then open a PDF, fill it in, sign it and download it. The only requests
            you will see are for Bogey’s own files, such as the fonts under <code>/pdfjs/</code>,
            and every one of them is a download (a GET), never an upload. After your first visit
            most of them are answered by the browser’s own copy, marked as coming from the service
            worker, and the download of your signed copy is made inside the page, so it appears as a{' '}
            <code>blob:</code> address, if at all.
          </li>
        </ol>
      </Section>

      <Section title="What is kept on this device">
        <p>
          So that a reload or a closed tab loses nothing, Bogey keeps your work in this browser’s
          own storage (IndexedDB), on this device and for this site only. Another site cannot read
          it, and neither can Bogey on another device or in another browser. It keeps:
        </p>
        <ul>
          <li>
            <strong>Documents</strong>: the file you opened, exactly as it was, with the values you
            typed into it, what you placed on its pages, the page and zoom you were at, and a small
            picture of its first page for the recent list. Bogey keeps the last{' '}
            {LIMITS.recentDocuments} documents and deletes any document you have not changed for{' '}
            {LIMITS.documentExpiryDays} days the next time it starts.
          </li>
          <li>
            <strong>Password-protected documents</strong>: the file stays protected by its own
            password, which Bogey never saves, so it asks for the password again after a reload.
            What you typed into such a document, and what you placed on it, is saved encrypted with
            a key made from that password (AES-256, with the key derived by 600,000 rounds of
            PBKDF2), so it cannot be read without the password either. No picture of its pages is
            kept.
          </li>
          <li>
            <strong>Signatures</strong> and <strong>initials</strong> you draw or upload, as images,
            until you delete them.
          </li>
          <li>
            <strong>Snippets</strong> and your <strong>settings</strong> (the date format and the
            size new text starts at), until you change or clear them.
          </li>
        </ul>
        <p>
          In a private window the browser either keeps nothing or discards it when the window
          closes; Bogey then works from memory and says so. On a shared or borrowed computer, clear
          everything when you are done.
        </p>
      </Section>

      <Section title="Clearing everything">
        <p>
          Clear everything deletes every document, signature, snippet and setting Bogey has kept in
          this browser, and then reloads the page. It cannot be undone, so download any signed
          copies you need first. If the browser does not confirm the deletion, Bogey says so and
          stops saving, rather than reporting success. The same button is always in the toolbar.
        </p>
        <div className={styles.action}>
          <ClearEverything />
        </div>
      </Section>

      <Section title="Offline use and updates">
        <p>
          On your first visit, a service worker (a small script the browser runs for this site)
          stores Bogey’s files in the browser, so later visits load from that copy and work without
          a connection. It stores the application only; your documents stay in the storage described
          above, and the service worker never reads them.
        </p>
        <p>
          When a new version is published, the browser fetches it on your next visit with a
          connection, and Bogey shows “A new version is ready. Reload to update.” Nothing changes
          until you choose Reload, and because your work is saved as you go, reloading loses
          nothing. If a published version ever had to be withdrawn, a replacement service worker
          would remove the stored copy the next time you visit.
        </p>
      </Section>
    </Page>
  );
}
