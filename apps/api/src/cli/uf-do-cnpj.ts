/**
 * UF da empresa pelo CNPJ (ADR 0048; R-20261114-133700-alexandre): uso único para as empresas sem código de licença no
 * formato `UF+4`. Consulta as fontes reais (BrasilAPI, reserva CNPJá) e imprime uma linha JSON:
 *
 *   pnpm --filter api uf-do-cnpj 63.476.142/0001-40   →   {"cnpj":"63476142000140","uf":"RS","fonte":"brasilapi"}
 *
 * Só lê; a geração do código e a gravação são do banco-dados. Sem UF fixa no código. Erros (exit ≠ 0): 2 CNPJ inválido
 * ou uso errado, 3 não encontrado, 4 fontes fora, 5 sem UF (sede no exterior).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Uf } from '@macuxi/comum/endereco';
import type { FonteCnpjNome } from '@macuxi/platform-sdk';
import { consultaCnpjPadrao, type ConsultaCnpj } from '../consulta-cnpj';

export interface DepsUfDoCnpj {
  consulta: ConsultaCnpj;
  saida(linha: string): void;
  erro(linha: string): void;
}

/** Por que a UF não saiu (e o código de saída do `uf-do-cnpj` para cada caso). */
export type FalhaUf = 'cnpj_invalido' | 'cnpj_nao_encontrado' | 'consulta_fora' | 'sem_uf';

export const MENSAGEM_FALHA_UF: Record<FalhaUf, string> = {
  cnpj_invalido: 'CNPJ inválido (confira os dígitos).',
  cnpj_nao_encontrado: 'CNPJ não encontrado na Receita (BrasilAPI e CNPJá).',
  consulta_fora: 'as fontes estão fora (BrasilAPI e CNPJá). Tente de novo em instantes.',
  sem_uf: 'a Receita não traz UF para este CNPJ (sede no exterior).',
};

const SAIDA_FALHA_UF: Record<FalhaUf, number> = { cnpj_invalido: 2, cnpj_nao_encontrado: 3, consulta_fora: 4, sem_uf: 5 };

export type ResultadoUf = { ok: true; cnpj: string; uf: Uf; fonte: FonteCnpjNome } | { ok: false; falha: FalhaUf };

/** UF da empresa pela consulta de CNPJ (a mesma do `uf-do-cnpj` e do `tenant:codigo-licenca`). */
export async function ufDoCnpj(consulta: ConsultaCnpj, cnpj: string): Promise<ResultadoUf> {
  const r = await consulta.consultar(cnpj);
  if (r.resultado === 'invalido') return { ok: false, falha: 'cnpj_invalido' };
  if (r.resultado === 'nao_encontrado') return { ok: false, falha: 'cnpj_nao_encontrado' };
  if (r.resultado === 'fora') return { ok: false, falha: 'consulta_fora' };
  if (!r.dados.uf) return { ok: false, falha: 'sem_uf' };
  return { ok: true, cnpj: r.dados.cnpj, uf: r.dados.uf, fonte: r.dados.fonte };
}

export async function executarUfDoCnpj(args: readonly string[], dep: DepsUfDoCnpj): Promise<number> {
  if (args.length !== 1) {
    dep.erro('[uf-do-cnpj] uso: pnpm --filter api uf-do-cnpj <CNPJ>');
    return 2;
  }
  const r = await ufDoCnpj(dep.consulta, args[0] ?? '');
  if (!r.ok) {
    dep.erro(`[uf-do-cnpj] erro: ${MENSAGEM_FALHA_UF[r.falha]}`);
    return SAIDA_FALHA_UF[r.falha];
  }
  dep.saida(JSON.stringify({ cnpj: r.cnpj, uf: r.uf, fonte: r.fonte }));
  return 0;
}

const ehExecucaoDireta = (): boolean =>
  !!process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (ehExecucaoDireta()) {
  void executarUfDoCnpj(process.argv.slice(2), {
    consulta: consultaCnpjPadrao(),
    saida: (l) => process.stdout.write(`${l}\n`),
    erro: (l) => process.stderr.write(`${l}\n`),
  }).then((codigo) => {
    process.exitCode = codigo;
  });
}
