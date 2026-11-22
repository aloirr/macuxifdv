'use client';

import { cloneElement, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { CLASSES_DESTAQUE } from './cores';
import { ehMensagemTecnica, MENSAGEM_ERRO_PADRAO, mensagemParaTela } from './erros';
import { IconAlert, IconBusca, IconCheck, IconInfo } from './icons';
import { estiloDaTabela, tabelaPronta } from './tabela';

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(' ');
}

/* ---------- cabeçalho e filtros ---------- */

/**
 * Cabeçalho da página (revisão do BKO §P1): título à esquerda, ações à direita, na mesma linha. No máximo uma ação
 * principal e uma secundária visíveis; o resto (Exportar CSV, Atualizar) vai no `MenuAcoes` da página.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  badge,
  actions,
}: {
  title: ReactNode;
  /** Linha de identificação ou de estado (ex.: "erp-matriz · v1.4.2 · última carga recebida 15/11 às 01:02"); frase de explicação não (§P1). */
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-[42px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        {eyebrow && <span className="text-[13px] text-ink-2">{eyebrow}</span>}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="m-0 text-[24px] leading-tight font-bold">{title}</h1>
          {badge}
        </div>
        {subtitle && <span className="text-[13px] text-ink-2">{subtitle}</span>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-2.5">{children}</div>;
}

/**
 * Traço, cor, texto e foco de todo campo do kit (filtros, busca e formulário; RD-0368). Cada campo só acrescenta a altura,
 * a largura e o respiro.
 */
export const CLASSE_CAMPO_BASE = cx(
  'rounded-[10px] border border-field bg-surface text-[15px] text-ink placeholder:text-ink-2 disabled:opacity-60',
  CLASSES_DESTAQUE.foco,
);

export function SelectField({ label, children, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
      {label}
      <select
        className={cx(CLASSE_CAMPO_BASE, 'h-[38px] min-w-[120px] px-2.5', className)}
        {...rest}
      >
        {children}
      </select>
    </label>
  );
}

/** Campo de texto dos filtros, na mesma altura e no mesmo traço do `SelectField` (revisão do BKO §P4). */
export function TextField({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
      {label}
      <input
        className={cx(CLASSE_CAMPO_BASE, 'h-[38px] min-w-[120px] px-2.5', className)}
        {...rest}
      />
    </label>
  );
}

/**
 * Busca da lista (revisão do BKO §P4): primeiro filtro da barra, com lupa e sem rótulo visível (o `placeholder` diz o que
 * procura, o `aria-label` repete). Largura de 280 px; na tela estreita, a linha inteira.
 */
export function CampoBusca({ rotulo, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { rotulo: string }) {
  return (
    <div className={cx('relative w-full sm:w-[280px]', className)}>
      <IconBusca size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-2" />
      <input
        type="search"
        aria-label={rotulo}
        placeholder={rotulo}
        className={cx(CLASSE_CAMPO_BASE, 'h-[38px] w-full pr-2.5 pl-9')}
        {...rest}
      />
    </div>
  );
}

/**
 * Campo de formulário (revisão do BKO §P8): rótulo em cima, "(opcional)" só no que não é obrigatório, erro embaixo, em
 * vermelho e com o ícone (cor nunca sozinha). Substitui os `Campo` locais das telas. O controle (`input`, `select`,
 * `textarea`) vem como filho, com a classe `CLASSE_CAMPO`.
 */
export function CampoFormulario({ rotulo, opcional, erro, children, className }: { rotulo: string; opcional?: boolean; erro?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1 text-[13px] font-semibold text-ink', className)}>
      <span>
        {rotulo}
        {opcional && <span className="font-normal text-ink-2"> (opcional)</span>}
      </span>
      {children}
      {erro && (
        <span className="flex items-start gap-1 text-[12px] font-normal text-danger">
          <IconAlert size={13} className="mt-[2px] shrink-0" />
          {erro}
        </span>
      )}
    </label>
  );
}

/**
 * Caixa do campo das telas de acesso (login do BKO, portal de implantação, "Crie sua senha"): 44 px, texto 15. Serve a
 * qualquer campo dessas telas, de senha ou não; o `CampoSenha` usa esta classe (RD-0478). Os `campoCss` locais do apps/web
 * passam a importar esta.
 */
export const CLASSE_CAMPO_ACESSO =
  'h-11 w-full rounded-xl border border-field bg-surface px-3 text-[15px] text-ink outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-[invalid=true]:border-danger disabled:bg-ground disabled:text-ink-2';

/** Classe do controle dentro do `CampoFormulario`: 42 px, a mesma altura do botão `md`. */
export const CLASSE_CAMPO = cx(CLASSE_CAMPO_BASE, 'h-[42px] w-full px-3 aria-[invalid=true]:border-danger');

/**
 * Título de quadro com a contagem (revisão do BKO §P6: o número aparece num lugar só). "Pedidos · 12", "Pedidos · 50+"
 * quando há mais páginas. Com zero, só o rótulo: quem diz que está vazio é o `EstadoVazio`, uma vez.
 */
export function rotuloComContagem(rotulo: string, quantidade: number, haMais = false): string {
  if (quantidade <= 0) return rotulo;
  return `${rotulo} · ${quantidade.toLocaleString('pt-BR')}${haMais ? '+' : ''}`;
}

/* ---------- cartões ---------- */

export type PropsKpiCard = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClass?: string;
  dark?: boolean;
  extra?: ReactNode;
  /** Cartão-filtro (revisão do BKO §P4.6): com `onClick`, o cartão inteiro é um `<button aria-pressed>`. */
  onClick?: () => void;
  /** Cartão-filtro marcado (MC-0090): fundo `bg-accent-soft` e borda de 2 px `border-accent`; vence o `dark`. */
  selecionado?: boolean;
  testid?: string;
};

export function KpiCard({ label, value, sub, valueClass, dark, extra, onClick, selecionado, testid }: PropsKpiCard) {
  const escuro = dark && !selecionado;
  const classe = cx(
    'flex flex-col gap-1 rounded-[14px] px-4 py-3.5',
    escuro ? 'bg-ink text-white' : selecionado ? 'border border-accent ring-1 ring-inset ring-accent bg-accent-soft' : 'border border-line bg-surface',
    onClick && cx('min-h-11 w-full cursor-pointer text-left text-ink', CLASSES_DESTAQUE.foco),
  );
  const miolo = (
    <>
      <span className={cx('text-[13px]', escuro ? 'text-nav-text' : 'text-ink-2')}>{label}</span>
      <span className={cx('text-[24px] leading-tight font-semibold tabular-nums', valueClass)}>
        {value}
        {extra}
      </span>
      {sub !== undefined && <span className={cx('text-[12px]', escuro ? 'text-nav-text' : 'text-ink-2')}>{sub}</span>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={!!selecionado} data-testid={testid} className={classe}>
        {miolo}
      </button>
    );
  }
  return (
    <div data-testid={testid} className={classe}>
      {miolo}
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
          {title && <h2 className="m-0 text-[17px] font-bold">{title}</h2>}
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
        <table className="w-full border-collapse text-[15px]" style={{ minWidth }}>
          {children}
        </table>
      )}
    </div>
  );
}

export const th = 'border-b border-line px-2.5 py-2 text-left text-[12px] font-semibold whitespace-nowrap text-ink-2';
export const thNum = `${th} text-right`;
export const td = 'border-b border-line-2 p-2.5 align-middle text-[15px]';
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
  return <span className={cx('inline-block rounded-lg px-2 py-[3px] text-[12px] font-medium whitespace-nowrap', BADGE[tone], className)}>{children}</span>;
}

/** Um selo da Situação. A tela monta a lista do mais importante para o menos. */
export interface Selo {
  tom: BadgeTone;
  texto: string;
}

/** Revisão do BKO §P5: a Situação mostra um selo só, o primeiro da lista (o mais importante). Lista vazia não mostra nada. */
export function seloPrincipal(selos: ReadonlyArray<Selo | null | undefined>): Selo | null {
  return selos.find((s): s is Selo => !!s) ?? null;
}

export function SeloSituacao({ selos }: { selos: ReadonlyArray<Selo | null | undefined> }) {
  const s = seloPrincipal(selos);
  return s ? <Badge tone={s.tom}>{s.texto}</Badge> : null;
}

/**
 * Lista vazia (revisão do BKO §P7): uma frase do que falta e, quando o perfil pode, a ação que resolve. Sem ilustração,
 * sem explicação do sistema. Mesmo nome e mesma regra do `EstadoVazio` do app. Filtro sem resultado: "Nenhum <item> com esses
 * filtros.", sem botão (o "Limpar filtros" fica só na barra de filtros, §P4).
 * `semBorda` (manual da marca §4, cartão; RD-0970): dentro de um cartão, sem borda tracejada nem cantos próprios, porque o cartão já tem os dois.
 */
export function EstadoVazio({ titulo, acao, testId, semBorda = false }: { titulo: string; acao?: ReactNode; testId?: string; semBorda?: boolean }) {
  return (
    <div
      data-testid={testId}
      className={cx('flex flex-col items-center gap-3 px-6 py-10 text-center', !semBorda && 'rounded-2xl border border-dashed border-line')}
    >
      <span className="text-[15px] font-semibold text-ink-2">{titulo}</span>
      {acao}
    </div>
  );
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

type Variant = 'primary' | 'secondary' | 'link' | 'danger';

/**
 * Desabilitado (RD-2619; docs/design/componentes.md, "Botão desabilitado no web"): um padrão só, o do app — Névoa
 * (`neutral-soft`, #ECEEF1) com texto de apoio (`texto-apoio`, #5B6673, 5,03:1), sem transparência, cursor not-allowed.
 * Sai o `bg-disabled` (#8B96A3) com texto branco (3,00:1). O link desabilitado só troca a cor do texto (5,84:1 no branco).
 */
const DESABILITADO_CHEIO = 'disabled:border-transparent disabled:bg-neutral-soft disabled:text-texto-apoio';

/** Classes do botão do kit web, sem hooks (testável sem DOM). */
export function classesDoBotao(variant: Variant = 'secondary', size: 'sm' | 'md' = 'md'): string {
  const base = 'inline-flex items-center justify-center gap-1.5 font-semibold transition-colors disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
  const sizes = size === 'sm' ? 'h-[38px] rounded-[10px] px-3 text-[15px]' : 'h-[42px] rounded-xl px-4 text-[15px]';
  const variants: Record<Variant, string> = {
    // T-0172 (marca v1): o principal é Azul noite (accent), texto branco 12,77:1
    primary: `bg-accent text-white hover:bg-accent/90 ${DESABILITADO_CHEIO}`,
    secondary: `border border-field bg-surface text-ink hover:bg-ground ${DESABILITADO_CHEIO}`,
    danger: `bg-danger text-white hover:bg-[#8d1f16] ${DESABILITADO_CHEIO}`,
    // Link em accent-ink (Azul noite, 11,82:1 no Pérola). Hover: sublinhado.
    link: 'h-auto px-0 text-accent-ink underline-offset-2 hover:underline disabled:text-texto-apoio disabled:no-underline',
  };
  return cx(base, variant === 'link' ? 'text-[15px]' : sizes, variants[variant]);
}

export function Button({ variant = 'secondary', className, size = 'md', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  // `aria-disabled` acompanha o `disabled` nativo (leitor de tela lê "indisponível"); quem chama pode passar o seu.
  const ariaDisabled = rest['aria-disabled'] ?? (rest.disabled ? true : undefined);
  return <button type="button" className={cx(classesDoBotao(variant, size), className)} {...rest} aria-disabled={ariaDisabled} />;
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
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cx('flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[15px]', NOTICE[tone], className)}>
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
