/**
 * Apoio das rotas da Pesquisa: parâmetros do tenant, erros padronizados e acesso ao repositório dentro da transação.
 * Sem regra de negócio aqui (ela vive no domain); só tradução de `Resultado` do domain para erro HTTP.
 */
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type ContextoBase, type TransacaoTenant } from '@macuxi/platform-sdk';
import { parametrosComPadrao, type ParametrosPesquisa } from '../domain';
import type { FabricaRepositorio, RepositorioPesquisa } from './repositorio';

/** RN de origem de cada código do domain (vai em `detalhes.rn` do 422). */
const RN_DO_CODIGO: Readonly<Record<string, string>> = {
  VERSAO_PUBLICADA_IMUTAVEL: 'RN-PES-01',
  VERSAO_ANTIGA: 'RN-PES-01',
  VERSAO_INVALIDA: 'RF-PES-01',
  VERSAO_INEXISTENTE: 'RN-PES-01',
  VERSAO_NAO_PUBLICADA: 'RN-PES-01',
  SEM_VERSAO: 'RF-PES-05',
  SEM_RASCUNHO: 'RF-PES-05',
  QUESTIONARIO_ARQUIVADO: 'RF-PES-05',
  PERFIL_FORA_DO_PUBLICO: 'RF-PES-02',
  RESPOSTA_INVALIDA: 'RF-PES-01',
  RASCUNHO_INVALIDO: 'RF-PES-01',
};

/** Recusa do domain → 422 com o código do domain e a RN em `detalhes` (nunca dado pessoal). */
export function recusar(codigo: string, mensagem: string, problemas?: readonly unknown[]): never {
  const rn = RN_DO_CODIGO[codigo];
  throw new ErroRegraNegocio(codigo, mensagem, { ...(rn ? { rn } : {}), ...(problemas && problemas.length ? { problemas: [...problemas] } : {}) });
}

export const naoEncontrado = (): never => {
  throw new ErroNaoEncontrado('QUESTIONARIO_NAO_ENCONTRADO', 'Questionário não encontrado.');
};

/** Código do 409 quando outra transação gravou a mesma resposta no mesmo instante (o push tenta de novo, ver sync.ts). */
export const RESPOSTA_JA_EXISTE = 'RESPOSTA_JA_EXISTE';

export const conflito = (codigo: string, mensagem: string): never => {
  throw new ErroHttpModulo(409, codigo, mensagem);
};

/**
 * Parâmetros do tenant para a Pesquisa (RN-PES-04/06/07): só as chaves conhecidas; valor inválido = padrão do doc 03
 * (com aviso no log, sem quebrar a rota). O fuso é sempre o do tenant (`ctx.fuso()`).
 */
export function parametrosDaRota(ctx: Pick<ContextoBase, 'parametros' | 'fuso' | 'log'>): ParametrosPesquisa {
  const { parametros, erro } = parametrosComPadrao(ctx.parametros(), ctx.fuso());
  if (erro) ctx.log.warn({ erro }, 'parâmetros da pesquisa inválidos; usando o padrão');
  return parametros;
}

/** Abre a transação do tenant (RLS) e entrega o repositório dela. */
export function comRepositorio<T>(ctx: ContextoBase, fabrica: FabricaRepositorio, fn: (repo: RepositorioPesquisa, tx: TransacaoTenant, db: ClienteBanco) => Promise<T>): Promise<T> {
  return ctx.comTenant((db, tx) => fn(fabrica(ctx.usuario.tenant_id, db), tx, db));
}

/** UUID novo no servidor (versão criada ao editar uma publicada). */
export const novoUuid = (): string => globalThis.crypto.randomUUID();
