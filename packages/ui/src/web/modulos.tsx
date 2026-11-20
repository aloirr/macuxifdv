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
import { ehIdDoModulo, IDS_DOS_MODULOS, MODULOS_NATIVOS, TEXTOS_DOS_MODULOS, type IdDoModulo, type TextoDoModulo } from '../comum/modulos';

// O texto (ids, nativos, nome e frase de valor) mora em `../comum/modulos`, puro, para os apps lerem o mesmo nome (N-1 do v1017).
export { IDS_DOS_MODULOS, MODULOS_NATIVOS, nomeDoModulo, type IdDoModulo } from '../comum/modulos';

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

export interface InfoDoModulo extends TextoDoModulo {
  id: IdDoModulo;
  nativo: boolean;
}

export function infoDoModulo(id: IdDoModulo): InfoDoModulo {
  return { id, ...TEXTOS_DOS_MODULOS[id], nativo: MODULOS_NATIVOS.includes(id) };
}

/** Os módulos que aparecem em lista (licenças, perfis, portal): sem os nativos, em ordem alfabética do nome. */
export function modulosContrataveis(ids: readonly string[] = IDS_DOS_MODULOS): InfoDoModulo[] {
  return ids
    .filter((id): id is IdDoModulo => ehIdDoModulo(id) && !MODULOS_NATIVOS.includes(id))
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
        <span id={rotuloId} className="text-[15px] font-semibold text-ink">
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
