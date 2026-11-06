// Zoom out, the zoom menu (fit width, fit page, 50–300%) and zoom in (V3, spec §10.4).
import { useDocumentStore } from '../../state/document.ts';
import { useViewStore } from '../../state/view.ts';
import { Button } from '../../ui/Button.tsx';
import { ZoomMenu } from './ZoomMenu.tsx';
import { MAX_ZOOM, MIN_ZOOM, stepZoom, ZOOM_CHOICES, zoomValue } from './zoom.ts';
import styles from './Controls.module.css';

export function ZoomControls() {
  const ready = useDocumentStore((state) => state.status === 'ready');
  const zoom = useViewStore((state) => state.zoom);
  const shown = useViewStore((state) => state.renderedZoom);
  const setZoom = useViewStore((state) => state.setZoom);

  if (!ready) return null;
  const current = shown ?? (typeof zoom === 'number' ? zoom : 1);
  // A zoom set some other way (a pinch, in Sprint 8) still shows in the menu.
  const choices = ZOOM_CHOICES.some((choice) => zoomValue(choice) === zoomValue(zoom))
    ? ZOOM_CHOICES
    : [...ZOOM_CHOICES, zoom];
  return (
    <div className={styles.group} role="group" aria-label="Zoom">
      <Button
        variant="quiet"
        aria-label="Zoom out"
        disabled={current <= MIN_ZOOM}
        onClick={() => setZoom(stepZoom(current, -1))}
      >
        −
      </Button>
      <ZoomMenu zoom={zoom} choices={choices} onChoose={setZoom} />
      <Button
        variant="quiet"
        aria-label="Zoom in"
        disabled={current >= MAX_ZOOM}
        onClick={() => setZoom(stepZoom(current, 1))}
      >
        +
      </Button>
    </div>
  );
}
