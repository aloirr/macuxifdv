/**
 * Conferência da ordem do `external_id` (T-0099, RN-INT-05) para o `conector testar-conexao`.
 *
 * O Conector compara o par (alterado_em, external_id) em ordem ORDINAL/binária (`compararCursor`) e descarta como "repetida" a
 * linha cujo par não é maior que o cursor de leitura. Se o banco do ERP filtra/ordena o `external_id` com outra colação (SQL Server
 * `CI_AS`, Oracle `NLS_SORT` linguístico, PostgreSQL `en_US`/ICU) ou como NÚMERO, as duas ordens divergem e, num UPDATE em massa no
 * mesmo milissegundo que cruza a página, o Conector perde linhas sem avisar (conector.md §5).
 *
 * Como confere, usando a PRÓPRIA consulta da entidade (com os COLLATE que ela tiver), sem escrever nada:
 * 1. Amostra (cursor no início): a primeira linha X = (T, x) é a menor da consulta na ordem do banco. Pares vizinhos com o mesmo
 *    `alterado_em` fora da ordem binária já são divergência (ORDER BY).
 * 2. Controle: com o cursor (T, x) a linha X não pode voltar primeiro. Se voltar (precisão do `alterado_em` maior que ms, consulta
 *    que não filtra pelo cursor…), a conferência é inconclusiva e nada é afirmado.
 * 3. Sondas: para cursores (T, y) escolhidos onde a ordem binária e as colações comuns discordam (caixa trocada, letra vizinha da
 *    outra caixa, número mais longo com dígito menor), a ordem binária diz se X deve voltar (x > y). Se o banco discordar
 *    (X volta primeiro ou não), a ordem diverge — e o aviso traz o exemplo concreto.
 * Só lê; nunca lança: falha de consulta vira "inconclusiva" (o erro de consulta já aparece no teste da entidade).
 */
import type { Entidade } from './config/entidades';
import type { EntidadeConfig } from './config/esquema';
import type { ExecutorSql } from './erp/driver';
import { compararCursor, mapearLinha } from './mapeamento';
import { mascararTexto } from './log/mascara';

export type TipoErp = 'sqlserver' | 'postgres' | 'oracle';

export type ResultadoOrdem =
  | { situacao: 'ok'; sondas: number }
  | { situacao: 'divergente'; exemplo: string }
  | { situacao: 'inconclusiva'; motivo: string };

/** Como deixar a ordem do banco igual à do Conector, por tipo de ERP (mesmo texto de conector.md §5). */
export const ORIENTACAO_ORDEM: Record<TipoErp, string> = {
  sqlserver: 'use "external_id COLLATE Latin1_General_BIN2" no filtro (external_id COLLATE Latin1_General_BIN2 > :cursor_external_id) e no ORDER BY',
  oracle: "use NLSSORT(external_id, 'NLS_SORT=BINARY') > NLSSORT(:cursor_external_id, 'NLS_SORT=BINARY') no filtro e NLSSORT(external_id, 'NLS_SORT=BINARY') no ORDER BY",
  postgres: 'use external_id COLLATE "C" no filtro (external_id COLLATE "C" > :cursor_external_id) e no ORDER BY',
};

/** Texto do aviso completo (exemplo + orientação), pronto para o `testar-conexao`. */
export function avisoOrdemDivergente(entidade: Entidade, tipo: TipoErp, exemplo: string): string {
  return (
    `${entidade}: a ordem do external_id no banco do ERP diverge da ordem do Conector (binária/ordinal). ${exemplo} ` +
    `Colação não binária (ou chave numérica) faz o Conector PERDER linhas sem avisar quando muitas mudam no mesmo milissegundo. ` +
    `Corrija a consulta: ${ORIENTACAO_ORDEM[tipo]} (conector.md §5). Chave numérica: devolva-a como texto e ordene esse texto em binário.`
  );
}

const MAX_EXIBIR = 40;
/** external_id é a chave interna do ERP (nunca CPF/CNPJ, conector.md §5); ainda assim passa pela máscara e é encurtado. */
function exibir(id: string): string {
  const t = id.length > MAX_EXIBIR ? `${id.slice(0, MAX_EXIBIR - 1)}…` : id;
  return JSON.stringify(mascararTexto(t));
}

const ehMaiuscula = (c: string) => c >= 'A' && c <= 'Z';
const ehMinuscula = (c: string) => c >= 'a' && c <= 'z';

/**
 * Cursores-sonda para o `external_id` x: valores em que a ordem binária discorda das colações comuns. Função pura (testada).
 * - caixa trocada inteira (`abc` → `ABC`, `ABC` → `abc`): `CI` empata; `CS` linguístico põe minúscula antes;
 * - na 1ª letra, a vizinha da outra caixa (`B` → `a`, `b` → `C`) e só ela no fim (`xB9` → `xa`): binário põe toda maiúscula antes
 *   de toda minúscula, a colação linguística põe `a` antes de `B`;
 * - só dígitos: número mais longo com um dígito menor (`123` → `1229`): binário diz menor, a ordem numérica diz maior.
 */
export function sondasPara(x: string): string[] {
  const ys: string[] = [x.toUpperCase(), x.toLowerCase()];
  const i = x.split('').findIndex((c) => ehMaiuscula(c) || ehMinuscula(c));
  if (i >= 0) {
    const c = x[i] as string;
    ys.push(x.slice(0, i) + (ehMaiuscula(c) ? c.toLowerCase() : c.toUpperCase()) + x.slice(i + 1));
  }
  // vizinha da outra caixa na 1ª letra que tem vizinha (`A` não tem minúscula anterior; `z` não tem maiúscula seguinte)
  const j = x.split('').findIndex((c) => (ehMaiuscula(c) && c !== 'A') || (ehMinuscula(c) && c !== 'z'));
  if (j >= 0) {
    const c = x[j] as string;
    const viz = ehMaiuscula(c) ? String.fromCharCode(c.toLowerCase().charCodeAt(0) - 1) : String.fromCharCode(c.toUpperCase().charCodeAt(0) + 1);
    ys.push(x.slice(0, j) + viz + x.slice(j + 1), x.slice(0, j) + viz);
  }
  if (/^\d+$/.test(x)) {
    const k = x.search(/[1-9][0]*$/); // último dígito não zero
    if (k >= 0) ys.push(`${x.slice(0, k)}${Number(x[k]) - 1}${'9'.repeat(x.length - k)}`);
  }
  return [...new Set(ys)].filter((y) => y !== '' && y !== x);
}

interface Lida {
  external_id: string;
  alterado_ms: number;
}

function ler(cfg: EntidadeConfig, linhas: Record<string, unknown>[]): (Lida | null)[] {
  return linhas.map((l, i) => {
    try {
      const m = mapearLinha(cfg, l, i);
      return m.external_id !== null && m.alterado_ms !== null ? { external_id: m.external_id, alterado_ms: m.alterado_ms } : null;
    } catch {
      return null;
    }
  });
}

/**
 * Confere a ordem do `external_id` da consulta da entidade contra a ordem do Conector. `amostra`: linhas já lidas com o cursor no
 * início (o `testar-conexao` reaproveita a leitura dele); sem amostra, lê 5 linhas.
 */
export async function conferirOrdemExternalId(erp: ExecutorSql, cfg: EntidadeConfig, amostra?: Record<string, unknown>[]): Promise<ResultadoOrdem> {
  const consultar = (alterado_ms: number, external_id: string, limite: number) =>
    erp.consultar(cfg.consulta, { cursor_alterado_em: new Date(alterado_ms), cursor_alterado_em_ms: alterado_ms, cursor_external_id: external_id, limite });
  try {
    const linhas = amostra ?? (await consultar(0, '', 5));
    const lidas = ler(cfg, linhas);

    // 1) ORDER BY: vizinhos com o mesmo instante precisam vir em ordem binária crescente
    for (let i = 1; i < lidas.length; i++) {
      const a = lidas[i - 1];
      const b = lidas[i];
      if (!a || !b || a.alterado_ms !== b.alterado_ms) continue;
      const pa = { alterado_em: new Date(a.alterado_ms).toISOString(), external_id: a.external_id };
      const pb = { alterado_em: new Date(b.alterado_ms).toISOString(), external_id: b.external_id };
      if (compararCursor(pa, pb) > 0) {
        return {
          situacao: 'divergente',
          exemplo: `Exemplo: no mesmo alterado_em o banco devolveu ${exibir(a.external_id)} antes de ${exibir(b.external_id)}, mas na ordem do Conector ${exibir(b.external_id)} vem antes.`,
        };
      }
    }

    const x = lidas[0];
    if (!x) return { situacao: 'inconclusiva', motivo: linhas.length === 0 ? 'a consulta não devolveu linhas' : 'a primeira linha não tem external_id e alterado_em legíveis' };
    const voltaPrimeiro = async (y: string) => {
      const r = ler(cfg, await consultar(x.alterado_ms, y, 2))[0];
      return r !== null && r !== undefined && r.alterado_ms === x.alterado_ms && r.external_id === x.external_id;
    };

    // 2) controle: com o cursor na própria linha, ela não pode voltar
    if (await voltaPrimeiro(x.external_id)) {
      return {
        situacao: 'inconclusiva',
        motivo: 'com o cursor na própria primeira linha ela voltou de novo (alterado_em com precisão maior que milissegundos ou consulta que não filtra pelo cursor)',
      };
    }

    // 3) sondas: a ordem binária decide se X volta; o banco precisa concordar
    const sondas = sondasPara(x.external_id);
    for (const y of sondas) {
      const esperado = x.external_id > y; // ordinal por unidade UTF-16, a mesma de compararCursor
      const veio = await voltaPrimeiro(y);
      if (veio !== esperado) {
        const numerico = /^\d+$/.test(x.external_id) && /^\d+$/.test(y);
        return {
          situacao: 'divergente',
          exemplo:
            `Exemplo: com o cursor em external_id ${exibir(y)} o banco ${veio ? 'considerou' : 'NÃO considerou'} ${exibir(x.external_id)} maior, ` +
            `mas na ordem do Conector ${exibir(x.external_id)} ${esperado ? 'é maior' : 'é menor'}${numerico && esperado && !veio ? ' (o banco comparou como número)' : ''}.`,
        };
      }
    }
    if (sondas.length === 0) return { situacao: 'inconclusiva', motivo: 'o external_id da amostra não tem letras nem dígitos para sondar a colação' };
    return { situacao: 'ok', sondas: sondas.length };
  } catch {
    return { situacao: 'inconclusiva', motivo: 'a consulta de conferência falhou' };
  }
}
