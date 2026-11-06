# iPad checklist

The manual checks for Bogey on a real iPad (Sprint 8, implementation plan; spec §7.2, §8.1, §10.3, §10.4, §10.5). Playwright covers what it can with the iPad Pro 11 descriptor in WebKit (`e2e/touch.spec.ts`): synthesized gesture events, synthesized touch drags, real touchscreen taps, handle sizes, canvas counts and caps, and the 800 px layout. It cannot tell whether iPadOS itself zooms the page, how a finger or the Pencil feels, whether Safari reloads a tab under memory pressure, or what the Files app does with a download. That is what this list is for.

Record the iPad model, iPadOS version and date at the top of your notes, and mark each item pass or fail. A failure goes to a `fix/…` branch with the item number in the commit message.

## Before you start

**Where to run it.** Use `https://bogey.beta-site.us` after the sprint is deployed. The plan said `pnpm preview` over the LAN would do for the gesture, memory and layout items because none of them needs a secure context, but that is not true: Bogey calls `crypto.randomUUID()` when it opens a document and when it places an overlay, and Safari only offers it on HTTPS or `localhost`. Over `http://<mac-ip>:<port>` the document will not open. Two ways round it before a deploy:

- The iOS Simulator (Xcode, an iPad Pro model) reaches the Mac's `localhost`, so `pnpm build && pnpm preview` works there. Option-drag pinches. It is fine for layout and gesture logic, but it is not a real device: memory, the Pencil and the Files app still need the iPad.
- Any HTTPS tunnel to the preview port. Don't use one that logs traffic; documents stay on the iPad, but the app bundle passes through it.

**Fixtures.** AirDrop these to the iPad and save them in Files (On My iPad):

- `fixtures/vendored/generated/flat-single.pdf`
- `fixtures/vendored/generated/acroform-all.pdf`
- `fixtures/vendored/generated/large-20p.pdf` (20 pages, 10 MB)
- `fixtures/vendored/generated/multipage-rotations.pdf`
- `fixtures/vendored/generated/acroform-all-aes256.pdf` (password `bogey`)

**Clean start.** Settings › Apps › Safari › Advanced › Website Data: remove `bogey.beta-site.us`. Close every other Safari tab.

## 1. Pinch and pan (V4)

Open `flat-single.pdf`. Set the zoom menu to 100%.

1.1. Pinch out on the page. The page grows under your fingers; the toolbar and panel stay the same size. When you lift your fingers the zoom menu shows the new value (for example 180%) and the page sharpens within a second.
1.2. The spot between your fingers when you started is still under your fingers after you lift them.
1.3. Pinch in hard. The zoom stops at 50%. Pinch out hard. It stops at 300%.
1.4. Pinch on the toolbar, on the thumbnail strip and on the panel. Nothing zooms, Bogey or Safari.
1.5. Double-tap the page. Safari does not zoom.
1.6. With one finger, pan the page in every direction at 300%. It scrolls, with momentum, and nothing is placed.
1.7. Pinch with two fingers and move them across the screen while pinching. The page follows; on release it stays roughly where your fingers left it.
1.8. On a Magic Keyboard trackpad, if you have one: pinch on the page. Same result as 1.1.
1.9. Rotate the iPad mid-document. The page refits (fit width or fit page) or keeps its numeric zoom.

## 2. Tap versus pan (spec §7.2)

2.1. Tap **Text**, then tap the page. A text box appears where you tapped and the on-screen keyboard opens. Type a name and press return.
2.2. Tap **Check**, then tap the page. A check mark appears and stays. (A tap used to be followed by a click that landed on the new overlay's Delete button; it must not delete the check.)
2.3. Tap **Date**, then pan the page with one finger instead of tapping. Nothing is placed and the Date tool stays selected. Now tap: today's date is placed.
2.4. With a placement tool selected, start a pinch. Nothing is placed, whichever finger lifts first.
2.5. With the Pencil, tap **Text** and tap the page. Placed, same as a finger. Hovering the Pencil (on models with hover) places nothing.
2.6. In select mode, tap a text field in `acroform-all.pdf`. The keyboard opens and you can type into it. Tap a checkbox field: it toggles. Fields still take taps with overlays on the page.

## 3. Handles (O7)

Place a text overlay and a signature (draw one first, section 4).

3.1. Drag the signature by its body with a finger. It moves and does not scroll the page.
3.2. Drag the round handle at its bottom-right with a finger. It resizes with its aspect ratio locked. The handle is easy to hit with a fingertip, and you do not hit the page by mistake.
3.3. Same with the Pencil.
3.4. Tap the × button on the frame with a finger. The overlay is deleted. Undo brings it back.
3.5. Resize a text overlay by its handle. The font size changes in whole points.

## 4. Pencil signature (G2, G3)

4.1. Signatures › Draw. Write a signature with the Pencil, pressing harder in places. The line is thicker where you pressed harder.
4.2. Rest your palm on the screen while writing. No stray marks, and the page behind the dialog does not scroll.
4.3. Draw with a finger. The line has an even width.
4.4. Save it, place it on the page with a tap, and export (section 6). The exported signature matches what you drew.

## 5. Memory (V6, spec §10.3)

Safari reloads a tab that uses too much memory and shows "This webpage was reloaded because a problem occurred". Any reload in this section is a failure; note the item and the page number.

5.1. Open `large-20p.pdf` at fit width. Page through all 20 pages with **Next** at about one page a second.
5.2. Set the zoom to 300%. Page through all 20 pages again. Each page is sharp within a couple of seconds of arriving.
5.3. At 300% on page 10, pinch in to 50% and out to 300% three times.
5.4. Open the thumbnail strip (the **Pages** button in portrait) and scroll it from page 1 to page 20 and back, then tap page 17.
5.5. Open `acroform-all.pdf`, `large-20p.pdf` and `multipage-rotations.pdf` one after another, twice over, without reloading.
5.6. Paging at 300%: a page you arrive at may look slightly soft for a moment (the neighbors are rendered at up to 2048 × 2048 pixels to save memory) and then sharpen. If it stays soft, or the soft moment is distracting, note it; the cap is `neighborCanvasPixels` in `apps/web/src/config.ts`.

## 6. Download to Files (P4, E1)

6.1. Fill `acroform-all.pdf`, add a text overlay and a signature, and tap **Export**. Safari asks to download the file; tap Download.
6.2. Open the Downloads list in Safari. The file is `acroform-all-signed.pdf`.
6.3. Open the Files app › On My iPad › Downloads (or wherever Safari › Downloads is set). The file is there and opens in Quick Look with every value, the text and the signature drawn on the page, and no editable fields left.
6.4. Export again. Safari saves a second file rather than replacing the first, or asks.

## 7. Backgrounding and restore (M1, D7, spec §10.5)

7.1. Fill several fields in `acroform-all.pdf`, go to page 2, set 150%. Switch to another app for two minutes and come back. Everything is as you left it.
7.2. Do the same, then lock the iPad for five minutes. Same result.
7.3. Fill a field, then within a second swipe Safari away in the app switcher. Reopen Safari and the site. The document reopens on the same page, at the same zoom, with the field filled and overlays in place.
7.4. Open `acroform-all-aes256.pdf` with password `bogey`, fill a field, and swipe Safari away. Reopen: Bogey asks for the password and then restores the edit. (Needs HTTPS; it will not work over the LAN.)
7.5. Open about fifteen other heavy tabs so Safari evicts Bogey's tab, then return to it. It reloads and restores the document with your edits.

## 8. Narrow layout (P3, spec §10.4)

Below 1024 CSS px wide the thumbnail strip becomes a **Pages** button and the panel opens over the page. An 11-inch iPad in portrait is 834 px wide; Split View and Slide Over are narrower.

8.1. iPad in portrait with a document open: the toolbar shows **Pages**; the panel starts closed.
8.2. Tap **Pages**. The strip slides over the left of the page. Tap a page: it shows that page and the strip closes.
8.3. Tap **Show panel**. The panel covers the right of the page, not squeezing it. **Hide panel** closes it.
8.4. Put Safari in Split View at half width, then a third, then Slide Over. Nothing is cut off so it can't be reached, the toolbar wraps, and there are no error messages.
8.5. Rotate to landscape (1194 px wide). The strip and panel sit beside the page again.

## What Playwright already covers

So you need not repeat it with any care: the gesture events are cancelled and the zoom commits at 50–300% with the content anchored (synthesized in WebKit, real two-finger touch in Chromium); a synthesized one-finger drag places nothing and a real tap places; the handle and Delete hit areas are at least 44 × 44 px under `(pointer: coarse)`; at 300% on the 20-page fixture no more than three page canvases hold pixels, the current one within 16,777,216 and the neighbors within 4,194,304; and the 800 px layout renders in all three engines without errors.
