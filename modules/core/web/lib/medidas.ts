/**
 * Apoio da tela de medidas (RN-CORE-19; RF-CORE-14): funções puras, sem React nem rede.
 */
import type { Medida, ProdutoPreco } from '../../contracts';
import { normalizarSigla, validarMedida, validarMedidasDoProduto } from '../../domain';

/** "UN" ou "UN · CX c/ 12" (medida da unidade e, se houver, a embalagem com a quantidade de unidades). */
export function rotuloMedidaDoProduto(p: Pick<ProdutoPreco, 'unidade' | 'embalagem_medida' | 'embalagem_quantidade'>): string {
  return p.embalagem_medida && p.embalagem_quantidade ? `${p.unidade} · ${p.embalagem_medida} c/ ${p.embalagem_quantidade}` : p.unidade;
}

/**
 * Medidas que o formulário do produto oferece: só as ativas, mais a que o produto já usa (mesmo inativa, para não sumir da
 * tela do produto que a mantém). Ordenadas por sigla.
 */
export function opcoesDeMedida(medidas: readonly Pick<Medida, 'sigla' | 'descricao' | 'ativo'>[], atuais: readonly (string | null | undefined)[] = []) {
  const manter = new Set(atuais.filter((s): s is string => Boolean(s)).map(normalizarSigla));
  return medidas.filter((m) => m.ativo || manter.has(m.sigla)).sort((a, b) => a.sigla.localeCompare(b.sigla));
}

/** Erro do formulário da medida (mesma regra da API), ou `null` se pode salvar. */
export function erroDoFormularioDeMedida(sigla: string, descricao: string): string | null {
  const v = validarMedida({ sigla, descricao });
  return v.ok ? null : v.mensagem;
}

export interface RascunhoMedidasProduto {
  unidade: string;
  embalagem_medida: string;
  /** Texto digitado; vazio = sem embalagem. */
  embalagem_quantidade: string;
}

/** Corpo do `PUT /produtos/:id/medidas` ou o erro em português; confere contra as medidas do tenant como a API. */
export function corpoDasMedidasDoProduto(
  r: RascunhoMedidasProduto,
  medidas: readonly Pick<Medida, 'sigla' | 'ativo'>[],
  atuais?: { unidade?: string | null; embalagem_medida?: string | null },
): { ok: true; corpo: { unidade: string; embalagem_medida: string | null; embalagem_quantidade: number | null } } | { ok: false; mensagem: string } {
  const texto = r.embalagem_quantidade.trim();
  const quantidade = texto === '' ? null : Number(texto.replace(',', '.'));
  const v = validarMedidasDoProduto(
    { unidade: r.unidade, embalagem_medida: r.embalagem_medida === '' ? null : r.embalagem_medida, embalagem_quantidade: quantidade },
    new Map(medidas.map((m) => [m.sigla, { ativo: m.ativo }])),
    atuais,
  );
  return v.ok ? { ok: true, corpo: v.valor } : { ok: false, mensagem: v.mensagem };
}
