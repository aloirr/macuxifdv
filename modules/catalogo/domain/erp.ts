/**
 * Preço e estoque vindos do ERP (`integracao.preco|estoque.atualizado@1`; T-0066, RN-INT-02). Planos puros: o consumidor
 * da API só executa o plano. Inativação do ERP nunca apaga: o item sai da vitrine (soft delete) e volta se o ERP reativar.
 */
export interface EventoErpBase<R> {
  external_id: string;
  acao: 'criado' | 'atualizado' | 'inativado';
  registro?: (R & { ativo?: boolean | undefined }) | undefined;
}

export interface RegistroPrecoErp {
  tabela_external_id: string;
  tabela_nome: string;
  vigencia_inicio: string;
  vigencia_fim?: string | null | undefined;
  produto_external_id: string;
  preco_cents: number;
}
export interface RegistroEstoqueErp {
  deposito_external_id: string;
  deposito_nome?: string | null | undefined;
  produto_external_id: string;
  saldo: number;
}

export type PlanoPrecoErp =
  | { tipo: 'ignorar' }
  | { tipo: 'inativar'; external_id: string }
  | {
      tipo: 'upsert';
      linha: { external_id: string; tabela_external_id: string; tabela_nome: string; produto_external_id: string; preco_cents: number; vigencia_inicio: string; vigencia_fim: string | null };
    };

export function planejarPrecoDoErp(e: EventoErpBase<RegistroPrecoErp>): PlanoPrecoErp {
  if (e.acao === 'inativado') return { tipo: 'inativar', external_id: e.external_id };
  const r = e.registro;
  if (!r) return { tipo: 'ignorar' };
  // A tabela do Catálogo exige preço > 0: preço zerado no ERP = sem preço naquela tabela (RN-CAT-06).
  if (r.ativo === false || !(r.preco_cents > 0)) return { tipo: 'inativar', external_id: e.external_id };
  return {
    tipo: 'upsert',
    linha: {
      external_id: e.external_id,
      tabela_external_id: r.tabela_external_id,
      tabela_nome: r.tabela_nome.trim() || r.tabela_external_id,
      produto_external_id: r.produto_external_id,
      preco_cents: Math.round(r.preco_cents),
      vigencia_inicio: r.vigencia_inicio,
      vigencia_fim: r.vigencia_fim ?? null,
    },
  };
}

export type PlanoEstoqueErp =
  | { tipo: 'ignorar' }
  | { tipo: 'inativar'; external_id: string }
  | { tipo: 'upsert'; linha: { external_id: string; deposito_external_id: string; deposito_nome: string; produto_external_id: string; saldo: number } };

export function planejarEstoqueDoErp(e: EventoErpBase<RegistroEstoqueErp>): PlanoEstoqueErp {
  if (e.acao === 'inativado') return { tipo: 'inativar', external_id: e.external_id };
  const r = e.registro;
  if (!r) return { tipo: 'ignorar' };
  if (r.ativo === false) return { tipo: 'inativar', external_id: e.external_id };
  return {
    tipo: 'upsert',
    linha: {
      external_id: e.external_id,
      deposito_external_id: r.deposito_external_id,
      deposito_nome: r.deposito_nome?.trim() || r.deposito_external_id,
      produto_external_id: r.produto_external_id,
      saldo: r.saldo,
    },
  };
}

export interface RegistroNoErp {
  codigo: string;
  nome: string;
  pai_external_id?: string | null | undefined;
  nivel: number;
  ordem?: number | undefined;
}

export type PlanoNoErp =
  | { tipo: 'ignorar' }
  | { tipo: 'inativar'; external_id: string }
  | { tipo: 'upsert'; linha: { external_id: string; codigo: string; nome: string; pai_external_id: string | null; nivel: number; ordem: number } };

/** RF-CAT-04: nó da árvore do ERP. Raiz = nível 1 sem pai; filho = nível 2 ou mais (mesma regra do banco). */
export function planejarNoDoErp(e: EventoErpBase<RegistroNoErp>): PlanoNoErp {
  if (e.acao === 'inativado') return { tipo: 'inativar', external_id: e.external_id };
  const r = e.registro;
  if (!r) return { tipo: 'ignorar' };
  if (r.ativo === false) return { tipo: 'inativar', external_id: e.external_id };
  const codigo = r.codigo.trim();
  const nome = r.nome.trim();
  const pai = r.pai_external_id?.trim() || null;
  if (!codigo || !nome || !Number.isInteger(r.nivel) || r.nivel < 1 || r.nivel > 8) return { tipo: 'ignorar' };
  if ((pai === null) !== (r.nivel === 1)) return { tipo: 'ignorar' };
  return { tipo: 'upsert', linha: { external_id: e.external_id, codigo, nome, pai_external_id: pai, nivel: r.nivel, ordem: Math.trunc(r.ordem ?? 0) } };
}

export interface RegistroProdutoNoErp {
  catalogo_no_external_id?: string | null | undefined;
}

export type PlanoProdutoNoErp =
  | { tipo: 'ignorar' }
  | { tipo: 'desvincular'; produto_external_id: string }
  | { tipo: 'vincular'; produto_external_id: string; no_external_id: string; external_id: string };

/** RF-CAT-04: o Catálogo lê do produto do ERP só o nó da árvore (o cadastro do produto é do Core). Um nó por produto. */
export function planejarProdutoNoDoErp(e: EventoErpBase<RegistroProdutoNoErp>): PlanoProdutoNoErp {
  if (e.acao === 'inativado') return { tipo: 'desvincular', produto_external_id: e.external_id };
  const r = e.registro;
  if (!r) return { tipo: 'ignorar' };
  const no = r.catalogo_no_external_id?.trim();
  if (!no || r.ativo === false) return { tipo: 'desvincular', produto_external_id: e.external_id };
  return { tipo: 'vincular', produto_external_id: e.external_id, no_external_id: no, external_id: e.external_id };
}

// ---------- cadastro do Catálogo vindo do ERP: aplicação, oferece junto e etiquetas (T-0084 C2, T-0085 K11) ----------
export interface RegistroCadastroCatalogoErp {
  aplicacao?: string | null | undefined;
  oferece_junto?: readonly string[] | null | undefined;
  etiquetas?: readonly string[] | null | undefined;
}

/** Cada campo ausente (`undefined`) = não altera; `null` ou lista vazia = limpa. */
export interface PlanoCadastroCatalogoErp {
  aplicacao?: string | null;
  /** `external_id` dos produtos de "Oferece junto" (até 5, sem repetir nem o próprio produto). */
  ofereceJunto?: string[];
  etiquetas?: string[];
}

const ETIQUETAS_MAX = 4;
const ETIQUETA_MAX = 20;
const OFERECE_JUNTO_MAX = 5;

/**
 * RN-CAT-11 / RN-CAT-09: o que o Catálogo grava do produto do ERP além do nó da árvore. A aplicação já chega cortada em 2.000
 * pelo Hub; se o tenant baixou `aplicacao_max_cadastro`, corta de novo (sem aviso). "Oferece junto" fica nos 5 primeiros e
 * etiquetas nas 4 primeiras (de até 20 caracteres), como o Hub (K11). Produto inativado do ERP não altera o cadastro.
 */
export function planejarCadastroCatalogoDoErp(e: EventoErpBase<RegistroCadastroCatalogoErp>, opcoes: { aplicacaoMax: number }): PlanoCadastroCatalogoErp {
  const r = e.registro;
  if (e.acao === 'inativado' || !r) return {};
  const plano: PlanoCadastroCatalogoErp = {};
  if (r.aplicacao !== undefined) {
    const t = r.aplicacao === null ? '' : r.aplicacao.trim();
    plano.aplicacao = t === '' ? null : Array.from(t).slice(0, opcoes.aplicacaoMax).join('').trimEnd();
  }
  if (r.oferece_junto !== undefined) {
    const ids = (r.oferece_junto ?? []).map((x) => x.trim()).filter((x) => x !== '' && x !== e.external_id);
    plano.ofereceJunto = [...new Set(ids)].slice(0, OFERECE_JUNTO_MAX);
  }
  if (r.etiquetas !== undefined) {
    const et = (r.etiquetas ?? []).map((x) => x.trim()).filter((x) => x !== '').map((x) => Array.from(x).slice(0, ETIQUETA_MAX).join(''));
    plano.etiquetas = [...new Set(et)].slice(0, ETIQUETAS_MAX);
  }
  return plano;
}
