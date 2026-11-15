/**
 * Mapa único dos módulos (R-20261114-143500, revisão do BKO §P10): id → nome → ícone → frase de valor. O BKO e o portal
 * `config.` usam este mapa; nenhuma tela mostra o id ("vendedor", "integracao").
 *
 * Core, Integração e Catálogo são nativos: entram em toda empresa e SOMEM de toda lista de módulos (licenças, perfis, portal).
 * Os contratáveis são Vendedor, Gestor, Promotor, Pesquisa e Treinamento, em ordem alfabética.
 */
import type { ReactElement, SVGProps } from 'react';
import { IconPesquisa, IconPromotor, IconTreinamento } from './icons';
import { Interruptor } from './permissoes';
import { cx } from './ui';

/** Os ids dos módulos, os mesmos do `MODULOS` do platform-sdk (o kit não depende do SDK). */
export const IDS_DOS_MODULOS = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'] as const;
export type IdDoModulo = (typeof IDS_DOS_MODULOS)[number];
const MODULOS: readonly string[] = IDS_DOS_MODULOS;

export const MODULOS_NATIVOS: readonly IdDoModulo[] = ['catalogo', 'core', 'integracao'];

type PropsIcone = SVGProps<SVGSVGElement> & { size?: number };

function Traco({ size = 20, children, ...rest }: PropsIcone) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {children}
    </svg>
  );
}

/** Ícones dos módulos, no traço dos ícones do kit (24×24, ponta redonda). Validação da marca: docs/design/telas/bko-revisao.md §P10. */
const ICONES: Record<IdDoModulo, (p: PropsIcone) => ReactElement> = {
  // pedido: carrinho
  vendedor: (p) => (
    <Traco {...p}>
      <circle cx="9.5" cy="19.5" r="1.5" />
      <circle cx="17.5" cy="19.5" r="1.5" />
      <path d="M2.5 3.5h2.6l2.4 11.3a1.6 1.6 0 0 0 1.6 1.2h8.6a1.6 1.6 0 0 0 1.5-1.2L21 7.5H6" />
    </Traco>
  ),
  // equipe e indicadores: barras subindo
  gestor: (p) => (
    <Traco {...p}>
      <path d="M3.5 20.5h17" />
      <path d="M7 16.5v-4" />
      <path d="M12 16.5v-8" />
      <path d="M17 16.5V4.5" />
    </Traco>
  ),
  // promotor, pesquisa e treinamento: os mesmos ícones do MC-0042 (`./icons`), um desenho por módulo
  promotor: (p) => <IconPromotor strokeWidth={1.9} {...p} />,
  pesquisa: (p) => <IconPesquisa strokeWidth={1.9} {...p} />,
  treinamento: (p) => <IconTreinamento strokeWidth={1.9} {...p} />,
  // base: quatro blocos
  core: (p) => (
    <Traco {...p}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Traco>
  ),
  // catálogo: livro aberto
  catalogo: (p) => (
    <Traco {...p}>
      <path d="M2.5 5h6a3.5 3.5 0 0 1 3.5 3.5V20a2.8 2.8 0 0 0-2.8-2.8H2.5z" />
      <path d="M21.5 5h-6A3.5 3.5 0 0 0 12 8.5V20a2.8 2.8 0 0 1 2.8-2.8h6.7z" />
    </Traco>
  ),
  // ERP: duas setas trocando
  integracao: (p) => (
    <Traco {...p}>
      <path d="M4 8h14l-3.5-3.5" />
      <path d="M20 16H6l3.5 3.5" />
    </Traco>
  ),
};

export interface InfoDoModulo {
  id: IdDoModulo;
  nome: string;
  /** Frase de valor do cartão: o que a equipe ganha, em uma linha. */
  valor: string;
  nativo: boolean;
}

const INFO: Record<IdDoModulo, Omit<InfoDoModulo, 'id' | 'nativo'>> = {
  catalogo: { nome: 'Catálogo', valor: 'Busca de produtos com aplicação, preço e estoque.' },
  core: { nome: 'Core', valor: 'Usuários, clientes, rotas e metas.' },
  gestor: { nome: 'Gestor', valor: 'Equipe, aprovações e indicadores na palma da mão.' },
  integracao: { nome: 'Integração com o ERP', valor: 'Cadastros e pedidos trocados com o ERP.' },
  pesquisa: { nome: 'Pesquisa', valor: 'Questionários na visita, com fotos e resultados.' },
  promotor: { nome: 'Promotor', valor: 'Gôndola, share, preço, ruptura e validade no PDV.' },
  treinamento: { nome: 'Treinamento', valor: 'Trilhas, quizzes e ranking para a equipe de campo.' },
  vendedor: { nome: 'Vendedor', valor: 'Pedidos e orçamentos no app, mesmo sem sinal.' },
};

export function infoDoModulo(id: IdDoModulo): InfoDoModulo {
  return { id, ...INFO[id], nativo: MODULOS_NATIVOS.includes(id) };
}

/** Nome do módulo para a tela (nunca o id). Id desconhecido (servidor mais novo) aparece como veio. */
export function nomeDoModulo(id: string): string {
  return MODULOS.includes(id) ? INFO[id as IdDoModulo].nome : id;
}

/** Os módulos que aparecem em lista (licenças, perfis, portal): sem os nativos, em ordem alfabética do nome. */
export function modulosContrataveis(ids: readonly string[] = IDS_DOS_MODULOS): InfoDoModulo[] {
  return ids
    .filter((id): id is IdDoModulo => MODULOS.includes(id) && !MODULOS_NATIVOS.includes(id as IdDoModulo))
    .map(infoDoModulo)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function IconeModulo({ id, size = 20, className }: { id: IdDoModulo; size?: number; className?: string }) {
  const Icone = ICONES[id];
  return <Icone size={size} className={className} />;
}

/**
 * Cartão do módulo (licenças, perfil, portal): ícone num quadrado Pérola com traço Azul noite, nome, frase de valor e o
 * interruptor Sim/Não (o mesmo das permissões). Sem `aoAlternar`, só mostra (perfil que consulta).
 */
export function CartaoDeModulo({
  id,
  ativo,
  aoAlternar,
  desabilitado,
  testId,
}: {
  id: IdDoModulo;
  ativo: boolean;
  aoAlternar?: (ativo: boolean) => void;
  desabilitado?: boolean;
  testId?: string;
}) {
  const m = infoDoModulo(id);
  const rotuloId = `modulo-${id}-nome`;
  return (
    <div data-testid={testId} className={cx('flex items-center gap-3 rounded-[14px] border bg-surface px-4 py-3', ativo ? 'border-line' : 'border-line-2')}>
      <span className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', ativo ? 'bg-accent-soft text-accent-ink' : 'bg-neutral-soft text-ink-2')}>
        <IconeModulo id={id} size={22} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span id={rotuloId} className="font-display text-[15px] font-bold text-ink">
          {m.nome}
        </span>
        <span className="truncate text-[13px] text-ink-2" title={m.valor}>
          {m.valor}
        </span>
      </div>
      {aoAlternar ? (
        <Interruptor ligado={ativo} onChange={aoAlternar} rotuloId={rotuloId} desabilitado={desabilitado} testId={testId ? `${testId}.interruptor` : undefined} />
      ) : (
        <span className={cx('text-[13px] font-semibold', ativo ? 'text-success' : 'text-ink-2')}>{ativo ? 'Ativo' : 'Inativo'}</span>
      )}
    </div>
  );
}
