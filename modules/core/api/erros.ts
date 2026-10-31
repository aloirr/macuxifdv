/** Erros HTTP do Core (login/refresh): `ErroHttpModulo` do SDK, com o status real (401, 423, 503, 400...). */
import { ErroHttpModulo, type StatusErroModulo } from '@macuxi/platform-sdk';

export const erroHttp = (status: StatusErroModulo, codigo: string, mensagem: string, detalhes?: Record<string, unknown>): ErroHttpModulo =>
  new ErroHttpModulo(status, codigo, mensagem, detalhes);
