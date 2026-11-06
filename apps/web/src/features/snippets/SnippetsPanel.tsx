// The Snippets panel (N1–N4, M2, spec §10.4, §10.6, §13). In use, each snippet is a button that
// fills the target field or places a text overlay, with the fixed Today button first. Buttons call
// preventDefault on pointerdown so a click does not take focus from the field being filled, and
// the target line says what the next click will do. "Edit snippets" turns the list into inline
// label and value inputs that can be reordered with dnd-kit, by pointer or keyboard, and deleted.
import type { Snippet } from '@bogey/core';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from 'react';
import { SNIPPET_LIMITS } from '../../core-bridge/snippets.ts';
import { useDocumentStore } from '../../state/document.ts';
import { useEditsStore } from '../../state/edits.ts';
import { useSettingsStore } from '../../state/settings.ts';
import { useSnippetsStore } from '../../state/snippets.ts';
import { useViewStore } from '../../state/view.ts';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { messageFor } from '../../ui/messages.ts';
import { useToastStore } from '../../ui/Toast.tsx';
import { exportSnippets, importSummary, readSnippetFile, type ImportPlan } from './files.ts';
import { insertSnippet, targetField, targetLabel, todayText, type InsertResult } from './insert.ts';
import styles from './Snippets.module.css';

/** Keeps focus in the field being filled (spec §10.4). */
const keepFocus = (event: PointerEvent) => event.preventDefault();

export function SnippetsPanel() {
  const [editing, setEditing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<ImportPlan | null>(null);
  const items = useSnippetsStore((state) => state.items);
  const replaceAll = useSnippetsStore((state) => state.replaceAll);
  const fileInput = useRef<HTMLInputElement>(null);
  const showToast = useToastStore((state) => state.show);

  const finishImport = (plan: ImportPlan) => {
    setPending(null);
    void replaceAll(plan.next);
    showToast(importSummary(plan));
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProblem(null);
    const result = await readSnippetFile(file);
    if (!result.ok) {
      setProblem(messageFor(result.problem));
      return;
    }
    if (result.plan.overwritten.length > 0) setPending(result.plan);
    else finishImport(result.plan);
  };

  return (
    <div className={styles.panel}>
      {editing ? <EditList items={items} /> : <UseList items={items} onResult={setAnnouncement} />}
      <div className={styles.footer}>
        <Button onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit snippets'}</Button>
        <Button variant="quiet" onClick={() => exportSnippets(items)}>
          Export
        </Button>
        <Button variant="quiet" onClick={() => fileInput.current?.click()}>
          Import
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          tabIndex={-1}
          aria-hidden="true"
          data-testid="snippets-import-input"
          onChange={(event) => void onFile(event)}
        />
      </div>
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
      <span className="visually-hidden" aria-live="polite">
        {announcement}
      </span>
      <Dialog
        open={pending !== null}
        title="Overwrite snippets?"
        onClose={() => setPending(null)}
        actions={
          <>
            <Button onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => pending && finishImport(pending)}>
              Import
            </Button>
          </>
        }
      >
        {pending && <ImportDetails plan={pending} />}
      </Dialog>
    </div>
  );
}

function ImportDetails({ plan }: { plan: ImportPlan }) {
  return (
    <>
      <p>The file has new values for these snippets, and importing it replaces what you have:</p>
      <ul className={styles.overwrites}>
        {plan.overwritten.map((label, index) => (
          <li key={index}>{label}</li>
        ))}
      </ul>
      {plan.added > 0 && (
        <p>
          It also adds {plan.added} new {plan.added === 1 ? 'snippet' : 'snippets'}.
        </p>
      )}
    </>
  );
}

/** What a snippet button press did, for the live region. */
function describe(result: InsertResult, label: string): string {
  switch (result.kind) {
    case 'field':
      return `Filled ${result.label} with ${label}.`;
    case 'overlay':
      return `Placed ${label} on page ${result.page + 1}.`;
    case 'none':
      return '';
  }
}

/** The line that says where the next snippet goes (spec §10.4). */
function TargetLine() {
  const ready = useDocumentStore((state) => state.status === 'ready');
  // Subscribed so the line follows focus, the document and the last click.
  useViewStore((state) => state.targetField);
  useDocumentStore((state) => state.info);
  const clickedHere = useViewStore(
    (state) => state.lastPoint !== null && state.lastPoint.page === state.page,
  );
  const field = targetField();
  let text: string;
  if (!ready) text = 'Open a PDF to use your snippets.';
  else if (field) text = `Fills: ${targetLabel(field)}`;
  else if (clickedHere) text = 'Places text where you last clicked on the page.';
  else text = 'Places text near the top-left corner of the page. Click the page to choose a spot.';
  return (
    <p className={styles.target} data-testid="snippet-target">
      {text}
    </p>
  );
}

function UseList({ items, onResult }: { items: readonly Snippet[]; onResult(text: string): void }) {
  const ready = useDocumentStore((state) => state.status === 'ready');
  const dateFormat = useSettingsStore((state) => state.dateFormat);
  // Re-render after an insert, so a placed overlay's new lastPoint shows on the target line.
  useEditsStore((state) => state.present);
  const hintId = useId();
  const today = todayText();

  const use = (value: string, label: string, date = false) => {
    onResult(describe(insertSnippet(value, { date }), label));
  };

  return (
    <>
      <TargetLine />
      <ul className={styles.list} aria-label="Snippets">
        <li>
          <button
            type="button"
            className={styles.snippet}
            disabled={!ready}
            aria-labelledby={`${hintId}-today-label`}
            aria-describedby={`${hintId}-today`}
            onPointerDown={keepFocus}
            onClick={() => use(today, 'Today', true)}
          >
            <span id={`${hintId}-today-label`} className={styles.label}>
              Today
            </span>
            <span id={`${hintId}-today`} className={styles.value} data-format={dateFormat}>
              {today}
            </span>
          </button>
        </li>
        {items.map((item) => {
          const empty = item.value === '';
          const label = item.label.trim() || 'Untitled';
          return (
            <li key={item.id}>
              <button
                type="button"
                className={styles.snippet}
                disabled={!ready || empty}
                aria-labelledby={`${hintId}-${item.id}-label`}
                aria-describedby={`${hintId}-${item.id}`}
                onPointerDown={keepFocus}
                onClick={() => use(item.value, label)}
              >
                <span id={`${hintId}-${item.id}-label`} className={styles.label}>
                  {label}
                </span>
                <span id={`${hintId}-${item.id}`} className={styles.value}>
                  {empty ? 'Empty. Choose Edit snippets to fill it in.' : item.value}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {items.length === 0 && (
        <p className={styles.hint}>
          Choose Edit snippets to add the details you reuse, such as your name and address.
        </p>
      )}
    </>
  );
}

function EditList({ items }: { items: readonly Snippet[] }) {
  const reorder = useSnippetsStore((state) => state.reorder);
  const add = useSnippetsStore((state) => state.add);
  const [focusId, setFocusId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map((item) => item.id);
  const spoken = useMemo(() => announcements(items), [items]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    void reorder(arrayMove(ids, from, to));
  };

  return (
    <>
      <p className={styles.hint}>
        Changes are saved as you type. Drag the handle, or focus it and press Space, to move a
        snippet.
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: spoken,
          screenReaderInstructions: {
            draggable:
              'To move this snippet, press Space or Enter, use the up and down arrow keys to choose its new place, and press Space or Enter again to drop it. Press Escape to cancel.',
          },
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className={styles.editList} aria-label="Edit snippets">
            {items.map((item, index) => (
              <EditRow key={item.id} item={item} index={index} focus={item.id === focusId} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <Button
        disabled={items.length >= SNIPPET_LIMITS.maxSnippets}
        onClick={() => void add().then((snippet) => setFocusId(snippet.id))}
      >
        Add snippet
      </Button>
    </>
  );
}

/**
 * Screen reader announcements for reordering (spec §13). dnd-kit reports the row under the
 * snippet as soon as it is picked up, which is its own place; that is not announced, so it does
 * not replace "Picked up".
 */
export function announcements(items: readonly Snippet[]): Announcements {
  const n = items.length;
  let lastOver: UniqueIdentifier | null = null;
  const name = (id: UniqueIdentifier) =>
    items.find((item) => item.id === id)?.label.trim() || 'Untitled';
  const place = (id: UniqueIdentifier | undefined) =>
    id === undefined ? -1 : items.findIndex((item) => item.id === id) + 1;
  return {
    onDragStart: ({ active }) => {
      lastOver = active.id;
      return `Picked up ${name(active.id)}. It is in position ${place(active.id)} of ${n}.`;
    },
    onDragOver: ({ active, over }) => {
      if (!over || over.id === lastOver) return undefined;
      lastOver = over.id;
      return `${name(active.id)} moved to position ${place(over.id)} of ${n}.`;
    },
    onDragEnd: ({ active, over }) =>
      over
        ? `${name(active.id)} dropped in position ${place(over.id)} of ${n}.`
        : `${name(active.id)} dropped.`,
    onDragCancel: ({ active }) =>
      `Moving cancelled. ${name(active.id)} is back in position ${place(active.id)} of ${n}.`,
  };
}

function EditRow({ item, index, focus }: { item: Snippet; index: number; focus: boolean }) {
  const edit = useSnippetsStore((state) => state.edit);
  const remove = useSnippetsStore((state) => state.remove);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  const label = item.label.trim() || 'Untitled';
  const labelId = useId();
  const valueId = useId();
  const labelInput = useRef<HTMLInputElement>(null);
  // A snippet just added gets focus in its label, so it can be named at once.
  useEffect(() => {
    if (focus) labelInput.current?.focus();
  }, [focus]);

  return (
    <li
      ref={setNodeRef}
      className={styles.row}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={`Snippet ${index + 1}`}
      role="group"
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className={styles.handle}
        {...attributes}
        {...listeners}
        aria-label={`Move ${label}`}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <div className={styles.inputs}>
        <label htmlFor={labelId} className={styles.inputLabel}>
          Label
        </label>
        <input
          id={labelId}
          className={styles.input}
          value={item.label}
          maxLength={SNIPPET_LIMITS.maxLabel}
          ref={labelInput}
          onChange={(event) => void edit(item.id, { label: event.target.value })}
        />
        <label htmlFor={valueId} className={styles.inputLabel}>
          Value
        </label>
        <input
          id={valueId}
          className={styles.input}
          value={item.value}
          maxLength={SNIPPET_LIMITS.maxValue}
          onChange={(event) => void edit(item.id, { value: event.target.value })}
        />
      </div>
      <Button variant="quiet" aria-label={`Delete ${label}`} onClick={() => void remove(item.id)}>
        Delete
      </Button>
    </li>
  );
}
