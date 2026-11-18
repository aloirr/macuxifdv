/**
 * Sessão de carga completa (RN-INT-06): vários lotes (parte n, último = sim). Só ao fechar a
 * sessão — todas as partes 1..n concluídas — os registros ausentes da carga são inativados
 * (`deleted_at`), nunca apagados. Sessão incompleta ou expirada não inativa nada.
 */
import type { EstadoLoteBko } from '../contracts';
import { externalIdDoErro } from './erros';
import { PARAMETROS_PADRAO } from './parametros';

export interface SessaoCargaEstado {
  id: string;
  entidade: string;
  iniciadaEm: string;
  /** Último estado conhecido de cada parte. */
  partes: Readonly<Record<number, EstadoLoteBko>>;
  /** Número da parte marcada como `ultimo`; `null` enquanto não chegou. */
  ultimaParte: number | null;
}

export type SituacaoSessao = 'aberta' | 'completa' | 'expirada';

export function novaSessao(id: string, entidade: string, iniciadaEm: string): SessaoCargaEstado {
  return { id, entidade, iniciadaEm, partes: {}, ultimaParte: null };
}

/** Registra (ou atualiza, no reenvio) o estado de uma parte. Não altera a sessão original. */
export function registrarParte(sessao: SessaoCargaEstado, parte: { parte: number; ultimo: boolean; status: EstadoLoteBko }): SessaoCargaEstado {
  return {
    ...sessao,
    partes: { ...sessao.partes, [parte.parte]: parte.status },
    ultimaParte: parte.ultimo ? parte.parte : sessao.ultimaParte,
  };
}

/**
 * `falhou` NÃO conta como concluída (T-0025 🟢 5): uma parte em que todas as linhas ficaram em `referencia_ausente` termina
 * `falhou` e a sessão não fecha. O reprocessamento do lote recalcula o resultado e a API chama `registrarParte` de novo com o
 * estado novo da parte (que então vale `concluido_com_erros`); só então a sessão fecha e a inativação é avaliada.
 */
const CONCLUIDAS: ReadonlySet<EstadoLoteBko> = new Set<EstadoLoteBko>(['concluido', 'concluido_com_erros']);

function completa(s: SessaoCargaEstado): boolean {
  if (s.ultimaParte === null) return false;
  const numeros = Object.keys(s.partes).map(Number);
  if (numeros.some((n) => n > (s.ultimaParte as number))) return false;
  for (let n = 1; n <= s.ultimaParte; n++) {
    const st = s.partes[n];
    if (st === undefined || !CONCLUIDAS.has(st)) return false;
  }
  return true;
}

export function situacaoSessao(sessao: SessaoCargaEstado, agora: string, opcoes: { ttlMin?: number } = {}): SituacaoSessao {
  if (completa(sessao)) return 'completa';
  const ttl = opcoes.ttlMin ?? PARAMETROS_PADRAO.ttlSessaoMin;
  return Date.parse(agora) - Date.parse(sessao.iniciadaEm) > ttl * 60_000 ? 'expirada' : 'aberta';
}

export type MotivoSemInativacao = 'sessao_incompleta' | 'linhas_sem_external_id' | 'linhas_invalidas_omitidas' | 'carga_vazia' | 'excede_limite_inativacao';

export interface EntradaInativacao {
  sessao: SessaoCargaEstado;
  agora: string;
  /** external_id de TODOS os registros ativos da entidade no Macuxi: é o denominador do percentual da trava (`total_ativos`). */
  ativosNoMacuxi: Iterable<string>;
  /**
   * T-0025 (🟡 2): ativos ELEGÍVEIS à inativação (`filtrarAtivosElegiveis`: `visto_em` anterior ao início da sessão). Só estes são
   * candidatos; o que chegou pelo delta durante a carga e não estava na sessão fica de fora. Omitido = todos os ativos.
   */
  ativosElegiveis?: Iterable<string>;
  /** external_id de todas as linhas da sessão, inclusive as que tiveram erro de validação. */
  recebidosNaSessao: Iterable<string>;
  /**
   * T-0027 (🔴 RN-INT-06): external_id das linhas que vieram INVÁLIDAS na sessão — linhas inválidas do Conector e linhas com erro
   * no Hub (validação, referência ausente, falha). Registro que veio como inválido NUNCA é inativado: ele existe no ERP. Pode
   * repetir ids de `recebidosNaSessao` (a união é feita aqui); veja `idsDaSessaoNoLote`.
   */
  invalidosNaSessao?: Iterable<string>;
  /** Linhas da sessão sem external_id legível: sem elas não dá para saber o que faltou. */
  linhasSemExternalId?: number;
  /**
   * T-0025: linhas inválidas que o Conector só contou (passaram do limite de 500 por lote): não se sabe de quais registros são,
   * então a inativação não acontece.
   */
  linhasInvalidasOmitidas?: number;
  ttlMin?: number;
  /** Percentual máximo de ativos inativados sem confirmação (padrão `limiteInativacaoPct`). */
  limitePct?: number;
  /** Operador confirmou a inativação em massa no BKO. */
  confirmado?: boolean;
}

export interface ResultadoInativacao {
  permitido: boolean;
  inativar: string[];
  /** Só quando `excede_limite_inativacao`: o que seria inativado se o operador confirmar. */
  candidatos?: string[];
  motivo: MotivoSemInativacao | null;
}

export function calcularInativacao(e: EntradaInativacao): ResultadoInativacao {
  const nega = (motivo: MotivoSemInativacao): ResultadoInativacao => ({ permitido: false, inativar: [], motivo });
  if (situacaoSessao(e.sessao, e.agora, { ttlMin: e.ttlMin }) !== 'completa') return nega('sessao_incompleta');
  if ((e.linhasSemExternalId ?? 0) > 0) return nega('linhas_sem_external_id');
  if ((e.linhasInvalidasOmitidas ?? 0) > 0) return nega('linhas_invalidas_omitidas');
  // vistos = tudo que a sessão trouxe (aceito ou inválido): só o ativo AUSENTE da carga é candidato
  const vistos = new Set(e.recebidosNaSessao);
  for (const id of e.invalidosNaSessao ?? []) vistos.add(id);
  if (vistos.size === 0) return nega('carga_vazia');
  const inativar = [...new Set(e.ativosElegiveis ?? e.ativosNoMacuxi)].filter((id) => !vistos.has(id));
  const ativos = new Set(e.ativosNoMacuxi).size;
  const limite = e.limitePct ?? PARAMETROS_PADRAO.limiteInativacaoPct;
  if (!e.confirmado && ativos > 0 && (inativar.length / ativos) * 100 > limite) {
    return { permitido: false, inativar: [], candidatos: inativar, motivo: 'excede_limite_inativacao' };
  }
  return { permitido: true, inativar, motivo: null };
}

export interface LinhaDaSessao {
  /** `external_id` legível da linha (aparado); `null` quando não dá para identificar o registro. */
  external_id: string | null;
}

export interface EntradaIdsDoLote {
  /** Linhas aceitas pelo Hub no lote (novas, atualizadas, inalteradas, obsoletas). */
  aceitas: readonly { external_id: string }[];
  /** Erros por linha do Hub (validação, referência ausente, falha de processamento); várias entradas por `indice` contam 1 linha. */
  errosHub: readonly { indice: number; external_id: string | null }[];
  /** Resultado de `tratarLinhasInvalidasConector` para o mesmo lote. */
  invalidasConector: { externalIds: readonly string[]; semIdentificacao: number };
}

export interface IdsDaSessaoNoLote {
  /** Gravar em `registro_atual.sessao_id`/`visto_em` (já é feito no upsert). */
  aceitos: string[];
  /** Gravar em `sessao_carga_recebido`: o que veio inválido e por isso não tocou `registro_atual` (nunca inativar). */
  invalidos: string[];
  /** Somar em `sessao_carga.linhas_sem_identificacao`: linha sem id legível (Hub ou Conector) ou omitida — impede a inativação. */
  semIdentificacao: number;
}

/**
 * T-0027 (🔴 RN-INT-06): o que cada lote de uma sessão de carga completa precisa deixar guardado para a inativação nunca atingir
 * um registro que chegou inválido. A API chama ao aplicar cada parte e soma os resultados da sessão; `calcularInativacao` recebe
 * `recebidosNaSessao` (aceitos), `invalidosNaSessao` (inválidos) e `linhasSemExternalId` (semIdentificacao).
 */
export function idsDaSessaoNoLote(e: EntradaIdsDoLote): IdsDaSessaoNoLote {
  // id vazio ou acima de EXTERNAL_ID_MAX = sem identificação (a coluna sessao_carga_recebido.external_id limita a 200)
  const limpa = externalIdDoErro;
  const aceitos = new Set<string>();
  for (const a of e.aceitas) {
    const id = limpa(a.external_id);
    if (id !== null) aceitos.add(id);
  }
  const invalidos = new Set<string>();
  const porIndice = new Map<number, string | null>();
  for (const x of e.errosHub) {
    const id = limpa(x.external_id);
    if (!porIndice.has(x.indice) || (porIndice.get(x.indice) === null && id !== null)) porIndice.set(x.indice, id);
  }
  let semId = 0;
  for (const id of porIndice.values()) {
    if (id === null) semId++;
    else invalidos.add(id);
  }
  for (const id of e.invalidasConector.externalIds) {
    const t = limpa(id);
    if (t !== null) invalidos.add(t);
  }
  return { aceitos: [...aceitos], invalidos: [...invalidos].filter((id) => !aceitos.has(id)), semIdentificacao: semId + Math.max(0, e.invalidasConector.semIdentificacao) };
}
