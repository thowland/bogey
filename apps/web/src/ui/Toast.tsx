// Transient messages (the service-worker update prompt in S9, export results in S4). One store,
// rendered once by <Toasts/> in the app shell.
import { create } from 'zustand';
import { Button } from './Button.tsx';
import styles from './Toast.module.css';

export interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run(): void };
}

interface ToastState {
  items: readonly ToastItem[];
  show(text: string, action?: ToastItem['action']): number;
  dismiss(id: number): void;
  reset(): void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set) => ({
  items: [],
  show: (text, action) => {
    const id = nextId++;
    set((state) => ({ items: [...state.items, action ? { id, text, action } : { id, text }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  reset: () => set({ items: [] }),
}));

export function Toasts() {
  const items = useToastStore((state) => state.items);
  const dismiss = useToastStore((state) => state.dismiss);
  return (
    <div className={styles.region} role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={styles.toast}>
          <span>{item.text}</span>
          {item.action && (
            <Button
              variant="primary"
              onClick={() => {
                dismiss(item.id);
                item.action!.run();
              }}
            >
              {item.action.label}
            </Button>
          )}
          <Button variant="quiet" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
            ×
          </Button>
        </div>
      ))}
    </div>
  );
}
