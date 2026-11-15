'use client';

import { cloneElement, useEffect, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { CLASSES_DESTAQUE } from './cores';
import { ehMensagemTecnica, MENSAGEM_ERRO_PADRAO, mensagemParaTela } from './erros';
import { IconAlert, IconCheck, IconInfo } from './icons';
import { estiloDaTabela, tabelaPronta } from './tabela';

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(' ');
}

/* ---------- cabeçalho e filtros ---------- */

export function PageHeader({ title, subtitle, eyebrow, badge, actions }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; badge?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        {eyebrow && <span className="text-[13px] text-ink-2">{eyebrow}</span>}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="m-0 font-display text-[24px] leading-tight font-extrabold sm:text-[28px]">{title}</h1>
          {badge}
        </div>
        {subtitle && <span className="text-[13px] text-ink-2">{subtitle}</span>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-2.5">{children}</div>;
}

export function SelectField({ label, children, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
      {label}
      <select
        className={cx('h-[38px] min-w-[120px] rounded-[10px] border border-field bg-surface px-2.5 text-[14px] font-medium text-ink disabled:opacity-60', CLASSES_DESTAQUE.foco, className)}
        {...rest}
      >
        {children}
      </select>
    </label>
  );
}

/* ---------- cartões ---------- */

export function KpiCard({ label, value, sub, valueClass, dark, extra }: { label: string; value: ReactNode; sub?: ReactNode; valueClass?: string; dark?: boolean; extra?: ReactNode }) {
  return (
    <div className={cx('flex flex-col gap-1 rounded-[14px] px-4 py-3.5', dark ? 'bg-ink text-white' : 'border border-line bg-surface')}>
      <span className={cx('text-[13px]', dark ? 'text-nav-text' : 'text-ink-2')}>{label}</span>
      <span className={cx('font-display text-[26px] leading-tight font-extrabold tabular-nums', valueClass)}>
        {value}
        {extra}
      </span>
      {sub !== undefined && <span className={cx('text-[12px]', dark ? 'text-nav-text' : 'text-ink-2')}>{sub}</span>}
    </div>
  );
}

export function KpiGrid({ children, min = 180 }: { children: ReactNode; min?: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, calc(50% - 6px)), 1fr))` }}>
      {children}
    </div>
  );
}

export function Panel({ title, aside, children, className, label }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={cx('flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4', className)}>
      {(title || aside) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="m-0 font-display text-[18px] font-bold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Tabela que rola na horizontal dentro do próprio quadro. Aceita o miolo (`<thead>`/`<tbody>`), que vai no `<table>` do
 * kit, ou um `<table>` pronto da tela (com `data-testid`), que só ganha a largura mínima: nunca tabela dentro de tabela.
 */
export function TableScroll({ children, minWidth }: { children: ReactNode; minWidth: number }) {
  const pronta = tabelaPronta(children);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      {pronta ? (
        cloneElement(pronta, { style: estiloDaTabela(minWidth, pronta.props.style) })
      ) : (
        <table className="w-full border-collapse text-[13px]" style={{ minWidth }}>
          {children}
        </table>
      )}
    </div>
  );
}

export const th = 'border-b border-line px-2.5 py-2 text-left font-semibold whitespace-nowrap text-ink-2';
export const thNum = `${th} text-right`;
export const td = 'border-b border-line-2 p-2.5 align-middle';
export const tdNum = `${td} text-right tabular-nums`;

/* ---------- badges e barras ---------- */

export type BadgeTone = 'pending' | 'success' | 'danger' | 'neutral' | 'warning';

const BADGE: Record<BadgeTone, string> = {
  pending: 'text-accent-ink bg-accent-soft',
  success: 'text-success bg-success-soft',
  danger: 'text-danger bg-danger-soft',
  neutral: 'text-ink-3 bg-neutral-soft',
  warning: 'text-warning bg-warning-soft',
};

export function Badge({ tone, children, className }: { tone: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-block rounded-lg px-2 py-[3px] text-[11px] font-bold whitespace-nowrap', BADGE[tone], className)}>{children}</span>;
}

export function Bar({ pct, colorClass, min = 80 }: { pct: number; colorClass: string; min?: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 flex-auto overflow-hidden rounded bg-line-2" style={{ minWidth: min }} role="presentation">
      <div className={cx('h-2 rounded', colorClass)} style={{ width: `${w}%` }} />
    </div>
  );
}

/* ---------- botões ---------- */

type Variant = 'primary' | 'secondary' | 'link' | 'danger' | 'danger-secondary';

export function Button({ variant = 'secondary', className, size = 'md', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-semibold transition-colors disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
  const sizes = size === 'sm' ? 'h-[38px] rounded-[10px] px-3 text-[13px]' : 'h-[42px] rounded-xl px-4 text-[14px]';
  const variants: Record<Variant, string> = {
    // T-0172 (marca v1): o principal é Azul noite (accent), texto branco 12,77:1
    primary: 'bg-accent text-white hover:bg-accent/90 disabled:bg-disabled',
    secondary: 'border border-field bg-surface text-ink hover:bg-ground disabled:text-disabled',
    danger: 'bg-danger text-white hover:bg-danger/90 disabled:bg-disabled',
    // Perigo em linha de tabela (ex.: Excluir na lista de Empresas): contorno; o cheio fica no diálogo. Spec portal-config-enxuto §15.4.
    'danger-secondary':
      'border border-danger bg-surface text-danger hover:border-danger hover:bg-danger-soft hover:text-danger disabled:border-field disabled:text-disabled disabled:hover:bg-surface',
    // Link em accent-ink (Azul noite, 11,82:1 no Pérola). Hover: sublinhado.
    link: 'h-auto px-0 text-accent-ink underline-offset-2 hover:underline disabled:text-disabled disabled:no-underline',
  };
  return <button type="button" className={cx(base, variant === 'link' ? 'text-[13px]' : sizes, variants[variant], className)} {...rest} />;
}

/* ---------- avisos ---------- */

export type NoticeTone = 'success' | 'warning' | 'danger' | 'info';

const NOTICE: Record<NoticeTone, string> = {
  success: 'text-success bg-success-soft',
  warning: 'text-warning bg-warning-soft',
  danger: 'text-danger bg-danger-soft',
  info: 'text-ink-3 bg-neutral-soft',
};

export function Notice({ tone, children, onClose, className }: { tone: NoticeTone; children: ReactNode; onClose?: () => void; className?: string }) {
  const Icon = tone === 'success' ? IconCheck : tone === 'info' ? IconInfo : IconAlert;
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cx('flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[13px]', NOTICE[tone], className)}>
      <Icon size={15} className="mt-[2px] shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 rounded px-1 text-[12px] font-semibold underline-offset-2 hover:underline" aria-label="Fechar aviso">
          Fechar
        </button>
      )}
    </div>
  );
}

export function LoadingBlock({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-[13px] text-ink-2" role="status">
      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </div>
  );
}

/**
 * Erro com "Tentar de novo". T-0059 (R-20261102-091519): mensagem técnica (JSON de validação, pilha, erro de
 * programador) nunca vai para a tela — aparece `fallback` (ou a mensagem padrão) e o detalhe vai só para o console.
 */
export function ErrorBlock({ message, onRetry, fallback = MENSAGEM_ERRO_PADRAO }: { message: string; onRetry?: () => void; fallback?: string }) {
  const tecnica = ehMensagemTecnica(message);
  useEffect(() => {
    if (tecnica && message) console.error('[erro na tela]', message);
  }, [tecnica, message]);
  return (
    <Notice tone="danger">
      {mensagemParaTela(message, fallback, () => undefined)}{' '}
      {onRetry && (
        <button type="button" className="font-semibold underline" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </Notice>
  );
}

export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <KpiGrid>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-[92px] animate-pulse rounded-[14px] border border-line bg-surface" />
      ))}
    </KpiGrid>
  );
}
