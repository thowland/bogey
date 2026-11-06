// The field layer, Fields panel and document notices (F1–F8, D4, U4) against a synthetic form.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PdfInfo } from '@bogey/core';
import { describe, expect, it } from 'vitest';
import { DocumentNotices, FieldLayer, FieldsPanel } from '../src/features/fields/index.ts';
import { applyFocus, requestFocus, takeFocusRequest } from '../src/features/fields/focus.ts';
import { NO_FIELDS_TEXT } from '../src/features/fields/FieldsPanel.tsx';
import { useDocumentStore } from '../src/state/document.ts';
import { useEditsStore } from '../src/state/edits.ts';
import { useViewStore } from '../src/state/view.ts';
import { NOTICES } from '../src/ui/messages.ts';
import { fieldsInfo } from './fieldsInfo.ts';

function open(info: PdfInfo = fieldsInfo(), page = 0, zoom: number | null = 1) {
  useDocumentStore.getState().update({ status: 'ready', id: 'doc', info });
  useEditsStore.getState().load({ fieldValues: {}, overlays: [] }, info);
  useViewStore.getState().setPage(page);
  useViewStore.getState().setRenderedZoom(zoom);
}

/** The layer inside a stand-in for the page sheet, as PageView mounts it. */
function renderLayer() {
  return render(
    <div data-testid="sheet">
      <span data-testid="canvas" />
      <FieldLayer />
    </div>,
  );
}

const values = () => useEditsStore.getState().present.fieldValues;

describe('the field layer (F1, F2, F8, U4)', () => {
  it('renders a native control per widget, named by /TU or the partial name', () => {
    open();
    renderLayer();
    expect(screen.getByRole('group', { name: 'Form fields on page 1' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveAttribute(
      'aria-required',
      'true',
    );
    expect(screen.getByRole('textbox', { name: 'notes' }).tagName).toBe('TEXTAREA');
    expect(screen.getByRole('textbox', { name: 'ssn' })).toHaveAttribute('maxlength', '9');
    expect(screen.getByLabelText('pin')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('checkbox', { name: 'agree' })).not.toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'size: L' })).toHaveAttribute('name', 'form.size');
    expect(screen.getByRole('combobox', { name: 'colour' }).tagName).toBe('SELECT');
    expect(screen.getByRole('combobox', { name: 'city' })).toHaveAttribute(
      'list',
      'field-7-0-options',
    );
    expect(screen.getByRole('listbox', { name: 'days' })).toHaveAttribute('multiple');
    // Read-only fields show their values and cannot change (F8).
    const fixed = screen.getByRole('textbox', { name: 'fixed' });
    expect(fixed).toHaveValue('Fixed value');
    expect(fixed).toHaveAttribute('readonly');
    expect(screen.getByRole('checkbox', { name: 'locked' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'locked' })).toBeChecked();
    // Signature and button fields are outlines, not controls (F1).
    const outline = screen.getByRole('img', { name: /^Signature field: sign\./ });
    expect(outline).not.toHaveAttribute('tabindex');
    // Fields on other pages are not mounted.
    expect(screen.queryByRole('textbox', { name: 'city2' })).toBeNull();
  });

  it('positions and sizes controls from the widget rectangle at the rendered zoom', () => {
    open(fieldsInfo(), 0, 1.5);
    renderLayer();
    const k = 1.5 * (96 / 72);
    const holder = screen.getByRole('textbox', { name: 'Your name' }).parentElement!;
    expect(parseFloat(holder.style.left)).toBeCloseTo(100 * k);
    expect(parseFloat(holder.style.top)).toBeCloseTo(72 * k);
    expect(parseFloat(holder.style.width)).toBeCloseTo(200 * k);
    expect(holder.style.transform).toBe('');
    expect(
      parseFloat(screen.getByRole('textbox', { name: 'Your name' }).style.fontSize),
    ).toBeCloseTo(12 * k);
    // Comb cells: the control width over maxLength.
    const comb = screen.getByRole('textbox', { name: 'ssn' });
    expect(parseFloat(comb.style.getPropertyValue('--cell'))).toBeCloseTo((180 * k) / 9);
  });

  it('rotates a widget by its net rotation (spec §5.4)', () => {
    const info = fieldsInfo();
    const turned = {
      ...info.fields[0]!,
      widgets: [{ page: 0, rect: [100, 500, 120, 700], mkRotation: 90 }],
    } as PdfInfo['fields'][number];
    open({ ...info, fields: [turned] });
    renderLayer();
    expect(screen.getByRole('textbox', { name: 'Your name' }).parentElement!.style.transform).toBe(
      'rotate(270deg)',
    );
  });

  it('drops a snippet target that belongs to another document', () => {
    useViewStore.getState().setTargetField('elsewhere.name');
    open();
    renderLayer();
    expect(useViewStore.getState().targetField).toBeNull();
    act(() => useViewStore.getState().setTargetField('form.name'));
    expect(useViewStore.getState().targetField).toBe('form.name');
  });

  it('draws nothing without page geometry', () => {
    open({ ...fieldsInfo(), pages: undefined } as unknown as PdfInfo);
    renderLayer();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('draws nothing until the page has a zoom, or when the page has no fields', () => {
    open(fieldsInfo(), 0, null);
    const { unmount } = renderLayer();
    expect(screen.queryByRole('group')).toBeNull();
    unmount();
    open(fieldsInfo({ fields: [] }), 0, 1);
    renderLayer();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('shows the user’s overrides over the document’s values', () => {
    open();
    act(() => useEditsStore.getState().edit({ type: 'setField', name: 'form.name', value: 'Ann' }));
    renderLayer();
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveValue('Ann');
  });
});

describe('editing fields (F3, F5, O8)', () => {
  it('types into a text field as one undo step per focus session', async () => {
    const user = userEvent.setup();
    open();
    renderLayer();
    const name = screen.getByRole('textbox', { name: 'Your name' });
    await user.type(name, 'Ann');
    expect(values()['form.name']).toBe('Ann');
    await user.tab();
    await user.click(name);
    await user.type(name, 'e');
    expect(values()['form.name']).toBe('Anne');
    act(() => useEditsStore.getState().undo());
    expect(name).toHaveValue('Ann');
    act(() => useEditsStore.getState().undo());
    expect(name).toHaveValue('');
    expect(useEditsStore.getState().canUndo).toBe(false);
  });

  it('sets checkbox, radio, dropdown, combo and list values', async () => {
    const user = userEvent.setup();
    open();
    renderLayer();
    await user.click(screen.getByRole('checkbox', { name: 'agree' }));
    expect(values()['form.agree']).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'size: L' }));
    expect(values()['form.size']).toBe('L');
    expect(screen.getByRole('radio', { name: 'size: L' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'size: S' })).not.toBeChecked();
    await user.selectOptions(screen.getByRole('combobox', { name: 'colour' }), 'Green');
    expect(values()['form.colour']).toBe('g');
    await user.type(screen.getByRole('combobox', { name: 'city' }), 'Lowell');
    expect(values()['form.city']).toBe('Lowell');
    await user.selectOptions(screen.getByRole('listbox', { name: 'days' }), ['mon', 'tue']);
    expect(values()['form.days']).toEqual(['mon', 'tue']);
    await user.click(screen.getByRole('checkbox', { name: 'agree' }));
    expect(values()['form.agree']).toBe(false);
  });

  it('edits a single-select list on the second page', async () => {
    const user = userEvent.setup();
    open(fieldsInfo(), 1);
    renderLayer();
    const list = screen.getByRole('listbox', { name: 'single' });
    expect(list).not.toHaveAttribute('multiple');
    await user.selectOptions(list, 'b');
    expect(values()['form.single']).toEqual(['b']);
  });

  it('ignores edits to read-only fields', () => {
    open();
    renderLayer();
    fireEvent.change(screen.getByRole('textbox', { name: 'fixed' }), { target: { value: 'x' } });
    expect(values()).toEqual({});
  });
});

describe('the snippet target (N2)', () => {
  it('names the last focused text field until the page is clicked elsewhere', async () => {
    const user = userEvent.setup();
    open();
    renderLayer();
    const target = () => useViewStore.getState().targetField;
    await user.click(screen.getByRole('textbox', { name: 'Your name' }));
    expect(target()).toBe('form.name');
    // Focus moving out of the page (to a snippet button, say) keeps the target.
    act(() => screen.getByRole('textbox', { name: 'Your name' }).blur());
    expect(target()).toBe('form.name');
    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'notes' }));
    expect(target()).toBe('form.name');
    fireEvent.pointerDown(screen.getByTestId('canvas'));
    expect(target()).toBeNull();
    await user.click(screen.getByRole('textbox', { name: 'ssn' }));
    expect(target()).toBe('form.ssn');
    await user.click(screen.getByRole('checkbox', { name: 'agree' }));
    expect(target()).toBeNull();
    await user.click(screen.getByRole('textbox', { name: 'fixed' }));
    expect(target()).toBeNull();
  });
});

describe('tab order across pages (F6)', () => {
  it('turns to the next page with fields after the last control, and back', async () => {
    const user = userEvent.setup();
    open();
    renderLayer();
    const fixed = screen.getByRole('textbox', { name: 'fixed' });
    // A Tab from a control that is not the last stays on the page.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your name' }), { key: 'Tab' });
    expect(useViewStore.getState().page).toBe(0);
    fireEvent.keyDown(fixed, { key: 'Tab', ctrlKey: true });
    expect(useViewStore.getState().page).toBe(0);
    fireEvent.keyDown(fixed, { key: 'Enter' });
    expect(useViewStore.getState().page).toBe(0);

    fireEvent.keyDown(fixed, { key: 'Tab' });
    expect(useViewStore.getState().page).toBe(1);
    expect(screen.getByRole('textbox', { name: 'city2' })).toHaveFocus();

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(useViewStore.getState().page).toBe(0);
    expect(screen.getByRole('textbox', { name: 'fixed' })).toHaveFocus();
  });

  it('leaves Tab to the browser on the last page and before the first page', () => {
    open(fieldsInfo(), 1);
    renderLayer();
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'single' }), { key: 'Tab' });
    expect(useViewStore.getState().page).toBe(1);
    act(() => useViewStore.getState().setPage(0));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your name' }), {
      key: 'Tab',
      shiftKey: true,
    });
    expect(useViewStore.getState().page).toBe(0);
  });

  it('treats a radio group at the end of the page as the last tab stop', () => {
    const info = fieldsInfo();
    const size = info.fields.find((f) => f.name === 'form.size')!;
    const city2 = info.fields.find((f) => f.name === 'form.city2')!;
    open({ ...info, fields: [size, city2] });
    renderLayer();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'size: S' }), { key: 'Tab' });
    expect(useViewStore.getState().page).toBe(1);
  });

  it('honors a focus request once, for its own page only', () => {
    requestFocus(2, 'first');
    expect(takeFocusRequest(1)).toBeNull();
    expect(takeFocusRequest(2)).toBe('first');
    expect(takeFocusRequest(2)).toBeNull();
    const root = document.createElement('div');
    expect(applyFocus(root, 'last')).toBe(false);
    expect(applyFocus(root, { id: 'missing' })).toBe(false);
  });
});

describe('the Fields panel (F7)', () => {
  it('says so when the document has no fields', () => {
    render(<FieldsPanel />);
    expect(screen.getByText(NO_FIELDS_TEXT)).toBeInTheDocument();
  });

  it('lists every field with its value and filters by name', async () => {
    const user = userEvent.setup();
    open();
    act(() => useEditsStore.getState().edit({ type: 'setField', name: 'form.agree', value: true }));
    render(<FieldsPanel />);
    const list = screen.getByRole('list', { name: 'Fields' });
    expect(within(list).getAllByRole('button')).toHaveLength(14);
    expect(screen.getByText('14 fields')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'agree, Checkbox, page 1: Checked' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'fixed, Text, page 1: Fixed value' }),
    ).toHaveAttribute('title', 'form.fixed');
    await user.type(screen.getByRole('searchbox', { name: 'Filter fields by name' }), 'city');
    expect(screen.getByText('2 of 14 fields')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No field names match that filter.')).toBeInTheDocument();
  });

  it('turns to a field’s page and focuses it, or focuses it in place', async () => {
    const user = userEvent.setup();
    open();
    render(
      <>
        <div>
          <FieldLayer />
        </div>
        <FieldsPanel />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /^city2,/ }));
    expect(useViewStore.getState().page).toBe(1);
    expect(screen.getByRole('textbox', { name: 'city2' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /^single,/ }));
    expect(screen.getByRole('listbox', { name: 'single' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /^Your name,/ }));
    expect(useViewStore.getState().page).toBe(0);
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveFocus();
  });

  it('ignores a field with no widgets', async () => {
    const user = userEvent.setup();
    const info = fieldsInfo();
    open({ ...info, fields: [{ ...info.fields[0]!, widgets: [] }] });
    render(<FieldsPanel />);
    await user.click(screen.getByRole('button', { name: /^Your name,/ }));
    expect(useViewStore.getState().page).toBe(0);
    expect(screen.getByText('1 field')).toBeInTheDocument();
  });
});

describe('document notices (D4, spec §6.1)', () => {
  it('shows nothing for an ordinary document, or before one is ready', () => {
    const { container } = render(<DocumentNotices />);
    expect(container).toBeEmptyDOMElement();
    open();
    expect(container).toBeEmptyDOMElement();
  });

  it('explains a hybrid XFA form and can be dismissed', async () => {
    const user = userEvent.setup();
    open(fieldsInfo({ xfa: 'hybrid' }));
    render(<DocumentNotices />);
    expect(screen.getByRole('status')).toHaveTextContent(NOTICES.xfaHybrid);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('explains the placeholder page of a dynamic XFA form and warns about long documents', () => {
    open(fieldsInfo({ xfa: 'dynamic', formType: 'xfa', fields: [], pageCount: 1200 }));
    render(<DocumentNotices />);
    const notices = screen.getAllByRole('status');
    expect(notices[0]).toHaveTextContent(NOTICES.xfaDynamic);
    expect(notices[1]).toHaveTextContent('This document has 1,200 pages.');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
