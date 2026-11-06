// The Settings button and dialog (O3, O5, spec §10.6): the date format used by dates and the
// Today snippet, and the size new text starts at. Changes apply and are saved at once. Sprint 6
// supplies Clear everything, which stays beside it in the toolbar.
import type { DateFormat } from '@bogey/core';
import { useId, useState } from 'react';
import { DATE_FORMATS, TEXT } from '../../core-bridge/model.ts';
import { formatDate } from '../../core-bridge/text.ts';
import { isDateFormat, useSettingsStore } from '../../state/settings.ts';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { ClearEverything } from './ClearEverything.tsx';
import styles from './Settings.module.css';

const SIZES = Array.from({ length: TEXT.maxSize - TEXT.minSize + 1 }, (_, i) => TEXT.minSize + i);

/** Each format with today's date as its example, so the choice shows what it produces. */
export function formatExample(format: DateFormat, now: Date = new Date()): string {
  return formatDate({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() }, format);
}

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="quiet" onClick={() => setOpen(true)}>
        Settings
      </Button>
      <Dialog
        open={open}
        title="Settings"
        onClose={() => setOpen(false)}
        actions={<Button onClick={() => setOpen(false)}>Done</Button>}
      >
        <SettingsForm />
      </Dialog>
      <ClearEverything />
    </>
  );
}

function SettingsForm() {
  const dateFormat = useSettingsStore((state) => state.dateFormat);
  const size = useSettingsStore((state) => state.defaultFontSize);
  const change = useSettingsStore((state) => state.change);
  const dateId = useId();
  const sizeId = useId();

  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <label htmlFor={dateId}>Date format</label>
        <select
          id={dateId}
          className={styles.select}
          value={dateFormat}
          onChange={(event) => {
            if (isDateFormat(event.target.value)) void change({ dateFormat: event.target.value });
          }}
        >
          {DATE_FORMATS.map((format) => (
            <option key={format} value={format}>
              {formatExample(format)} ({format})
            </option>
          ))}
        </select>
        <p className={styles.hint}>Used by the Date tool and the Today snippet.</p>
      </div>
      <div className={styles.field}>
        <label htmlFor={sizeId}>Default text size</label>
        <select
          id={sizeId}
          className={styles.select}
          value={size}
          onChange={(event) => void change({ defaultFontSize: Number(event.target.value) })}
        >
          {SIZES.map((pt) => (
            <option key={pt} value={pt}>
              {pt} pt
            </option>
          ))}
        </select>
        <p className={styles.hint}>
          New text, dates and snippets start at this size. Text already on the page keeps its size.
        </p>
      </div>
    </div>
  );
}
