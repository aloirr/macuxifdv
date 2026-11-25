/** Erros HTTP do Core (login/refresh): `ErroHttpModulo` do SDK, com o status real (401, 423, 503, 400...). */
import { ErroHttpModulo } from '@macuxi/platform-sdk';
export const erroHttp = (status, codigo, mensagem, detalhes) => new ErroHttpModulo(status, codigo, mensagem, detalhes);
