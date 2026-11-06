/**
 * Modelos da carga por arquivo (RF-INT-03), BKO `/v1/integracao` (JWT; ação `modelo.baixar`: admin):
 *  - `GET modelos/:entidade/csv`         → texto do CSV de exemplo (BOM, `;`, CRLF; 2 linhas válidas);
 *  - `GET modelos/:entidade/dicionario`  → `DicionarioModelo` (campos, obrigatoriedade, tipo, limite, formato, exemplo).
 * Tudo sai do contrato (`domain/modelos-csv.ts`); não lê banco nem devolve dado de empresa.
 *
 * Limitações conhecidas: (0) o `CAMINHO_RE` do SDK recusa ponto no segmento, então `:entidade.csv` não registra; a rota é `modelos/:entidade/csv` (trocar exige mudar o SDK). (1) o `RotaModulo` não define o content-type — a plataforma envia a string como `text/plain; charset=utf-8`
 * (não `text/csv`) e não há `Content-Disposition`; quem baixa nomeia o arquivo (`DicionarioModelo.arquivo`). (2) O pedido era "só
 * super-admin"; o SDK não tem esse perfil e só o Core declara rota pública, então a ação é de `admin` (o mais alto disponível).
 */
import { ErroHttpModulo, ErroNaoEncontrado, type ContextoRota, type RotaModulo } from '@macuxi/platform-sdk';
import { Entidade, ParamsModelo, type DicionarioModelo } from '../contracts';
import { autorizarAcaoIntegracao, dicionarioDaEntidade, gerarModeloCsv } from '../domain';

function entidadeDe(ctx: ContextoRota<unknown, unknown, ParamsModelo>): Entidade {
  const perm = autorizarAcaoIntegracao('modelo.baixar', ctx.usuario.perfil);
  if (!perm.ok) throw new ErroHttpModulo(403, 'PERFIL_SEM_ACESSO', perm.mensagem);
  const e = Entidade.safeParse(ctx.params.entidade);
  if (!e.success) throw new ErroNaoEncontrado('ENTIDADE_DESCONHECIDA', `Entidade desconhecida. Use uma de: ${Entidade.options.join(', ')}.`);
  return e.data;
}

export const rotaModeloCsv: RotaModulo = {
  metodo: 'GET',
  caminho: 'modelos/:entidade/csv',
  acao: 'modelo.baixar',
  carteira: 'nao_se_aplica',
  params: ParamsModelo,
  executar: async (ctx: ContextoRota<unknown, unknown, ParamsModelo>): Promise<string> => gerarModeloCsv(entidadeDe(ctx)).csv,
};

export const rotaModeloDicionario: RotaModulo = {
  metodo: 'GET',
  caminho: 'modelos/:entidade/dicionario',
  acao: 'modelo.baixar',
  carteira: 'nao_se_aplica',
  params: ParamsModelo,
  executar: async (ctx: ContextoRota<unknown, unknown, ParamsModelo>): Promise<DicionarioModelo> => dicionarioDaEntidade(entidadeDe(ctx)),
};
