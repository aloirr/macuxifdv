/**
 * Pull de `produto_unidade` com fator decimal (ADR 0076 D6; RN-VEN-15 v3): `core.produto_unidade.fator` é `numeric(9,4)` e o
 * `node-pg` o devolve como texto, então toda linha passa por `quantidadeDoBanco`. App sem o cabeçalho `x-macuxi-app` ou abaixo
 * da VERSAO_APP_FRACAO (1.0.36) valida o pull com `int()`: a unidade de fator fracionário NÃO vai para ele (as inteiras vão), e a variação de escopo
 * muda quando o app passa a aceitar fração, para quem atualiza baixar a entidade de novo.
 */
import { quantidadeDoBanco, temFracao } from '@macuxi/comum/quantidade';
import { clienteAceitaFracao, type AppDoCabecalho, type LinhaSync } from '@macuxi/platform-sdk';

/** Converte o `fator` do banco e, se o app não aceita fração, tira as unidades de fator fracionário. */
export function unidadesParaCliente(linhas: LinhaSync[], aceitaFracao: boolean): LinhaSync[] {
  const saida: LinhaSync[] = [];
  for (const l of linhas) {
    const fator = quantidadeDoBanco((l as unknown as { fator: string | number }).fator);
    if (!aceitaFracao && temFracao(fator)) continue;
    saida.push({ ...l, fator } as unknown as LinhaSync);
  }
  return saida;
}

/** Texto estável da regra que muda o que o app vê (`variacaoEscopo`): lê fração ou não. */
export function variacaoFracaoUnidades(app: AppDoCabecalho | null): string {
  return `fracao=${clienteAceitaFracao(app) ? 'sim' : 'nao'}`;
}
