/**
 * Mapa único dos módulos (R-20261114-143500, revisão do BKO §P10): id → nome → ícone → frase de valor. O BKO e o portal
 * `config.` usam este mapa; nenhuma tela mostra o id ("vendedor", "integracao").
 *
 * Core, Integração e Catálogo são nativos: entram em toda empresa e SOMEM de toda lista de módulos (licenças, perfis, portal).
 * Os contratáveis são Vendedor, Gestor, Promotor, Pesquisa e Treinamento, em ordem alfabética.
 */
import type { ComponentType, SVGProps } from 'react';
import { IconCatalogo, IconCore, IconGestor, IconIntegracao, IconPesquisa, IconPromotor, IconTreinamento, IconVendedor } from './icons';
import { Interruptor } from './permissoes';
import { cx } from './ui';

/** Os ids dos módulos, os mesmos do `MODULOS` do platform-sdk (o kit não depende do SDK). */
export const IDS_DOS_MODULOS = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'] as const;
export type IdDoModulo = (typeof IDS_DOS_MODULOS)[number];
const MODULOS: readonly string[] = IDS_DOS_MODULOS;

export const MODULOS_NATIVOS: readonly IdDoModulo[] = ['catalogo', 'core', 'integracao'];

type IconeDoModulo = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/** Só o mapa id → ícone; os desenhos ficam em `./icons` (RD-0367). Validação da marca: bko-revisao.md §P10. */
const ICONES: Record<IdDoModulo, IconeDoModulo> = {
  catalogo: IconCatalogo,
  core: IconCore,
  gestor: IconGestor,
  integracao: IconIntegracao,
  pesquisa: IconPesquisa,
  promotor: IconPromotor,
  treinamento: IconTreinamento,
  vendedor: IconVendedor,
};

/** Ícone do módulo (o mesmo do `IconeModulo`), para quem precisa do componente. */
export const iconeDoModulo = (id: IdDoModulo): IconeDoModulo => ICONES[id];

export interface InfoDoModulo {
  id: IdDoModulo;
  nome: string;
  /** Frase de valor do cartão: o que a equipe ganha, em uma linha. Os nativos não têm (não aparecem em lista). */
  valor?: string;
  nativo: boolean;
}

const INFO: Record<IdDoModulo, Omit<InfoDoModulo, 'id' | 'nativo'>> = {
  catalogo: { nome: 'Catálogo' },
  core: { nome: 'Core' },
  gestor: { nome: 'Gestor', valor: 'Equipe, aprovações e indicadores.' },
  integracao: { nome: 'Integração com o ERP' },
  pesquisa: { nome: 'Pesquisa', valor: 'Questionários na visita, com fotos e resultados.' },
  promotor: { nome: 'Promotor', valor: 'Gôndola, share, preço, ruptura e validade no PDV.' },
  treinamento: { nome: 'Treinamento', valor: 'Trilhas, quizzes e ranking para a equipe de campo.' },
  vendedor: { nome: 'Vendedor', valor: 'Pedidos e orçamentos no app.' },
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
        {m.valor && (
          <span className="truncate text-[13px] text-ink-2" title={m.valor}>
            {m.valor}
          </span>
        )}
      </div>
      {aoAlternar ? (
        <Interruptor ligado={ativo} onChange={aoAlternar} rotuloId={rotuloId} desabilitado={desabilitado} testId={testId ? `${testId}.interruptor` : undefined} />
      ) : (
        <span className={cx('text-[13px] font-semibold', ativo ? 'text-success' : 'text-ink-2')}>{ativo ? 'Ativo' : 'Inativo'}</span>
      )}
    </div>
  );
}
