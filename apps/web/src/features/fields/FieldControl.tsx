// One native control per widget (F1–F5, F8, U4, spec §7.1). Values come from the edits store as
// `override ?? initial`; every change is a `setField` edit. Typing coalesces per field until blur
// (spec §7.4), when the run is sealed.
import type { CSSProperties, ChangeEvent } from 'react';
import type { FieldDescriptor, FieldValue } from '@bogey/core';
import { useEditsStore } from '../../state/edits.ts';
import { useViewStore } from '../../state/view.ts';
import {
  asChecked,
  asList,
  asText,
  combCell,
  controlId,
  fieldLabel,
  fontSizePx,
  isFillable,
  isTextTarget,
  selectOptions,
  widgetOnValue,
  type ControlBox,
  type PlacedWidget,
} from './model.ts';
import styles from './FieldLayer.module.css';

export interface FieldControlProps {
  placed: PlacedWidget;
  box: ControlBox;
  value: FieldValue | undefined;
}

function setField(name: string, value: FieldValue, coalesce: boolean) {
  useEditsStore
    .getState()
    .edit({ type: 'setField', name, value }, coalesce ? { coalesceKey: name } : undefined);
}

export function FieldControl({ placed, box, value }: FieldControlProps) {
  const { field } = placed;
  const id = controlId(placed.fieldIndex, placed.widgetIndex);
  const position: CSSProperties = {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    ...(box.rotation !== 0 ? { transform: `rotate(${box.rotation}deg)` } : {}),
  };

  if (!isFillable(field)) {
    const what = field.kind === 'signature' ? 'Signature field' : 'Button';
    return (
      <div className={styles.widget} style={position}>
        <div
          id={id}
          role="img"
          className={styles.outline}
          aria-label={`${what}: ${fieldLabel(field)}. Bogey does not fill this kind of field.`}
        />
      </div>
    );
  }

  return (
    <div className={styles.widget} style={position} data-kind={field.kind}>
      <Control id={id} placed={placed} box={box} value={value} />
    </div>
  );
}

function Control({ id, placed, box, value }: FieldControlProps & { id: string }) {
  const { field } = placed;
  const label = fieldLabel(field);
  const setTarget = useViewStore((state) => state.setTargetField);
  const onFocus = () => setTarget(isTextTarget(field) ? field.name : null);
  const common = {
    id,
    'data-field-control': '',
    'aria-label': label,
    'aria-required': field.required || undefined,
    onFocus,
  };
  const className = (...names: (string | false | undefined)[]) =>
    [styles.control, ...names, field.readOnly && styles.readonly].filter(Boolean).join(' ');

  switch (field.kind) {
    case 'checkbox':
      return (
        <input
          {...common}
          type="checkbox"
          className={styles.check}
          checked={asChecked(value)}
          disabled={field.readOnly}
          onChange={(e) => setField(field.name, e.target.checked, false)}
        />
      );
    case 'radio': {
      const onValue = widgetOnValue(field, placed);
      return (
        <input
          {...common}
          aria-label={`${label}: ${onValue}`}
          type="radio"
          name={field.name}
          value={onValue}
          className={styles.check}
          checked={onValue !== '' && asText(value) === onValue}
          disabled={field.readOnly}
          onChange={() => setField(field.name, onValue, false)}
        />
      );
    }
    case 'dropdown':
      if (field.editable) return <ComboBox {...common} field={field} box={box} value={value} />;
      return (
        <select
          {...common}
          className={className(styles.select)}
          style={{ fontSize: fontSizePx(field, asText(value), box) }}
          value={asText(value)}
          disabled={field.readOnly}
          onChange={(e) => setField(field.name, e.target.value, false)}
        >
          {selectOptions(field, [asText(value)], true).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'list': {
      const selected = asList(value);
      const options = selectOptions(field, selected, false);
      const multiple = field.multiSelect === true;
      return (
        <select
          {...common}
          className={className(styles.list)}
          style={{
            // pdf-lib sizes an auto list so every option fits, one per line.
            fontSize: fontSizePx(
              { ...field, multiline: true },
              options.map((o) => o.label).join('\n'),
              box,
            ),
          }}
          multiple={multiple}
          size={Math.max(2, options.length)}
          value={multiple ? [...selected] : (selected[0] ?? '')}
          disabled={field.readOnly}
          onChange={(e) =>
            setField(
              field.name,
              [...e.target.selectedOptions].map((o) => o.value),
              false,
            )
          }
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    default:
      return (
        <TextControl {...common} field={field} box={box} value={value} className={className} />
      );
  }
}

interface TextProps {
  id: string;
  field: FieldDescriptor;
  box: ControlBox;
  value: FieldValue | undefined;
  onFocus(): void;
  className(...names: (string | false | undefined)[]): string;
}

function TextControl({ field, box, value, className, ...common }: TextProps) {
  const text = asText(value);
  const seal = useEditsStore((state) => state.seal);
  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setField(field.name, e.target.value, true);
  const cell = combCell(field, box.width);
  const style: CSSProperties & { '--cell'?: string } = {
    fontSize: fontSizePx(field, text, box),
    ...(cell !== null ? { '--cell': `${cell}px` } : {}),
  };
  const shared = {
    ...common,
    value: text,
    style,
    readOnly: field.readOnly,
    onChange,
    onBlur: seal,
    ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
  };
  if (field.multiline) {
    return (
      <textarea {...shared} className={className(styles.multiline, styles[field.textAlign])} />
    );
  }
  return (
    <input
      {...shared}
      type={field.password ? 'password' : 'text'}
      autoComplete="off"
      spellCheck={false}
      className={className(cell !== null ? styles.comb : styles[field.textAlign])}
    />
  );
}

interface ComboProps {
  id: string;
  field: FieldDescriptor;
  box: ControlBox;
  value: FieldValue | undefined;
  onFocus(): void;
}

/** An editable combo box: a text input with the options as suggestions (spec §7.1). */
function ComboBox({ field, box, value, ...common }: ComboProps) {
  const seal = useEditsStore((state) => state.seal);
  const listId = `${common.id}-options`;
  const text = asText(value);
  return (
    <>
      <input
        {...common}
        type="text"
        list={listId}
        autoComplete="off"
        className={[styles.control, field.readOnly && styles.readonly].filter(Boolean).join(' ')}
        style={{ fontSize: fontSizePx(field, text, box) }}
        value={text}
        readOnly={field.readOnly}
        onChange={(e) => setField(field.name, e.target.value, true)}
        onBlur={seal}
      />
      <datalist id={listId}>
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </datalist>
    </>
  );
}
