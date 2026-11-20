/** Busca tolerante: minúsculas, sem acento e sem espaço nas pontas. */
export const normalizarBusca = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const soDigitos = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');

/** Dígitos do termo para buscar no documento (3 ou mais, para não casar qualquer número); `null` = não busca documento. */
export const digitosDeBuscaDoDocumento = (termo: string): string | null => {
  const d = soDigitos(termo);
  return d.length >= 3 ? d : null;
};
/** O CNPJ casa com e sem máscara: os dígitos do termo contidos nos do documento. */
export const documentoCasa = (termo: string, documento: string | null | undefined): boolean => {
  const d = digitosDeBuscaDoDocumento(termo);
  return d !== null && soDigitos(documento).includes(d);
};
/** Rótulo do campo de busca de clientes, o mesmo texto em toda superfície (regra de `clienteCasaBusca`). */
export const ROTULO_BUSCA_CLIENTE = 'Código, CNPJ ou nome';
/** Menor termo que a busca de clientes do BKO aceita (carteira e editor de rota); a Carteira do app filtra desde o primeiro caractere. */
export const MINIMO_BUSCA_CLIENTE_BKO = 3;
export const ROTULO_BUSCA_CLIENTE_BKO = `${ROTULO_BUSCA_CLIENTE} (mínimo ${MINIMO_BUSCA_CLIENTE_BKO} caracteres)`;

/** Acentos do português e seus equivalentes sem acento (mesma correspondência de `normalizarBusca`), para o `translate` do SQL da API. */
export const ACENTOS_PT = 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
export const SEM_ACENTOS_PT = 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN';
/** Expressão SQL que normaliza a coluna como `normalizarBusca` (sem caixa, sem acento; o `translate` vem antes do `lower` porque, com locale C, o `lower` do Postgres não converte maiúscula acentuada). `coluna` é identificador fixo do código, nunca dado do usuário. */
export const sqlBuscaNormalizada = (coluna: string): string => `lower(translate(${coluna}, '${ACENTOS_PT}', '${SEM_ACENTOS_PT}'))`;

/** Palavras do termo, normalizadas; vazio = sem palavras. */
export const palavrasDaBusca = (termo: string | null | undefined): string[] => normalizarBusca(termo).split(/\s+/).filter(Boolean);

/**
 * A única regra de casamento da busca de clientes (API, app e BKO; mora em `contracts` porque o Vendedor só importa `contracts`):
 * palavra por palavra, sem acento e sem caixa. Cada palavra precisa estar no código (external_id), na razão social, no nome
 * fantasia ou no CNPJ (3 dígitos ou mais, com ou sem máscara); todas as palavras precisam casar. Cidade e bairro não entram.
 * Termo vazio casa tudo.
 */
export function clienteCasaBusca(
  termo: string | null | undefined,
  c: { razao_social?: string | null; nome_fantasia?: string | null; external_id?: string | null; documento?: string | null },
): boolean {
  const campos = [c.razao_social, c.nome_fantasia, c.external_id].map(normalizarBusca);
  return palavrasDaBusca(termo).every((p) => campos.some((t) => t.includes(p)) || documentoCasa(p, c.documento));
}
