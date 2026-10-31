/**
 * Pontos de extensão de UI (docs/produto/04 "Pontos de extensão"; registro em .coord/contratos/extensoes.md).
 * O módulo dono DECLARA o slot (ex.: core declara `cliente.abas`); outros módulos REGISTRAM itens;
 * o shell LISTA só o que vem de módulos efetivos — se o dono ou o registrante estiver inativo, o item
 * some sem erro (RN-CORE-03). O tipo do payload de cada slot fica em `contracts` do dono.
 */
import type { ModuloId, Perfil } from './nomes';
import { EXTENSAO_RE } from './nomes';

export interface ItemExtensao<P> {
  /** Módulo que registra o item. */
  modulo: ModuloId;
  /** Id do item, único por (slot, módulo). */
  id: string;
  /** Menor aparece primeiro (padrão 100); empate por módulo e id. */
  ordem?: number;
  /** Restringe a perfis (padrão: todos os perfis do módulo). */
  perfis?: readonly Perfil[];
  /**
   * Ação exigida (ADR 0004), ex.: 'pedido.criar'. O item só aparece se `filtro.pode(acao)` for verdadeiro;
   * sem `pode` no filtro, item com ação fica escondido (falha fechada — RN-PRO-01).
   */
  acao?: string;
  /** Componente React/RN, rota, ação etc. — tipado pelo contrato do slot. */
  payload: P;
}

export interface FiltroExtensao {
  modulosAtivos: Iterable<ModuloId>;
  perfil?: Perfil;
  /** Permissão por ação do usuário (`criarPermissoes(...).pode` já ligado ao contexto). */
  pode?: (acao: string) => boolean;
}

/**
 * Cria o registro. `S` mapeia slot → tipo do payload para dar tipo forte:
 * `criarRegistroExtensoes<{ 'cliente.abas': AbaCliente }>()`.
 */
export function criarRegistroExtensoes<S extends Record<string, unknown> = Record<string, unknown>>() {
  const donos = new Map<string, ModuloId>();
  const itens = new Map<string, ItemExtensao<unknown>[]>();

  return {
    declararSlot(slot: keyof S & string, dono: ModuloId): void {
      if (!EXTENSAO_RE.test(slot)) throw new Error(`Slot de extensão inválido: ${slot}`);
      const atual = donos.get(slot);
      if (atual && atual !== dono) throw new Error(`Slot ${slot} já pertence a ${atual}`);
      donos.set(slot, dono);
    },

    registrar<K extends keyof S & string>(slot: K, item: ItemExtensao<S[K]>): void {
      if (!donos.has(slot)) throw new Error(`Slot ${slot} não declarado; o módulo dono precisa declará-lo antes`);
      const lista = itens.get(slot) ?? [];
      if (lista.some((i) => i.modulo === item.modulo && i.id === item.id)) {
        throw new Error(`Item ${item.modulo}/${item.id} já registrado em ${slot}`);
      }
      lista.push(item as ItemExtensao<unknown>);
      itens.set(slot, lista);
    },

    listar<K extends keyof S & string>(slot: K, filtro: FiltroExtensao): ItemExtensao<S[K]>[] {
      const ativos = new Set(filtro.modulosAtivos);
      const dono = donos.get(slot);
      if (!dono || !ativos.has(dono)) return [];
      return (itens.get(slot) ?? [])
        .filter((i) => ativos.has(i.modulo))
        .filter((i) => !filtro.perfil || !i.perfis || i.perfis.includes(filtro.perfil))
        .filter((i) => !i.acao || (filtro.pode ? filtro.pode(i.acao) : false))
        .sort((a, b) => (a.ordem ?? 100) - (b.ordem ?? 100) || a.modulo.localeCompare(b.modulo) || a.id.localeCompare(b.id))
        .map((i) => i as ItemExtensao<S[K]>);
    },

    donoDoSlot(slot: keyof S & string): ModuloId | undefined {
      return donos.get(slot);
    },
  };
}

export type RegistroExtensoes<S extends Record<string, unknown> = Record<string, unknown>> = ReturnType<
  typeof criarRegistroExtensoes<S>
>;
