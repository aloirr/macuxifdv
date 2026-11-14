/**
 * UF da empresa pelo CNPJ (ADR 0047; R-20261114-133700-alexandre): uso único para as empresas sem código de licença no
 * formato `UF+4`. Consulta as fontes reais (BrasilAPI, reserva CNPJá) e imprime uma linha JSON:
 *
 *   pnpm --filter api uf-do-cnpj 63.476.142/0001-40   →   {"cnpj":"63476142000140","uf":"RS","fonte":"brasilapi"}
 *
 * Só lê; a geração do código e a gravação são do banco-dados. Sem UF fixa no código. Erros (exit ≠ 0): 2 CNPJ inválido
 * ou uso errado, 3 não encontrado, 4 fontes fora, 5 sem UF (sede no exterior).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { consultaCnpjPadrao, type ConsultaCnpj } from '../consulta-cnpj';

export interface DepsUfDoCnpj {
  consulta: ConsultaCnpj;
  saida(linha: string): void;
  erro(linha: string): void;
}

export async function executarUfDoCnpj(args: readonly string[], dep: DepsUfDoCnpj): Promise<number> {
  if (args.length !== 1) {
    dep.erro('[uf-do-cnpj] uso: pnpm --filter api uf-do-cnpj <CNPJ>');
    return 2;
  }
  const r = await dep.consulta.consultar(args[0] ?? '');
  if (r.resultado === 'invalido') {
    dep.erro('[uf-do-cnpj] erro: CNPJ inválido (confira os dígitos).');
    return 2;
  }
  if (r.resultado === 'nao_encontrado') {
    dep.erro('[uf-do-cnpj] erro: CNPJ não encontrado na Receita (BrasilAPI e CNPJá).');
    return 3;
  }
  if (r.resultado === 'fora') {
    dep.erro(`[uf-do-cnpj] erro: as fontes estão fora (${r.tentativas.map((t) => t.fonte).join(', ')}). Tente de novo em instantes.`);
    return 4;
  }
  if (!r.dados.uf) {
    dep.erro('[uf-do-cnpj] erro: a Receita não traz UF para este CNPJ (sede no exterior).');
    return 5;
  }
  dep.saida(JSON.stringify({ cnpj: r.dados.cnpj, uf: r.dados.uf, fonte: r.dados.fonte }));
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
