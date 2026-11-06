// Small decisions the page view makes from the document (spec §10.3).
import type { FormType } from '@bogey/core';
import type { AnnotationRendering } from '../../pdfjs/index.ts';

/**
 * AcroForm pages leave form widgets out of the canvas, because Bogey draws its own controls there;
 * flat and XFA documents draw every annotation (spec §10.3).
 */
export const annotationRendering = (formType: FormType | undefined): AnnotationRendering =>
  formType === 'acroform' ? 'without-form-widgets' : 'all';

/** The pages that keep a full canvas: the current one and `distance` either side (V6). */
export function pagesAround(page: number, pageCount: number, distance: number): number[] {
  const pages: number[] = [];
  for (
    let index = Math.max(0, page - distance);
    index <= Math.min(pageCount - 1, page + distance);
    index++
  ) {
    pages.push(index);
  }
  return pages;
}

/** Clamps a page index into the document. */
export const clampPage = (page: number, pageCount: number): number =>
  Math.min(Math.max(0, page), Math.max(0, pageCount - 1));
