// Help (U2, U5, spec §10.4): how to open, fill, place, sign, use snippets, download, work on the
// iPad and work offline, with the keyboard shortcuts from the help dialog's own list.
import { LIMITS } from '../../config.ts';
import { ShortcutList } from '../help/ShortcutsHelp.tsx';
import { isApple } from '../help/shortcuts.ts';
import { Page, Section } from './Page.tsx';

export function HelpPage() {
  return (
    <Page
      title="Help"
      lede="How to open a PDF, fill it in, sign it and download the signed copy, on a computer or an iPad, with or without a connection."
    >
      <Section title="Opening a document">
        <p>
          Drop a PDF onto the page, or choose <strong>Open PDF</strong> and pick one. Bogey takes
          files up to {LIMITS.maxFileBytes / (1024 * 1024)} MB and{' '}
          {LIMITS.maxPages.toLocaleString()} pages. If the file is password-protected, Bogey asks
          for the password before it shows anything; the password is used to open the file and is
          never saved.
        </p>
        <p>
          Bogey keeps what you open in this browser, so the last {LIMITS.recentDocuments} documents
          appear under <strong>Recent documents</strong> whenever no document is open, and reloading
          the page brings back the one you were working on. <strong>Close PDF</strong> returns to
          that list. The Privacy page explains what is kept and for how long.
        </p>
        <p>
          Some government forms are Adobe XFA forms, which only Adobe Acrobat and Adobe Reader can
          fill. Bogey says so when it opens one. Where the form also carries ordinary PDF fields,
          Bogey fills those; where it does not, you can still type over the page and sign it.
        </p>
      </Section>

      <Section title="Filling form fields">
        <p>
          When a PDF has form fields, Bogey draws its own text boxes, checkboxes, buttons and lists
          over them, and you fill them in as you would any web form. Tab and Shift+Tab move through
          the fields in the order the form was built, onto the next or previous page when you reach
          the end of one. The <strong>Fields</strong> tab in the panel on the right lists every
          field with its value; filter it by name, and choose a field to go straight to it.
        </p>
      </Section>

      <Section title="Text, checks and dates">
        <p>
          On a page with no fields, or anywhere a form has no field for what you need to write, use
          the tools in the toolbar. Choose <strong>Text</strong>, <strong>Check</strong> or{' '}
          <strong>Date</strong> (or press T, C or D), then click the page where it should go. Text
          starts where you click and opens for typing; press Enter to finish and Shift+Enter for a
          new line. A check mark is centered on the click, and a date places today’s date in the
          format chosen in Settings.
        </p>
        <p>
          Click anything you have placed to select it. Drag it to move it, drag the round handle at
          its corner to change its size, and use the toolbar to change the text size, make text
          bold, or switch a check mark to an X. The arrow keys move a selected item by one point, or
          ten with Shift, and Delete removes it. Undo and Redo cover the last {LIMITS.undoSteps}{' '}
          changes made since the page was loaded.
        </p>
        <p>
          Without a mouse, choosing a tool puts a marker on the page, at the last place you clicked
          or near the top-left corner, and pressing Enter places the item there. From there the
          arrow keys move it into position.
        </p>
      </Section>

      <Section title="Signatures">
        <p>
          The <strong>Signatures</strong> tab keeps a library of signatures and initials.{' '}
          <strong>Draw</strong> opens a pad to sign with a mouse, a finger or an Apple Pencil; the
          Pencil’s pressure changes the width of the line, as it would with a pen.{' '}
          <strong>Upload</strong> takes a photo or scan of a signature on white paper and removes
          the paper, and its slider sets how dark a mark has to be to count as ink. Drawing needs a
          pointer, so from the keyboard, upload an image instead.
        </p>
        <p>
          To sign, choose a signature in the library and click the page; it is placed 150 points
          wide, centered on the click, and can be moved and resized like anything else. Press S to
          place the last signature you used again.
        </p>
      </Section>

      <Section title="Snippets">
        <p>
          Snippets are the details you type on every form: your name, address, phone number and
          email. Fill them in once with <strong>Edit snippets</strong> on the{' '}
          <strong>Snippets</strong> tab. After that, click into a form field and choose a snippet to
          fill the field with it; the line at the top of the tab names the field it will fill. With
          no field chosen, a snippet becomes text on the page where you last clicked.{' '}
          <strong>Today</strong> works the same way with today’s date.
        </p>
        <p>
          <strong>Export</strong> saves your snippets to a file, and <strong>Import</strong> reads
          one back, on this device or another; Bogey asks before replacing any snippet that already
          has a value.
        </p>
      </Section>

      <Section title="Downloading the signed copy">
        <p>
          <strong>Download</strong> (or {isApple() ? '⌘' : 'Ctrl'}+S) produces a new PDF with
          everything you filled in and placed drawn onto the pages, and saves it with “-signed”
          added to the file name. The form fields are flattened into the page, so the copy cannot be
          changed by whoever receives it, and any scripts in the original are left out. The file you
          opened is never changed, and you can download again as often as you like.
        </p>
        <p>
          A few things make Bogey ask before it downloads. Text in a character the standard PDF font
          cannot draw, such as an arrow or a letter from a non-Latin alphabet, is listed so you can
          let Bogey replace it with a question mark or go back and change it. A password-protected
          original produces a copy without a password. In the rare case that Bogey can show a
          protected file but cannot read its contents, the copy is made from pictures of the pages,
          which look the same but have no selectable text.
        </p>
      </Section>

      <Section title="Using an iPad">
        <p>
          Open a PDF from Files with <strong>Open PDF</strong>. Pinch to zoom the page, and pan with
          one finger; a tap with a tool selected places the item, and a pan never does. In portrait,{' '}
          <strong>Pages</strong> shows the page thumbnails and <strong>Show panel</strong> opens the
          panel over the page. When you download, Safari asks where to save the copy and puts it in
          Files, in Downloads unless you have chosen another folder.
        </p>
      </Section>

      <Section title="Working offline">
        <p>
          After your first visit, Bogey keeps its own files in this browser and works without a
          connection, so you can open, fill, sign and download in airplane mode. When a new version
          is published, Bogey fetches it the next time you visit with a connection and offers to
          reload; your work is saved, so reloading loses nothing. One limit: the fonts for Chinese,
          Japanese and Korean text are fetched the first time a document needs them, so such a
          document opened offline for the first time may show some characters as blanks.
        </p>
      </Section>

      <Section title="Keyboard shortcuts">
        <p>
          The <strong>Shortcuts</strong> button, or the ? key, shows this list over the page.
        </p>
        <ShortcutList apple={isApple()} />
      </Section>
    </Page>
  );
}
