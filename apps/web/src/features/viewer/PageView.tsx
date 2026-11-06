import { FieldLayer } from '../fields/index.ts';
import { OverlayLayer } from '../overlays/index.ts';
import styles from '../placeholder.module.css';

/**
 * Sprint 1 renders the current page here with pdf.js. The field layer (S5) and the overlay layer
 * (S4) sit on top of the canvas, in this order.
 */
export function PageView() {
  return (
    <div>
      <p className={styles.empty}>The page appears here.</p>
      <FieldLayer />
      <OverlayLayer />
    </div>
  );
}
