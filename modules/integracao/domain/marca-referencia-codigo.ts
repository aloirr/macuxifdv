/**
 * Código da marca da referência cruzada quando a base do ERP não traz (RN-CAT-09; R-20261115-094000-alexandre, item 6).
 * A carga mantém a lista de marcas por upsert pelo CÓDIGO; sem código, a marca da referência não entraria. Então, onde a base só tem
 * o nome da marca da referência:
 *  1. se a mesma marca (mesmo nome normalizado) já tem código do ERP na base — no `marca_codigo` do produto ou noutra referência —,
 *     usa esse código (com mais de um, o menor, para o resultado não depender da ordem das linhas);
 *  2. senão, gera `MXN-` + os 8 primeiros hexadecimais (maiúsculos) do SHA-256 do nome normalizado: o mesmo nome dá sempre o mesmo código.
 * Nome normalizado: sem acento, em maiúsculas, com qualquer sequência de espaços virando um espaço, sem espaço nas pontas.
 * O prefixo `MXN-` separa o código gerado dos códigos do ERP. Função pura, sem I/O.
 */
import { sha256Hex } from './sha256';

export const PREFIXO_CODIGO_MARCA_GERADO = 'MXN-';

export function nomeMarcaNormalizado(nome: string): string {
  return nome.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function codigoMarcaPeloNome(nome: string): string {
  const n = nomeMarcaNormalizado(nome);
  if (n === '') throw new Error('codigoMarcaPeloNome: nome da marca vazio.');
  return `${PREFIXO_CODIGO_MARCA_GERADO}${sha256Hex(n).slice(0, 8).toUpperCase()}`;
}

export interface ResumoCodigosMarcaReferencia {
  /** Marcas distintas (por nome normalizado) que ganharam código gerado pelo nome. */
  codigosGerados: number;
  /** Marcas distintas cujo código veio de outra coluna da base (ERP). */
  codigosDoErp: number;
  /** Células `marca_referencia_codigo_N` preenchidas. */
  celulasPreenchidas: number;
}

type Linha = Readonly<Record<string, string>>;

/** Completa `marca_referencia_codigo_1..n` das linhas do produto.csv (cada linha é coluna → valor). Devolve linhas novas. */
export function completarCodigosMarcaReferencia(linhas: readonly Linha[], nReferencias: number): { linhas: Record<string, string>[]; resumo: ResumoCodigosMarcaReferencia } {
  const nums = Array.from({ length: nReferencias }, (_, i) => i + 1);
  const doErp = new Map<string, string>();
  const anotar = (nome: string | undefined, codigo: string | undefined): void => {
    const n = nomeMarcaNormalizado(nome ?? '');
    const c = (codigo ?? '').trim();
    if (n === '' || c === '') return;
    const atual = doErp.get(n);
    if (atual === undefined || c < atual) doErp.set(n, c);
  };
  for (const l of linhas) {
    anotar(l.marca, l.marca_codigo);
    for (const i of nums) anotar(l[`marca_referencia_${i}`], l[`marca_referencia_codigo_${i}`]);
  }

  const gerados = new Map<string, string>();
  const usadosDoErp = new Set<string>();
  const nomePorCodigoGerado = new Map<string, string>();
  let celulasPreenchidas = 0;
  const saida = linhas.map((l) => {
    const nova: Record<string, string> = { ...l };
    for (const i of nums) {
      const colCodigo = `marca_referencia_codigo_${i}`;
      const n = nomeMarcaNormalizado(l[`marca_referencia_${i}`] ?? '');
      if (n === '' || (l[colCodigo] ?? '').trim() !== '') continue;
      let codigo = doErp.get(n);
      if (codigo !== undefined) usadosDoErp.add(n);
      else {
        codigo = codigoMarcaPeloNome(n);
        const outro = nomePorCodigoGerado.get(codigo);
        if (outro !== undefined && outro !== n) throw new Error(`Dois nomes de marca diferentes deram o mesmo código gerado (${codigo}); informe o código de um deles na base.`);
        nomePorCodigoGerado.set(codigo, n);
        gerados.set(n, codigo);
      }
      nova[colCodigo] = codigo;
      celulasPreenchidas++;
    }
    return nova;
  });
  return { linhas: saida, resumo: { codigosGerados: gerados.size, codigosDoErp: usadosDoErp.size, celulasPreenchidas } };
}
