# Manual acceptance

The checks for v1.0.0 that automation cannot make (implementation plan, Sprint 10; requirements §15; spec §13). `e2e/acceptance.spec.ts` runs the five acceptance tests as far as a browser under Playwright can, in Chromium, Firefox and WebKit, and `e2e/a11y.spec.ts` runs axe on every screen and dialog. What is left is a person with a Mac, an iPad, Preview, Acrobat Reader and VoiceOver.

Run everything against `https://bogey.beta-site.us` after the Sprint 10 deploy. Fill in the date and result columns as you go (pass, or fail with a note). A failure goes to a `fix/…` branch with the step number in the commit message. When every row passes on both devices, tag `v1.0.0` and add the dates and browser versions to the 1.0.0 entry in `CHANGELOG.md`.

**Fixtures.** From `fixtures/vendored/generated/`: `acroform-all-aes256.pdf` (password `bogey`), `large-20p.pdf` and `flat-single.pdf`. On the iPad, AirDrop them to Files › On My iPad. For step 2, also use a real scanned form, and for the review, a real form that arrived by email.

**Record.**

| Device | Model | OS version | Browser and version | Date |
| --- | --- | --- | --- | --- |
| Mac | | | | |
| iPad | | | | |

## 1. Mac

Use Safari, then repeat steps 1.1 to 1.7 in Chrome. Start from a clean site: Clear everything on the Privacy page.

| # | Step | Expected | Date | Result |
| --- | --- | --- | --- | --- |
| 1.1 | Open `acroform-all-aes256.pdf`, give the password `bogey`. Fill every field: text1, multiline1 (two lines), comb1, check1, a radio button, dropdown1, two entries in list1. Draw a signature with the trackpad, place it, and download. | The dialog says the copy will not be password-protected. `acroform-all-aes256-signed.pdf` downloads. | | |
| 1.2 | Open the download in Preview. | No password prompt. Every value, the check, the radio button, the two list entries and the signature are drawn; clicking any of them edits nothing. Tools › Annotate shows no form fields. | | |
| 1.3 | Open the same download in Acrobat Reader. | Same as 1.2. Reader shows no form bar ("This document contains interactive form fields" does not appear) and no script warnings. | | |
| 1.4 | Open a real scanned form. Place text, a check, a date and a signature from the library in boxes on the scan, download, and open the copy in Preview at 400%. | Each item sits where it was on screen, within about a third of a millimeter (1 pt). | | |
| 1.5 | Fill a field and place text in any document, then quit the browser within a second. Reopen it and the site. | The document reopens on the same page and zoom, with the value and the text. | | |
| 1.6 | Developer tools › Network, with the log preserved. Reload, then open, fill, sign and download a document. | After the page's own files, nothing but `blob:` downloads appear, and every request is a GET to `bogey.beta-site.us`, most served by the service worker. | | |
| 1.7 | Turn Wi-Fi off. Reload the site and repeat 1.1 with `flat-single.pdf`. | Everything works, and the download opens in Preview. | | |
| 1.8 | With snippets filled in and a saved signature, time the second form: open `acroform-all.pdf`, fill three fields from snippets, place Today and the signature, download. | Under one minute from opening the file to the finished download. | | |
| 1.9 | E7 on the reference laptop: open `large-20p.pdf`, press Download, and time it from the click to the file. | Under 5 seconds. | | |

## 2. iPad

Use Safari on iPadOS with an Apple Pencil. Clean start: Settings › Apps › Safari › Advanced › Website Data, remove `bogey.beta-site.us`.

| # | Step | Expected | Date | Result |
| --- | --- | --- | --- | --- |
| 2.1 | Open `acroform-all-aes256.pdf` from Files with the password `bogey`. Fill every field type. Draw a signature with the Pencil, pressing harder in places, place it, and download to Files. | The line is thicker where you pressed harder. The file is saved in Files › Downloads. | | |
| 2.2 | Open the download in Files (Quick Look), then in Acrobat Reader for iPad if installed. | Every value and the signature are drawn, with no editable fields and no password prompt. | | |
| 2.3 | Open a real scanned form from Files. Place text, a check, a date and a saved signature by tapping, download, and compare the copy with the screen at high zoom. | Each item is where it was on screen. | | |
| 2.4 | Fill a field, then swipe Safari away in the app switcher. Reopen Safari and the site. | The document, values and overlays are back. | | |
| 2.5 | Load the site once with a connection, then turn on airplane mode. Open a PDF from Files, fill it, sign it and download it. | Everything works offline, and the copy is in Files. | | |
| 2.6 | The second form, as in 1.8, with a real form that arrived by email. | Under one minute. | | |
| 2.7 | `docs/ipad-checklist.md`, every section. | Every item passes. | | |

## 3. VoiceOver on macOS

Turn VoiceOver on with ⌘F5 and use Safari. VO is Control+Option.

| # | Step | Expected | Date | Result |
| --- | --- | --- | --- | --- |
| 3.1 | Load the empty app. Open the rotor (VO+U) and look at Landmarks and Headings. | The toolbar, the Information navigation, the main area and the side panel are listed; the empty state's headings read in order. | | |
| 3.2 | Tab to Open PDF and open `acroform-all.pdf`. | The page is announced as "Page 1 of 1". | | |
| 3.3 | Tab through the fields. | Each is read with its name and type (for example "text1, edit text"); the checkbox and radio buttons announce their state; Tab moves in the form's order. | | |
| 3.4 | Press T. | "Text tool" is announced, then the "Place text here" button. Enter opens a text box; type and press Enter. The new overlay is read as "Text overlay: …, page 1". | | |
| 3.5 | Press the arrow keys, then Delete. | The overlay moves; after Delete, "Overlay deleted" is announced and focus is on the Select tool. | | |
| 3.6 | Press ⌘Z. | "Undone" is announced and the overlay is back. | | |
| 3.7 | Open each dialog: Shortcuts, Settings, Clear everything, Signatures › Draw, Signatures › Upload, and Download for the password-protected fixture. | Focus moves into the dialog and its title is read; Tab stays inside it; Escape closes it and focus returns to the button that opened it. The draw pad's text alternative says that drawing needs a pointer and that uploading is the keyboard path. | | |
| 3.8 | Snippets tab: Edit snippets, then move a snippet with its handle (Space, arrows, Space). | Pick-up, each move and the drop are announced with positions. | | |
| 3.9 | Snippets tab: a snippet button with a field focused. | The button is read with its label, then its value as the description, and the target line names the field. | | |
| 3.10 | Open Help, About and Privacy from the Information navigation. | Focus lands on each page's heading; the headings are listed in the rotor; "Back to your document" returns. | | |

## 4. VoiceOver on iPadOS

Settings › Accessibility › VoiceOver on, or triple-click the top button if the shortcut is set. Swipe right to move, double-tap to activate.

| # | Step | Expected | Date | Result |
| --- | --- | --- | --- | --- |
| 4.1 | Swipe through the toolbar of the empty app. | Every button is read by name, in order. | | |
| 4.2 | Open `acroform-all.pdf` from Files. Swipe to text1 and double-tap. | The on-screen keyboard opens; typing fills the field. | | |
| 4.3 | Swipe to check1 and double-tap; then to dropdown1 and double-tap. | The checkbox state is read after the change; the system picker opens for the dropdown. | | |
| 4.4 | Choose the Text tool, swipe to "Place text here" and double-tap. | A text box opens; the typed text becomes "Text overlay: …, page 1". | | |
| 4.5 | Open Settings and Clear everything, and close each. | Focus stays inside each dialog and returns after it closes. | | |
| 4.6 | Open the Privacy page. | The headings and the Clear everything button are reachable by swiping. | | |

## 5. Other browsers, if available

| # | Step | Expected | Date | Result |
| --- | --- | --- | --- | --- |
| 5.1 | Edge on Windows: steps 1.1, 1.5 and 1.7. | As on the Mac. | | |
| 5.2 | Firefox on Linux: steps 1.1, 1.5 and 1.7. | As on the Mac. | | |
