/**
 * Destravamento do BKO: "Escolha a sua filial" (T-0176; RN-CORE-39, ADR 0056; spec docs/design/filial-cadastro-venda §5, telas 16a a 16e).
 *
 * Admin ou analista SEM filial de cadastro (403 `USUARIO_SEM_FILIAL` em toda rota) informa a própria filial em
 * `GET|PUT /v1/core/eu/filial-cadastro` (contrato `MinhaFilialCadastroSchema` e `InformarFilialCadastroRequestSchema` do Core). Quem
 * não tem a ação `usuario.filial_editar` (`pode_informar=false`) vê só o aviso aprovado e o "Sair".
 *
 * O GET e o PUT passam pelos schemas do Core (`safeParse`); corpo fora do contrato vira erro de carga (16d/"Tentar de novo").
 * Aqui só a apresentação: a regra (quem pode, qual filial vale) é da API.
 */
import {
  CODIGOS_FILIAL_USUARIO,
  InformarFilialCadastroRequestSchema,
  MinhaFilialCadastroSchema,
  type InformarFilialCadastroRequest,
  type MinhaFilialCadastro,
} from '@macuxi/core/contracts';
import { filiaisEmOrdem } from '@macuxi/core/web';
import { codigoDoErroHttp } from '@macuxi/platform-sdk';

/** Caminho no SDK web (`api()` acrescenta o `/v1` pelo proxy). */
export const ROTA_MINHA_FILIAL = '/core/eu/filial-cadastro';

/** Textos da spec §5 (exatamente como aprovados). */
export const TEXTOS_ESCOLHER_FILIAL = {
  titulo: 'Escolha a sua filial',
  rotulo: 'Filial de cadastro',
  escolha: 'Escolha…',
  carregando: 'Carregando…',
  salvar: 'Salvar',
  salvando: 'Salvando…',
  sair: 'Sair',
  semFiliais: 'Envie as filiais pela carga do ERP.',
  tentar: 'Tentar de novo',
  erroSalvar: 'Não deu para salvar. Tente de novo.',
  erroCarga: 'Não deu para carregar as filiais.',
} as const;

/** `GET eu/filial-cadastro` validado pelo `MinhaFilialCadastroSchema` do Core; fora do contrato = erro (a tela mostra o "Tentar de novo"). */
export async function buscarMinhaFilial(get: (rota: string) => Promise<unknown>): Promise<MinhaFilialCadastro> {
  const r = MinhaFilialCadastroSchema.safeParse(await get(ROTA_MINHA_FILIAL));
  if (!r.success) throw r.error;
  return { ...r.data, filiais: filiaisEmOrdem(r.data.filiais) }; // ordem alfabética do nome (spec §5), a do Core
}

export type EstadoEscolherFilial =
  'carregando' | 'erro_carga' | 'ja_tem_filial' | 'sem_permissao' | 'sem_filiais' | 'escolher';

/** Estado da tela a partir da consulta do GET (16a, 16b, 16c e o aviso de quem não pode informar). */
export function estadoDaEscolha(q: {
  carregando: boolean;
  erro: boolean;
  dados: MinhaFilialCadastro | undefined;
}): EstadoEscolherFilial {
  if (q.dados) {
    if (!q.dados.sem_filial) return 'ja_tem_filial';
    if (!q.dados.pode_informar) return 'sem_permissao';
    return q.dados.filiais.length === 0 ? 'sem_filiais' : 'escolher';
  }
  if (q.erro) return 'erro_carga';
  return 'carregando';
}

export type ResultadoSalvar = 'salvo' | 'ja_informada' | 'erro';

/**
 * `PUT eu/filial-cadastro` com a filial escolhida. 409 `USUARIO_FILIAL_JA_INFORMADA` = `ja_informada` (a tela mostra o erro e relê o
 * GET: se a filial já estiver definida, entra no Início). Qualquer outra falha = `erro` (16d; a escolha continua).
 */
export async function salvarMinhaFilial(
  filialId: string,
  put: (corpo: InformarFilialCadastroRequest) => Promise<unknown>,
): Promise<ResultadoSalvar> {
  const corpo = InformarFilialCadastroRequestSchema.safeParse({ filial_cadastro_id: filialId });
  if (!corpo.success) return 'erro';
  try {
    await put(corpo.data);
    return 'salvo';
  } catch (e) {
    const { status, codigo } = codigoDoErroHttp(e);
    if (status === 409 && codigo === CODIGOS_FILIAL_USUARIO.jaInformada) return 'ja_informada';
    return 'erro';
  }
}

/** O que a tela faz com o resultado do PUT: 16e entra no Início; 16d mostra o erro (no 409 também relê o GET). */
export function depoisDeSalvar(r: ResultadoSalvar): { entrar: boolean; erro: boolean; reler: boolean } {
  if (r === 'salvo') return { entrar: true, erro: false, reler: false };
  return { entrar: false, erro: true, reler: r === 'ja_informada' };
}
