/**
 * Cadastro base de produto vindo do ERP (ADR-0005: `core.produto` é do Core; preço e estoque são do Catálogo).
 * O Core consome `integracao.produto.atualizado@1` e aplica com esta regra pura:
 * - `criado`/`atualizado` → upsert por `external_id` (idempotente: reentrega do mesmo evento dá o mesmo resultado);
 * - `inativado` → `ativo = false` (nunca apaga, RN-INT-06); o registro inativo some do sync do aparelho pelo flag;
 * - `ativo: false` no registro também inativa; evento sem registro em criado/atualizado é ignorado (defeito do Hub).
 * Evento mais antigo que o já aplicado (`alterado_em`) não sobrescreve (entrega fora de ordem).
 */
/**
 * Forma do payload de `integracao.produto.atualizado@1` que o Core lê (subconjunto estrutural do schema do Hub:
 * `EVENTOS_ATUALIZADO.produto` + `ProdutoPayload` em `@macuxi/integracao/contracts`). Estrutural de propósito: o
 * consumidor real (handler no `definirModuloApi`) valida com o schema do Hub antes de chamar a regra, e o Core não
 * ganha dependência de pacote do Integracao só para tipo.
 */
export interface EventoProdutoAtualizado {
  external_id: string;
  acao: 'criado' | 'atualizado' | 'inativado';
  ocorrido_em: string;
  registro?:
    | {
        external_id: string;
        alterado_em: string;
        ativo?: boolean;
        sku: string;
        ean?: string | null;
        nome: string;
        marca?: string | null;
        categoria?: string | null;
        unidade: string;
        /** RN-CORE-19: embalagem (medida + quantidade de unidades), opcional e tudo-ou-nada. */
        embalagem_medida?: string | null;
        embalagem_quantidade?: number | null;
      }
    | undefined;
}

export interface LinhaProdutoErp {
  external_id: string;
  sku: string;
  ean: string | null;
  nome: string;
  marca: string | null;
  categoria: string | null;
  unidade: string;
  /** RN-CORE-19: `null` = o ERP não informou (o consumidor mantém a embalagem que o BKO cadastrou). */
  embalagem_medida: string | null;
  embalagem_quantidade: number | null;
  ativo: boolean;
  /** Instante da alteração no ERP (guarda contra entrega fora de ordem). */
  alterado_em: string;
}

export type PlanoProduto =
  | { tipo: 'upsert'; linha: LinhaProdutoErp }
  | { tipo: 'inativar'; external_id: string; alterado_em: string }
  | { tipo: 'ignorar'; motivo: 'sem_registro' | 'mais_antigo_que_o_aplicado' };

const nulo = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === '' ? null : v.trim());

/**
 * RN-CORE-19: embalagem vinda do ERP. Vale só medida + quantidade inteira > 1, com medida diferente da unidade; qualquer
 * outra combinação é descartada (o produto entra sem embalagem; o resto do cadastro não é perdido).
 */
function embalagemDoErp(unidade: string, medida: string | null | undefined, quantidade: number | null | undefined): { embalagem_medida: string | null; embalagem_quantidade: number | null } {
  const sigla = (medida ?? '').trim().toUpperCase();
  if (sigla === '' || typeof quantidade !== 'number' || !Number.isInteger(quantidade) || quantidade <= 1 || sigla === unidade) return { embalagem_medida: null, embalagem_quantidade: null };
  return { embalagem_medida: sigla, embalagem_quantidade: quantidade };
}

/** Decide o que fazer com o evento; `aplicadoAlteradoEm` = `alterado_em` do último evento já aplicado a este produto (se houver). */
export function planejarProdutoDoErp(evento: EventoProdutoAtualizado, aplicadoAlteradoEm: string | null = null): PlanoProduto {
  if (evento.acao === 'inativado') return { tipo: 'inativar', external_id: evento.external_id, alterado_em: evento.ocorrido_em };
  const r = evento.registro;
  if (!r) return { tipo: 'ignorar', motivo: 'sem_registro' };
  if (aplicadoAlteradoEm && Date.parse(r.alterado_em) < Date.parse(aplicadoAlteradoEm)) return { tipo: 'ignorar', motivo: 'mais_antigo_que_o_aplicado' };
  const unidade = r.unidade.trim().toUpperCase();
  const embalagem = embalagemDoErp(unidade, r.embalagem_medida, r.embalagem_quantidade);
  return {
    tipo: 'upsert',
    linha: {
      external_id: evento.external_id,
      sku: r.sku.trim(),
      ean: nulo(r.ean),
      nome: r.nome.trim(),
      marca: nulo(r.marca),
      categoria: nulo(r.categoria),
      unidade,
      ...embalagem,
      ativo: r.ativo !== false,
      alterado_em: r.alterado_em,
    },
  };
}
