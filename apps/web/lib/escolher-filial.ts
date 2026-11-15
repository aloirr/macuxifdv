/**
 * Destravamento do BKO: "Escolha a sua filial" (T-0176; RN-CORE-39, ADR 0056; spec docs/design/filial-cadastro-venda §5, telas 16a a 16e).
 *
 * Admin ou analista SEM filial de cadastro (403 `USUARIO_SEM_FILIAL` em toda rota) informa a própria filial em
 * `GET|PUT /v1/core/eu/filial-cadastro` (contrato `MinhaFilialCadastroSchema` e `InformarFilialCadastroRequestSchema` do Core). Quem
 * não tem a ação `usuario.filial_editar` (`pode_informar=false`) vê só o aviso aprovado e o "Sair".
 *
 * Leitura tolerante do GET até o contrato do Core chegar ao `main`: campo ausente ou de tipo errado vira o valor neutro (sem filial, sem
 * permissão, lista vazia). Aqui só a apresentação: a regra (quem pode, qual filial vale) é da API.
 */
/** Caminho no SDK web (`api()` acrescenta o `/v1` pelo proxy). */
export const ROTA_MINHA_FILIAL = '/core/eu/filial-cadastro';

/** 409 do PUT: a filial de cadastro já está definida (outro admin informou antes). */
export const CODIGO_FILIAL_JA_INFORMADA = 'USUARIO_FILIAL_JA_INFORMADA';

/** Textos da spec §5 (exatamente como aprovados). */
export const TEXTOS_ESCOLHER_FILIAL = {
  titulo: 'Escolha a sua filial',
  rotulo: 'Filial de cadastro',
  escolha: 'Escolha…',
  carregando: 'Carregando…',
  salvar: 'Salvar',
  salvando: 'Salvando…',
  sair: 'Sair',
  semFiliais: 'Envie as filiais pela carga do ERP e tente de novo.',
  tentar: 'Tentar de novo',
  erroSalvar: 'Não deu para salvar. Tente de novo.',
} as const;

export interface FilialParaEscolher {
  id: string;
  nome: string;
}

export interface MinhaFilial {
  semFilial: boolean;
  podeInformar: boolean;
  filiais: FilialParaEscolher[];
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Ordem alfabética do nome (spec §5), no português do Brasil. */
export function ordenarFiliais(fs: readonly FilialParaEscolher[]): FilialParaEscolher[] {
  return [...fs].sort(
    (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  );
}

/** Corpo do `GET eu/filial-cadastro`, tolerante (ver o cabeçalho). Sem `sem_filial` explícito = segue bloqueado (a guarda decide). */
export function lerMinhaFilial(corpo: unknown): MinhaFilial {
  const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
  const lista = Array.isArray(c.filiais) ? c.filiais : [];
  const filiais = lista
    .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>) : {}))
    .map((f) => ({ id: texto(f.id), nome: texto(f.nome) || texto(f.codigo) }))
    .filter((f) => f.id !== '' && f.nome !== '');
  return {
    semFilial: c.sem_filial !== false,
    podeInformar: c.pode_informar === true,
    filiais: ordenarFiliais(filiais),
  };
}

export type EstadoEscolherFilial =
  'carregando' | 'erro_carga' | 'ja_tem_filial' | 'sem_permissao' | 'sem_filiais' | 'escolher';

/** Estado da tela a partir da consulta do GET (16a, 16b, 16c e o aviso de quem não pode informar). */
export function estadoDaEscolha(q: {
  carregando: boolean;
  erro: boolean;
  dados: MinhaFilial | undefined;
}): EstadoEscolherFilial {
  if (q.dados) {
    if (!q.dados.semFilial) return 'ja_tem_filial';
    if (!q.dados.podeInformar) return 'sem_permissao';
    return q.dados.filiais.length === 0 ? 'sem_filiais' : 'escolher';
  }
  if (q.erro) return 'erro_carga';
  return 'carregando';
}

export type ResultadoSalvar = 'salvo' | 'ja_informada' | 'erro';

function codigoDoErro(e: unknown): { status?: unknown; codigo?: unknown } {
  if (!e || typeof e !== 'object') return {};
  const x = e as { status?: unknown; code?: unknown; codigo?: unknown };
  return { status: x.status, codigo: x.code ?? x.codigo };
}

/**
 * `PUT eu/filial-cadastro` com a filial escolhida. 409 `USUARIO_FILIAL_JA_INFORMADA` = `ja_informada` (a tela mostra o erro e relê o
 * GET: se a filial já estiver definida, entra no Início). Qualquer outra falha = `erro` (16d; a escolha continua).
 */
export async function salvarMinhaFilial(
  filialId: string,
  put: (corpo: { filial_cadastro_id: string }) => Promise<unknown>,
): Promise<ResultadoSalvar> {
  try {
    await put({ filial_cadastro_id: filialId });
    return 'salvo';
  } catch (e) {
    const { status, codigo } = codigoDoErro(e);
    if (status === 409 && codigo === CODIGO_FILIAL_JA_INFORMADA) return 'ja_informada';
    return 'erro';
  }
}

/** O que a tela faz com o resultado do PUT: 16e entra no Início; 16d mostra o erro (no 409 também relê o GET). */
export function depoisDeSalvar(r: ResultadoSalvar): { entrar: boolean; erro: boolean; reler: boolean } {
  if (r === 'salvo') return { entrar: true, erro: false, reler: false };
  return { entrar: false, erro: true, reler: r === 'ja_informada' };
}
