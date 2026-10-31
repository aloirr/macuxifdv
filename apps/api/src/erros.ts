/** Erro HTTP da plataforma com o corpo padrão da API v1 (`ErroApiSchema`: `{ codigo, mensagem, detalhes? }`). */
import type { ErroApi } from '@macuxi/platform-sdk';

export class ErroHttp extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(mensagem);
    this.name = 'ErroHttp';
  }
  corpo(): ErroApi {
    return { codigo: this.codigo, mensagem: this.message, ...(this.detalhes ? { detalhes: this.detalhes } : {}) };
  }
}
