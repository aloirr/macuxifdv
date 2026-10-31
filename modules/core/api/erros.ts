/**
 * Erros HTTP do Core (login/refresh). INTERINO: o SDK ainda não exporta um erro com status próprio (pedido ao
 * engenheiro-software, T-0003 F2). Até lá o erro estende `ErroRegraNegocio` (a API responde 422 com o `codigo`
 * correto no corpo) e carrega o status pretendido em `statusPretendido` — os testes do Core conferem o status
 * pretendido (401/423/503) e a troca pelo erro do SDK é de uma linha aqui.
 */
import { ErroRegraNegocio } from '@macuxi/platform-sdk';

export class ErroHttpCore extends ErroRegraNegocio {
  constructor(
    readonly statusPretendido: number,
    codigo: string,
    mensagem: string,
    detalhes?: Record<string, unknown>,
  ) {
    super(codigo, mensagem, detalhes);
    this.name = 'ErroHttpCore';
  }
}

export const erroHttp = (status: number, codigo: string, mensagem: string): ErroHttpCore => new ErroHttpCore(status, codigo, mensagem);
