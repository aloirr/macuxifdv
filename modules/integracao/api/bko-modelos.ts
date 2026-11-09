/**
 * Modelos da carga por arquivo (RF-INT-03, T-0100), BKO `/v1/integracao`, para quem tem a ação `carga.arquivo` no motor de permissões
 * (ADR 0033: admin e analista de fábrica; o admin do cliente ajusta na página Perfis de acesso) e para o super-admin (ADR 0029):
 *  - `GET modelos/:entidade.csv`         → CSV de exemplo (BOM, `;`, CRLF; 2 linhas válidas), `text/csv`, baixa como `<entidade>.csv`;
 *  - `GET modelos/:entidade/dicionario`  → `DicionarioModelo` (campos, obrigatoriedade, tipo, limite, formato, exemplo).
 * Tudo sai do contrato (`domain/modelos-csv.ts`); não lê banco nem devolve dado de empresa (nada é multi-tenant aqui: o modelo é igual para todos).
 * `acao: 'carga.arquivo'` + `superAdmin: 'aceita'`: a plataforma confere a licença ANTES (sem módulo → 403 MODULO_INATIVO) e depois o motor
 * (sem a chave → 403 PERFIL_SEM_ACESSO); quem baixa o modelo é quem pode enviar a carga. Não há perfil fixo no código (aviso R-20261107-191310).
 */
import { ErroNaoEncontrado, type ContextoRota, type EntradaRota, type RotaModulo } from '@macuxi/platform-sdk';
import { Entidade, ParamsModelo, type DicionarioModelo } from '../contracts';
import { dicionarioDaEntidade, gerarModeloCsv } from '../domain';

function entidadeDe(ctx: ContextoRota<unknown, unknown, ParamsModelo>): Entidade {
  const e = Entidade.safeParse(ctx.params.entidade);
  if (!e.success) throw new ErroNaoEncontrado('ENTIDADE_DESCONHECIDA', `Entidade desconhecida. Use uma de: ${Entidade.options.join(', ')}.`);
  return e.data;
}

export const rotaModeloCsv: RotaModulo = {
  metodo: 'GET',
  caminho: 'modelos/:entidade.csv',
  acao: 'carga.arquivo',
  superAdmin: 'aceita',
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
  acao: 'carga.arquivo',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  params: ParamsModelo,
  executar: async (ctx: ContextoRota<unknown, unknown, ParamsModelo>): Promise<DicionarioModelo> => dicionarioDaEntidade(entidadeDe(ctx)),
};
