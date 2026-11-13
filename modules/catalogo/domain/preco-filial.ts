/**
 * Filial do preço (RN-CORE-39, RN-CAT-06; T-0149, ADR 0040): a tabela de preço do cliente vale por filial. Função pura:
 * a API (SQL) e o aparelho (linhas locais) carregam "em quais filiais a tabela tem item vivo" e chamam esta função,
 * então decidem igual.
 */

export type OrigemFilialPreco = 'cliente' | 'padrao';

export interface EntradaFilialDoPreco {
  /** Tabela de preço ativa do cliente; nula = sem tabela (a filial não importa, não haverá preço). */
  tabelaId: string | null;
  /** Filial efetiva do cliente (`core.filiais@1`; nunca nula, sem informação é a padrão). */
  filialCliente: string;
  filialPadrao: string;
  /** Filiais em que a tabela do cliente tem algum item vivo (qualquer produto, qualquer vigência). */
  filiaisComItens: readonly string[];
}

export interface FilialDoPreco {
  filialId: string;
  origem: OrigemFilialPreco;
}

/**
 * RN-CORE-39: fallback POR TABELA, não por item. A tabela do cliente com algum item na filial dele usa essa filial; sem
 * item nenhum nela, usa os itens da MESMA tabela na filial padrão. Escolhida a filial, produto sem item nela continua
 * "Sem preço para este cliente" (RN-CAT-06): nunca cai produto a produto na padrão.
 */
export function filialDoPreco(e: EntradaFilialDoPreco): FilialDoPreco {
  if (e.tabelaId === null || e.filialCliente === e.filialPadrao || e.filiaisComItens.includes(e.filialCliente)) {
    return { filialId: e.filialCliente, origem: 'cliente' };
  }
  return { filialId: e.filialPadrao, origem: 'padrao' };
}

/** Linha local de `filial` (Core) que o aparelho usa; só estes campos interessam ao Catálogo. */
export interface LinhaFilialLocal {
  id: string;
  nome: string;
  padrao: boolean;
  ativo: boolean;
  deleted_at?: string | null;
}

export interface FilialLocalDoCliente {
  /** Filial efetiva do cliente. */
  filialCliente: string;
  filialPadrao: string;
  /** Nome por id de filial (rótulo do estoque). */
  nomes: Readonly<Record<string, string>>;
}

/**
 * RN-CORE-39 no aparelho (mesma regra de `filialEfetiva` do Core, sobre as linhas locais): a filial do cliente vale se está viva
 * e ativa; senão (nula, apagada, inativa) a padrão. `null` = o aparelho ainda não recebeu as filiais (primeiro sync ou servidor
 * antigo): quem chama não filtra por filial, como antes da T-0149.
 */
export function filialDoClienteLocal(filialIdDoCliente: string | null | undefined, filiais: readonly LinhaFilialLocal[]): FilialLocalDoCliente | null {
  const vivas = filiais.filter((f) => !f.deleted_at);
  const padrao = vivas.find((f) => f.padrao);
  if (!padrao) return null;
  const propria = filialIdDoCliente ? vivas.find((f) => f.id === filialIdDoCliente && f.ativo) : undefined;
  return { filialCliente: (propria ?? padrao).id, filialPadrao: padrao.id, nomes: Object.fromEntries(vivas.map((f) => [f.id, f.nome])) };
}

export type FilialDaTela = { ok: true; filialId: string } | { ok: false };

/**
 * RN-CORE-39 no BKO (Tabelas de preço): a tela mostra os itens de UMA filial. Sem filial escolhida vale a padrão; filial que não é
 * do tenant é recusada (nunca mistura as linhas de filiais diferentes do mesmo produto).
 */
export function filialDaTelaDePreco(escolhida: string | null | undefined, padrao: string, existentes: readonly string[]): FilialDaTela {
  if (!escolhida) return { ok: true, filialId: padrao };
  return existentes.includes(escolhida) ? { ok: true, filialId: escolhida } : { ok: false };
}
