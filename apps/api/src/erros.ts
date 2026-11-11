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

/** 503 `BANCO_INDISPONIVEL`: a API subiu sem banco (ou a rota precisa dele e ele não veio). */
export function semBanco(): never {
  throw new ErroHttp(503, 'BANCO_INDISPONIVEL', 'Banco de dados indisponível. Tente de novo em instantes.');
}
