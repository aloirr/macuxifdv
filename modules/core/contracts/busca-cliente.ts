/**
 * Busca de clientes: a única regra de casamento (código, CNPJ, razão social, nome fantasia), usada por API, app e BKO.
 * Mora em `contracts` porque o Vendedor só importa `contracts`; `domain/clientes.ts` reexporta.
 */

/** Busca tolerante: minúsculas, sem acento e sem espaço nas pontas. A única normalização de busca do Core (RD-1229). */
export const normalizarBusca = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const soDigitos = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');

/** Dígitos do termo para buscar no documento (3 ou mais, para não casar qualquer número); `null` = não busca documento. A única regra da busca por documento (API e app). */
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

/**
 * A única regra de casamento da busca de clientes (decisões R-20261120-062210 e R-20261120-070340): termo contido no
 * código (external_id), na razão social ou no nome fantasia, sem acento e sem caixa; CNPJ só com 3 dígitos ou mais,
 * com ou sem máscara. Cidade e bairro não entram. Termo vazio casa tudo.
 */
export function clienteCasaBusca(
  termo: string | null | undefined,
  c: { razao_social?: string | null; nome_fantasia?: string | null; external_id?: string | null; documento?: string | null },
): boolean {
  const q = normalizarBusca(termo);
  if (!q) return true;
  if ([c.razao_social, c.nome_fantasia, c.external_id].some((t) => normalizarBusca(t).includes(q))) return true;
  return documentoCasa(q, c.documento);
}
