/**
 * Lista de clientes no escopo da carteira e escopo de usuários (RN-CORE-04). O recorte por perfil vem do SDK
 * (`escopoDoPerfil` via `escopo.ts`); aqui só se compõe a lista, a busca e os filtros da tela Clientes (RF-CORE-02).
 * Busca em memória (carteira típica de ~500 clientes), sem acento e sem diferença de caixa.
 */
import type { Perfil } from '@macuxi/platform-sdk';
import { clienteNoEscopo, clientesVisiveis, escopoDeCarteira, type ConjuntosDoUsuario } from './escopo';

export interface ClienteLista {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  documento: string | null;
  /** Código do cliente no ERP (busca pelo código); ausente/nulo = Pré-Cadastro. */
  external_id?: string | null;
  cidade: string | null;
  segmento: string | null;
}

export interface FiltroClientes {
  q?: string;
  cidade?: string;
  segmento?: string;
  bloqueado?: boolean;
  comVencidos?: boolean;
}

/** Conjuntos calculados do financeiro (`resumoFinanceiro`) para os filtros "bloqueados" e "vencidos". */
export interface ConjuntosFinanceiros {
  bloqueados?: ReadonlySet<string>;
  comVencidos?: ReadonlySet<string>;
}

/** Busca tolerante: minúsculas, sem acento e sem espaço nas pontas. A única normalização de busca do Core (RD-1229). */
export const normalizarBusca = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const soDigitos = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');
const rotulo = (c: ClienteLista): string => c.nome_fantasia?.trim() || c.razao_social;

/** Clientes do escopo do perfil (RN-CORE-04) + busca e filtros. O filtro nunca amplia o escopo. */
export function listarClientes<C extends ClienteLista>(
  clientes: C[],
  perfil: Perfil,
  conjuntos: ConjuntosDoUsuario,
  filtro: FiltroClientes = {},
  fin: ConjuntosFinanceiros = {},
): C[] {
  const visiveis = clientesVisiveis(perfil, conjuntos);
  const q = normalizarBusca(filtro.q);
  const qDigitos = soDigitos(filtro.q);
  return clientes
    .filter((c) => clienteNoEscopo(c.id, visiveis))
    .filter((c) => !filtro.cidade || normalizarBusca(c.cidade) === normalizarBusca(filtro.cidade))
    .filter((c) => !filtro.segmento || normalizarBusca(c.segmento) === normalizarBusca(filtro.segmento))
    .filter((c) => !filtro.bloqueado || (fin.bloqueados?.has(c.id) ?? false))
    .filter((c) => !filtro.comVencidos || (fin.comVencidos?.has(c.id) ?? false))
    .filter((c) => {
      if (!q) return true;
      if ([c.razao_social, c.nome_fantasia, c.external_id, c.cidade].some((t) => normalizarBusca(t).includes(q))) return true;
      return qDigitos.length >= 3 && soDigitos(c.documento).includes(qDigitos);
    })
    .sort((a, b) => rotulo(a).localeCompare(rotulo(b), 'pt-BR', { sensitivity: 'base' }));
}

export interface UsuariosDoUsuario {
  proprio: string;
  /** Usuários da equipe direta (supervisor). */
  equipe: ReadonlySet<string>;
  /** Usuários das equipes abaixo (gerente). */
  equipesAbaixo: ReadonlySet<string>;
}

/** De quem o usuário vê dados (visitas, rotas, metas, pedidos): gêmeo de `clientesVisiveis`. `'tenant'` = sem filtro (RLS isola o tenant). */
export function escopoDeUsuarios(perfil: Perfil, u: UsuariosDoUsuario): ReadonlySet<string> | 'tenant' {
  switch (escopoDeCarteira(perfil)) {
    case 'carteira':
      return new Set([u.proprio]);
    case 'equipe':
      return new Set([u.proprio, ...u.equipe]);
    case 'equipes_abaixo':
      return new Set([u.proprio, ...u.equipe, ...u.equipesAbaixo]);
    case 'tenant':
      return 'tenant';
  }
}

/**
 * RN-CORE-04 / RF-CORE-02: o papel do vínculo da carteira combina com o perfil do usuário — papel `vendedor` é de
 * usuário vendedor e `promotor` de usuário promotor (o promotor nunca cria pedido, RN-PRO-01; carteira de vendedor
 * dada a promotor liberaria o que o promotor não pode).
 */
export function papelCompativel(perfil: Perfil, papel: 'vendedor' | 'promotor'): boolean {
  return perfil === papel;
}
