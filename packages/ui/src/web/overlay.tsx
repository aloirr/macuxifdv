'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconX } from './icons';
import { Notice, type NoticeTone } from './ui';

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Prende o Tab dentro do popup: do último campo volta ao primeiro e, com Shift, do primeiro vai ao último.
 * Devolve o índice que deve receber o foco, ou `null` quando o navegador pode seguir sozinho.
 * `atual` = -1 quando o foco está fora do popup.
 */
export function alvoDoTab(total: number, atual: number, shift: boolean): number | null {
  if (total === 0) return null;
  if (atual < 0) return shift ? total - 1 : 0;
  if (shift && atual === 0) return total - 1;
  if (!shift && atual === total - 1) return 0;
  return null;
}

/** Campos e botões habilitados, na ordem do documento: o primeiro recebe o foco quando o popup abre. */
const CAMPOS_DO_FOCO_INICIAL = 'textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), button:not([disabled])';

/** O mínimo do elemento que o foco inicial usa (testável sem DOM). */
export interface CaixaDoFoco {
  querySelector(seletor: string): CaixaDoFoco | null;
}

/**
 * Quem recebe o foco quando o Dialog abre (RD-2616): o primeiro campo ou botão habilitado; sem nenhum, outro focável
 * (link, `tabindex`); sem nada, a própria caixa (`tabIndex={-1}`), para o foco nunca ficar atrás do popup.
 */
export function focoInicialDoDialog<T extends CaixaDoFoco>(caixa: T): T {
  return (caixa.querySelector(CAMPOS_DO_FOCO_INICIAL) ?? caixa.querySelector(FOCAVEIS) ?? caixa) as T;
}

/**
 * Fecha com Esc, prende o Tab dentro do popup e devolve o foco ao elemento que abriu.
 * O efeito depende só de `open`: se dependesse de `onClose` (função nova a cada render),
 * cada tecla digitada rodaria a limpeza e jogaria o foco para fora do campo.
 */
function useEscape(open: boolean, onClose: () => void, caixa: { current: HTMLElement | null }) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !caixa.current) return;
      const lista = Array.from(caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (lista.length === 0) {
        // Sem nada focável dentro, o Tab não sai do popup: o foco fica na própria caixa.
        e.preventDefault();
        caixa.current.focus({ preventScroll: true });
        return;
      }
      const alvo = alvoDoTab(lista.length, lista.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (alvo === null) return;
      e.preventDefault();
      lista[alvo]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, caixa]);
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
 * Largura do popup a partir de 640 px: `padrao` = 460 px (confirmação, formulário curto); `media` = 540 px
 * (formulário com opções em cartão, ex.: Criar rota); `media-larga` = 560 px (formulário com endereço,
 * ex.: Endereço base; T-0191, rotas-criar §3 e §5); `larga` = 720 px (tabela curta dentro do popup);
 * `extra-larga` = 880 px (cartões lado a lado, ex.: "Trocar de plano" do portal; RD-2616).
 */
export type LarguraDoDialog = 'padrao' | 'media' | 'media-larga' | 'larga' | 'extra-larga';

/** Classes literais (o Tailwind só gera o que aparece escrito por inteiro). */
const MAX_LARGURA: Record<LarguraDoDialog, string> = {
  padrao: 'sm:max-w-[460px]',
  media: 'sm:max-w-[540px]',
  'media-larga': 'sm:max-w-[560px]',
  larga: 'sm:max-w-[720px]',
  'extra-larga': 'sm:max-w-[880px]',
};

/** Classes da caixa do popup; abaixo de 640 px é sempre folha na largura toda. */
export function classesDoDialog(largura: LarguraDoDialog = 'padrao'): string {
  return `flex max-h-full w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl outline-none ${MAX_LARGURA[largura]} sm:rounded-2xl`;
}

/** Cabeçalho do popup: título e, se houver, a linha de identificação embaixo (13 px, `ink-2`, como no Drawer). Sem hooks. */
export function CabecalhoDoDialog({ id, title, subtitle, rola }: { id: string; title: string; subtitle?: ReactNode; rola: boolean }) {
  const divisa = rola ? 'border-b border-line' : '';
  if (!subtitle) {
    return (
      <h2 id={id} className={`m-0 shrink-0 px-5 pt-5 pb-3 text-[20px] font-bold ${divisa}`}>
        {title}
      </h2>
    );
  }
  return (
    <div className={`flex shrink-0 flex-col gap-0.5 px-5 pt-5 pb-3 ${divisa}`}>
      <h2 id={id} className="m-0 text-[20px] font-bold">
        {title}
      </h2>
      <div className="text-[13px] text-ink-2">{subtitle}</div>
    </div>
  );
}

/**
 * Popup do BKO (R-20261114-141500): nunca passa da área visível. Título e botões ficam sempre à vista;
 * só o corpo rola. A partir de 640 px é um cartão centrado (ver `LarguraDoDialog`);
 * abaixo disso vira folha que sobe de baixo, na largura toda, com os cantos arredondados só em cima e
 * respeitando a área segura. `subtitle`: só linha de identificação ou estado (ex.: "erp-matriz · 4 lotes"),
 * nunca frase de explicação.
 */
export function Dialog({
  open,
  title,
  subtitle,
  largura = 'padrao',
  children,
  footer,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  largura?: LarguraDoDialog;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEscape(open, onClose, ref);
  const corpo = useCorpoRola(open);
  useEffect(() => {
    if (!open) return;
    const caixa = ref.current;
    if (!caixa) return;
    const alvo = focoInicialDoDialog<HTMLElement>(caixa);
    // Sem rolar a página nem centralizar o corpo: só o mínimo para o campo aparecer.
    alvo.focus({ preventScroll: true });
    alvo.scrollIntoView?.({ block: 'nearest' });
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 pt-8 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={classesDoDialog(largura)}
      >
        <CabecalhoDoDialog id={id} title={title} subtitle={subtitle} rola={corpo.rola} />
        <div ref={corpo.ref} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 text-[15px] text-ink ${corpo.rola ? 'py-3' : 'py-0.5'}`}>
          {children}
        </div>
        <div className={`flex shrink-0 flex-wrap justify-end gap-2 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5 ${corpo.rola ? 'border-t border-line' : ''}`}>{footer}</div>
      </div>
    </div>
  );
}

/**
 * Gaveta da direita. `rodape` (revisão do BKO §P8): a barra de botões do formulário (Salvar à direita, Cancelar ao lado),
 * fixa embaixo, sempre à vista; o corpo rola sozinho.
 */
export function Drawer({ open, title, subtitle, children, onClose, rodape }: { open: boolean; title: ReactNode; subtitle?: ReactNode; children: ReactNode; onClose: () => void; rodape?: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  useEscape(open, onClose, ref);
  useEffect(() => {
    // Primeiro campo do painel; sem campo, o botão Fechar (fica no cabeçalho, sempre à vista).
    const caixa = ref.current;
    if (!open || !caixa) return;
    const campo = caixa.querySelector<HTMLElement>('[data-corpo] :is(textarea, input, select)') ?? caixa.querySelector<HTMLElement>('button');
    campo?.focus({ preventScroll: true });
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/35" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className="flex h-full w-full max-w-[560px] flex-col overflow-hidden bg-ground shadow-2xl outline-none">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={id} className="m-0 text-[20px] font-bold">
              {title}
            </h2>
            {subtitle && <div className="text-[13px] text-ink-2">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar painel" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-field bg-surface hover:bg-ground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <IconX size={18} />
          </button>
        </div>
        <div data-corpo className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
        {rodape && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{rodape}</div>}
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
