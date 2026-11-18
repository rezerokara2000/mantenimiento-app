import Alpine from 'alpinejs';
import { copyToClipboard } from '../exporters';

interface ToastItem {
  id: number;
  msg: string;
  type: 'ok' | 'error' | 'info';
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

/** Registra los stores globales (toast y diálogo de confirmación). Llamar antes de Alpine.start(). */
export function registerUiStores() {
  let seq = 0;

  Alpine.store('toast', {
    items: [] as ToastItem[],
    push(msg: string, type: ToastItem['type'] = 'ok') {
      const id = ++seq;
      (this as { items: ToastItem[] }).items.push({ id, msg, type });
      setTimeout(() => (this as { dismiss(id: number): void }).dismiss(id), 3500);
    },
    dismiss(id: number) {
      const self = this as { items: ToastItem[] };
      self.items = self.items.filter((t) => t.id !== id);
    },
  });

  let resolver: ((v: boolean) => void) | null = null;
  Alpine.store('confirm', {
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirmar',
    danger: false,
    ask(opts: ConfirmOptions): Promise<boolean> {
      const self = this as Record<string, unknown>;
      self.title = opts.title;
      self.message = opts.message;
      self.confirmLabel = opts.confirmLabel ?? 'Confirmar';
      self.danger = opts.danger ?? false;
      self.open = true;
      return new Promise<boolean>((resolve) => (resolver = resolve));
    },
    answer(value: boolean) {
      (this as Record<string, unknown>).open = false;
      resolver?.(value);
      resolver = null;
    },
  });
}

type ToastStore = { push(msg: string, type?: ToastItem['type']): void };
type ConfirmStore = { ask(opts: ConfirmOptions): Promise<boolean> };

export const toast = (msg: string, type: ToastItem['type'] = 'ok') =>
  (Alpine.store('toast') as ToastStore).push(msg, type);

export const confirmDialog = (opts: ConfirmOptions) => (Alpine.store('confirm') as ConfirmStore).ask(opts);

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Ejecuta una acción mostrando un toast de error si falla. */
export async function safe<T>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(errMsg(e), 'error');
    return undefined;
  }
}

export async function copyWithToast(text: string) {
  const ok = await copyToClipboard(text);
  toast(ok ? 'Lista copiada. Pégala en WhatsApp.' : 'No se pudo copiar al portapapeles.', ok ? 'ok' : 'error');
}
