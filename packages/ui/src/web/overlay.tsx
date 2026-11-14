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

/**
 * Mostra a divisa do cabeçalho e do rodapé só quando o corpo do popup rola (conteúdo maior que a tela).
 */
function useCorpoRola(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [rola, setRola] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const medir = () => setRola(el.scrollHeight > el.clientHeight + 1);
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    for (const filho of Array.from(el.children)) obs.observe(filho);
    return () => obs.disconnect();
  }, [open]);
  return { ref, rola };
}

/**
 * Popup do BKO (R-20261114-141500): nunca passa da área visível. Título e botões ficam sempre à vista;
 * só o corpo rola. A partir de 640 px é um cartão centrado de até 460 px; abaixo disso vira folha que
 * sobe de baixo, na largura toda, com os cantos arredondados só em cima e respeitando a área segura.
 */
export function Dialog({ open, title, children, footer, onClose }: { open: boolean; title: string; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  useEscape(open, onClose);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const corpo = useCorpoRola(open);
  useEffect(() => {
    if (!open) return;
    const alvo = ref.current?.querySelector<HTMLElement>('textarea, input, select, button');
    // Sem rolar a página nem centralizar o corpo: só o mínimo para o campo aparecer.
    alvo?.focus({ preventScroll: true });
    alvo?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 pt-8 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="flex max-h-full w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:max-w-[460px] sm:rounded-2xl"
      >
        <h2 id={id} className={`m-0 shrink-0 px-5 pt-5 pb-3 font-display text-[18px] font-bold ${corpo.rola ? 'border-b border-line' : ''}`}>
          {title}
        </h2>
        <div ref={corpo.ref} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 text-[14px] text-ink ${corpo.rola ? 'py-3' : 'py-0.5'}`}>
          {children}
        </div>
        <div className={`flex shrink-0 flex-wrap justify-end gap-2 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5 ${corpo.rola ? 'border-t border-line' : ''}`}>{footer}</div>
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
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
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
