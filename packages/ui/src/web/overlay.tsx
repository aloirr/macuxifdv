'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconX } from './icons';
import { Notice, type NoticeTone } from './ui';

/**
 * Fecha com Esc e devolve o foco ao elemento que abriu.
 * O efeito depende só de `open`: se dependesse de `onClose` (função nova a cada render),
 * cada tecla digitada rodaria a limpeza e jogaria o foco para fora do campo.
 */
function useEscape(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);
}

export function Dialog({ open, title, children, footer, onClose }: { open: boolean; title: string; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  useEscape(open, onClose);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('textarea, input, select, button')?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="flex w-full max-w-[460px] flex-col gap-3 rounded-2xl bg-surface p-5 shadow-xl">
        <h2 id={id} className="m-0 font-display text-[18px] font-bold">
          {title}
        </h2>
        <div className="text-[14px] text-ink">{children}</div>
        <div className="flex flex-wrap justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

export function Drawer({ open, title, subtitle, children, onClose }: { open: boolean; title: ReactNode; subtitle?: ReactNode; children: ReactNode; onClose: () => void }) {
  useEscape(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/35" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-labelledby={id} className="flex h-full w-full max-w-[560px] flex-col overflow-hidden bg-ground shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={id} className="m-0 font-display text-[20px] font-extrabold">
              {title}
            </h2>
            {subtitle && <div className="text-[13px] text-ink-2">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar painel" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-field bg-surface hover:bg-ground">
            <IconX size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}

/* ---------- toasts ---------- */

interface Toast {
  id: number;
  tone: NoticeTone;
  message: string;
}

const ToastCtx = createContext<(tone: NoticeTone, message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((tone: NoticeTone, message: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'success' ? 6000 : 10000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 left-4 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:w-[420px]">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto w-full shadow-lg">
            <Notice tone={t.tone} onClose={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              {t.message}
            </Notice>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
