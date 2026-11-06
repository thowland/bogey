// A synthetic two-page AcroForm document with one field of every kind (Sprint 5 tests).
import type { FieldDescriptor, PdfInfo, WidgetGeometry } from '@bogey/core';

const widget = (page: number, rect: [number, number, number, number], extra = {}): WidgetGeometry =>
  ({ page, rect, mkRotation: 0, ...extra }) as WidgetGeometry;

const base = {
  supported: true,
  readOnly: false,
  required: false,
  fontSize: 12,
  textAlign: 'left',
} as const;

export const FIELDS: FieldDescriptor[] = [
  {
    ...base,
    name: 'form.name',
    alternateName: 'Your name',
    kind: 'text',
    required: true,
    widgets: [widget(0, [100, 700, 300, 720])],
    tabOrder: 0,
  },
  {
    ...base,
    name: 'form.notes',
    kind: 'text',
    multiline: true,
    fontSize: 0,
    widgets: [widget(0, [100, 600, 300, 680])],
    tabOrder: 1,
  },
  {
    ...base,
    name: 'form.ssn',
    kind: 'text',
    comb: true,
    maxLength: 9,
    widgets: [widget(0, [100, 560, 280, 580])],
    tabOrder: 2,
  },
  {
    ...base,
    name: 'form.pin',
    kind: 'text',
    password: true,
    widgets: [widget(0, [100, 530, 200, 550])],
    tabOrder: 3,
  },
  {
    ...base,
    name: 'form.agree',
    kind: 'checkbox',
    onValues: ['Yes'],
    widgets: [widget(0, [100, 500, 112, 512], { onValue: 'Yes' })],
    tabOrder: 4,
  },
  {
    ...base,
    name: 'form.size',
    kind: 'radio',
    onValues: ['S', 'L'],
    widgets: [
      widget(0, [100, 470, 112, 482], { onValue: 'S' }),
      widget(0, [130, 470, 142, 482], { onValue: 'L' }),
    ],
    tabOrder: 5,
  },
  {
    ...base,
    name: 'form.colour',
    kind: 'dropdown',
    options: [
      { value: 'r', label: 'Red' },
      { value: 'g', label: 'Green' },
    ],
    widgets: [widget(0, [100, 440, 200, 460])],
    tabOrder: 6,
  },
  {
    ...base,
    name: 'form.city',
    kind: 'dropdown',
    editable: true,
    options: [{ value: 'Boston', label: 'Boston' }],
    widgets: [widget(0, [100, 410, 200, 430])],
    tabOrder: 7,
  },
  {
    ...base,
    name: 'form.days',
    kind: 'list',
    multiSelect: true,
    options: [
      { value: 'mon', label: 'Monday' },
      { value: 'tue', label: 'Tuesday' },
    ],
    widgets: [widget(0, [100, 340, 200, 400])],
    tabOrder: 8,
  },
  {
    ...base,
    name: 'form.fixed',
    kind: 'text',
    readOnly: true,
    widgets: [widget(0, [100, 300, 300, 320])],
    tabOrder: 9,
  },
  {
    ...base,
    name: 'form.sign',
    kind: 'signature',
    supported: false,
    widgets: [widget(0, [100, 200, 300, 240])],
    tabOrder: 10,
  },
  {
    ...base,
    name: 'form.locked',
    kind: 'checkbox',
    readOnly: true,
    onValues: ['On'],
    widgets: [widget(0, [100, 180, 112, 192])],
    tabOrder: 11,
  },
  {
    ...base,
    name: 'form.city2',
    kind: 'text',
    widgets: [widget(1, [100, 700, 300, 720])],
    tabOrder: 12,
  },
  {
    ...base,
    name: 'form.single',
    kind: 'list',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
    widgets: [widget(1, [100, 600, 200, 660])],
    tabOrder: 13,
  },
];

export function fieldsInfo(patch: Partial<PdfInfo> = {}): PdfInfo {
  return {
    formType: 'acroform',
    xfa: 'none',
    encrypted: false,
    decryptable: true,
    pageCount: 2,
    pages: [
      { index: 0, view: [0, 0, 612, 792], rotate: 0, userUnit: 1 },
      { index: 1, view: [0, 0, 612, 792], rotate: 0, userUnit: 1 },
    ],
    fields: FIELDS,
    initialValues: {
      'form.name': '',
      'form.notes': '',
      'form.ssn': '',
      'form.pin': '',
      'form.agree': false,
      'form.size': '',
      'form.colour': '',
      'form.city': '',
      'form.days': [],
      'form.fixed': 'Fixed value',
      'form.locked': true,
      'form.city2': '',
      'form.single': [],
    },
    metadata: {},
    ...patch,
  };
}
