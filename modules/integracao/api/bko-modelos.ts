/**
 * Modelos da carga por arquivo (RF-INT-03), BKO `/v1/integracao`, SÓ para o super-admin de plataforma (ADR 0029):
 *  - `GET modelos/:entidade.csv`         → CSV de exemplo (BOM, `;`, CRLF; 2 linhas válidas), `text/csv`, baixa como `<entidade>.csv`;
 *  - `GET modelos/:entidade/dicionario`  → `DicionarioModelo` (campos, obrigatoriedade, tipo, limite, formato, exemplo).
 * Tudo sai do contrato (`domain/modelos-csv.ts`); não lê banco nem devolve dado de empresa.
 * `superAdmin: 'exige'`: a plataforma já responde 403 ao usuário do tenant; `ctx.superAdmin` é conferido de novo aqui (defesa em profundidade).
 * Não há ação no manifesto: com `'exige'` a opção é a própria autorização.
 */
import { ErroHttpModulo, ErroNaoEncontrado, type ContextoRota, type EntradaRota, type RotaModulo } from '@macuxi/platform-sdk';
import { Entidade, ParamsModelo, type DicionarioModelo } from '../contracts';
import { dicionarioDaEntidade, gerarModeloCsv } from '../domain';

const MSG_SO_SUPER_ADMIN = 'Os modelos de arquivo são só do administrador da plataforma Macuxi. Peça ao suporte da Macuxi o modelo da entidade.';

function entidadeDe(ctx: ContextoRota<unknown, unknown, ParamsModelo>): Entidade {
  if (!ctx.superAdmin) throw new ErroHttpModulo(403, 'PERFIL_SEM_ACESSO', MSG_SO_SUPER_ADMIN);
  const e = Entidade.safeParse(ctx.params.entidade);
  if (!e.success) throw new ErroNaoEncontrado('ENTIDADE_DESCONHECIDA', `Entidade desconhecida. Use uma de: ${Entidade.options.join(', ')}.`);
  return e.data;
}

export const rotaModeloCsv: RotaModulo = {
  metodo: 'GET',
  caminho: 'modelos/:entidade.csv',
  superAdmin: 'exige',
  carteira: 'nao_se_aplica',
  params: ParamsModelo,
  tipoConteudo: 'text/csv; charset=utf-8',
  // só entidade conhecida entra no nome (letras e `_`); desconhecida cai em 404 antes de haver arquivo
  nomeArquivo: (e: EntradaRota) => {
    const ent = Entidade.safeParse((e.params as { entidade?: unknown }).entidade);
    return `${ent.success ? ent.data : 'modelo'}.csv`;
  },
  executar: async (ctx: ContextoRota<unknown, unknown, ParamsModelo>): Promise<string> => gerarModeloCsv(entidadeDe(ctx)).csv,
};

export const rotaModeloDicionario: RotaModulo = {
  metodo: 'GET',
  caminho: 'modelos/:entidade/dicionario',
  superAdmin: 'exige',
  carteira: 'nao_se_aplica',
  params: ParamsModelo,
  executar: async (ctx: ContextoRota<unknown, unknown, ParamsModelo>): Promise<DicionarioModelo> => dicionarioDaEntidade(entidadeDe(ctx)),
};
