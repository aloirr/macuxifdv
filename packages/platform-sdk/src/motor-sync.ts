/**
 * Motor de sincronização do aparelho (ADR 0003; desenho T-0001 §13). Substitui o `app-store.tsx`
 * monolítico da Fase M: o motor é genérico e cada módulo só REGISTRA o que sincroniza
 * (`definirEntidadeSync` + `manifest.sync`) e, se precisar, etapas de carga próprias.
 *
 * Puro TypeScript, sem React, sem timers e sem rede/disco diretos: armazenamento e transporte são
 * ADAPTADORES injetados (AsyncStorage/SQLite no app, memória nos testes; HTTP `/v1/sync/*` na API real,
 * rede simulada nos testes). O shell decide QUANDO chamar (abertura, volta do sinal, a cada N min).
 *
 * Regras:
 * - Outbox FIFO e persistida; o `id` (UUID gerado no aparelho) é a chave de idempotência (RN-VEN-33).
 * - Falha de transporte (exceção: sem rede, 5xx) → conta tentativa e PARA (não embaralha a ordem).
 * - Item rejeitado pelo servidor → `falhou` (não tenta sozinho; o usuário reenvia ou descarta).
 * - Item rejeitado com `MODULO_INATIVO` → `modulo_inativo` ("não enviado — módulo desativado", RN-CORE-02).
 * - Módulo que deixou de ser efetivo: sem itens na fila → dados locais apagados na hora; com itens →
 *   tenta enviar e só apaga depois que o usuário confirma (`confirmarLimpeza`). Nada some em silêncio.
 * - Pull por entidade de módulo efetivo, cursor `(updated_at, id)` persistido, inclui removidos.
 * - ADR 0009 §7 (D-2): pull com 501 `SYNC_NAO_IMPLEMENTADO` pula a entidade (cursor intacto) e vira aviso; item
 *   rejeitado com código retentável (`CODIGOS_RETENTAVEIS`) continua `pendente` e não bloqueia o resto do lote.
 * - ADR 0009 §4: `versao_escopo` diferente da guardada = ressincronização da entidade (recomeça do cursor nulo e,
 *   no fim, apaga do aparelho as linhas que não vieram: cliente que saiu da carteira some).
 * - ADR 0009 §3: o pull nunca mexe na fila; a tela sobrepõe `motor.sobreposicao()` às linhas. D-3: item ACEITO sai da
 *   fila mas fica em `aceitos` (ainda sobreposto) até um pull cobrir o aceite: horizonte da página (`PaginaSync.horizonte`)
 *   posterior ao instante do aceite no servidor (`ResultadoItemPush.em`); servidor sem esses campos = relógio do aparelho
 *   com `MARGEM_ACEITE_SEM_HORIZONTE_MS`. Assim o fato aceito não "desfaz" no aparelho entre o envio e a linha voltar.
 * - T-0008 P1: extensões opcionais do armazenamento (`linhas`, `emTransacao`, `removerModulo`); sem elas, o
 *   caminho chave→JSON de sempre. P3/P5: adaptador SQLite (`sqlite/armazenamento.ts`) e busca textual (`busca`,
 *   FTS5 no SQLite ou varredura em JS com `comBuscaEmJs`); `motor.buscar` e `busca.finalizar` no fim do sync.
 * - ADR 0010 §4: fila de ARQUIVOS (fotos) separada da fila de itens (`sync:arquivos`), enviada DEPOIS do push dos itens,
 *   um por vez, com os bytes lidos pelo leitor do shell (`arquivos.ler`). `ARQUIVO_SEM_REFERENCIA` (o comando ainda não
 *   chegou) mantém o arquivo `pendente`; aceito → `enviado` e o arquivo local é apagado depois de 7 dias. RN-CORE-02
 *   vale igual à fila de itens.
 * - RN-CORE-23 (ADR 0018): `sincronizarNovidades()` é a atualização LEVE — `GET /v1/sync/novidades?desde=<cursor>`
 *   (`transporte.novidades`) e pull só das entidades que mudaram (ou só das que o push silencioso indicou). Sem mudança
 *   = 1 requisição. O cursor de novidades (`sync:novidades`) só anda depois de todas as entidades puxadas; a sincronização
 *   completa grava um cursor-base no fim. As etapas extras (REST da Fase M) só rodam na completa.
 * - ADR 0021 (T-0079): `geracao_base` da página do pull e das novidades diferente da guardada = a base do tenant foi recriada
 *   ou restaurada. Troca de geração: aceitos sobrepostos voltam para a fila, a fila é enviada, linhas/cursores/escopos são
 *   apagados (a fila de itens e a de arquivos ficam), cada etapa limpa o próprio cache (`aoTrocarGeracao`) e o pull completo
 *   roda de novo na mesma sincronização. Sem o campo, nada muda; a primeira geração vista é adotada sem apagar nada.
 */
import { ambienteIndisponivel, type AmbienteAparelho, type AmbienteModulo } from './ambiente';
import { completarAmbiente, type RegistroConsultasAparelho } from './consultas';
import { decidirGeracao, filaNaTrocaDeGeracao, normalizarGeracao } from './geracao-base';
import {
  caminhoFoto,
  CODIGOS_ARQUIVO,
  CODIGOS_ARQUIVO_RETENTAVEIS,
  DIAS_RETENCAO_ARQUIVO_LOCAL,
  TIPOS_ARQUIVO,
  type EnvioArquivo,
  type ResultadoEnvioArquivo,
  type TipoArquivo,
} from './arquivos';
import type { BuscaTextoSync, ConsultaTexto, ResultadoBusca } from './busca-tipos';
import { MODULOS, type ModuloId } from './nomes';
import type { NovidadesResposta } from './novidades';
import type { ItemPush, LinhaSync, PaginaSync, RegistroSync, ResultadoItemPush } from './sync';
import {
  codificarCursor,
  CODIGOS_RETENTAVEIS,
  ehSyncNaoImplementado,
  MAX_ITENS_PUSH,
  SYNC_NAO_IMPLEMENTADO,
} from './sync';

// ---------- adaptadores ----------

/**
 * Armazenamento chave → JSON do aparelho. O shell já entrega isolado por usuário (desenho T-0008 §1.1).
 * As extensões são OPCIONAIS: o adaptador que não as tem (memória, AsyncStorage) segue no caminho de sempre.
 */
export interface ArmazenamentoSync {
  ler<T>(chave: string): Promise<T | null>;
  /** `null`/`undefined` = remover. */
  gravar(chave: string, valor: unknown): Promise<void>;
  remover(chave: string): Promise<void>;
  /** Chaves com o prefixo, ordenadas. */
  chaves(prefixo: string): Promise<string[]>;
  /** Gravação por linha das entidades de pull (SQLite: `ent_<e>`). Sem ela, o motor usa a chave `ent:<e>` (mapa inteiro). */
  linhas?: LinhasSync;
  /** Executa `fn` tudo-ou-nada. Dentro de `fn`, use SÓ o `tx` recebido. Sem ela, o motor executa em sequência. */
  emTransacao?<T>(fn: (tx: ArmazenamentoSync) => Promise<T>): Promise<T>;
  /** RN-CORE-02: apaga as estruturas próprias do módulo (tabelas `<m>__*`, índices de busca, versão de esquema local). */
  removerModulo?(modulo: ModuloId): Promise<void>;
  /** Busca textual (FTS5 no SQLite; varredura em JS com `comBuscaEmJs`) — desenho T-0008 §2. */
  busca?: BuscaTextoSync;
}

/** Linhas das entidades de pull, por linha (desenho T-0008 §1.1). Toda operação é idempotente. */
export interface LinhasSync {
  /** Uma página do pull, atômica: upsert das vivas, apaga as com `deleted_at` e grava o cursor (`null` = mantém o atual). */
  aplicar(entidade: string, linhas: readonly LinhaSync[], cursor: string | null): Promise<void>;
  /** Sem ordem garantida entre adaptadores (SQLite: por `id`; chave→JSON: por chegada) — quem precisa, ordena. */
  listar<L extends LinhaSync>(entidade: string): Promise<L[]>;
  porIds<L extends LinhaSync>(entidade: string, ids: readonly string[]): Promise<L[]>;
  /** Ids das linhas guardadas (ressincronização do escopo, ADR 0009 §4). */
  ids(entidade: string): Promise<string[]>;
  contar(entidade: string): Promise<number>;
  /** Apaga as linhas e o cursor da entidade. */
  limpar(entidade: string): Promise<void>;
}

/** Transporte com o servidor. Lançar exceção = falha de transporte (o motor tenta de novo depois). */
export interface TransporteSync {
  push(itens: ItemPush[]): Promise<ResultadoItemPush[]>;
  pull(entidade: string, cursor: string | null): Promise<PaginaSync<LinhaSync>>;
  /**
   * Upload de um arquivo (`PUT /v1/arquivos/:id`, ADR 0010). Exceção = falha de transporte (o motor tenta depois);
   * 4xx vira `rejeitado` com o código da API. Sem ele (ex.: servidor da Fase M), os arquivos ficam na fila.
   */
  enviarArquivo?(arquivo: EnvioArquivo): Promise<ResultadoEnvioArquivo>;
  /**
   * RN-CORE-23 (ADR 0018): `GET /v1/sync/novidades?desde=<cursor>` — entidades com mudança desde o cursor e módulos
   * efetivos, se mudaram. Exceção = falha de transporte. Sem ele, `sincronizarNovidades` vira a sincronização completa.
   */
  novidades?(desde: string | null): Promise<NovidadesResposta>;
}

/** Acesso do motor aos arquivos locais (shell: `expo-file-system`; testes: memória). Caminho relativo aos documentos do app. */
export interface ArquivosLocais {
  /** Bytes do arquivo ou `null` se não existe mais. */
  ler(caminho: string): Promise<Uint8Array | null>;
  /** Apaga o arquivo local (aceito há 7 dias, descartado ou de módulo desativado). Ausente = não apaga nada. */
  remover?(caminho: string): Promise<void>;
}

/** Armazenamento em memória (testes e navegador sem storage). */
export function criarArmazenamentoEmMemoria(
  inicial: Record<string, unknown> = {},
): ArmazenamentoSync & { conteudo(): Record<string, unknown> } {
  const dados = new Map<string, string>(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async ler<T>(chave: string) {
      const v = dados.get(chave);
      return v === undefined ? null : (JSON.parse(v) as T);
    },
    async gravar(chave, valor) {
      if (valor === null || valor === undefined) dados.delete(chave);
      else dados.set(chave, JSON.stringify(valor));
    },
    async remover(chave) {
      dados.delete(chave);
    },
    async chaves(prefixo) {
      return [...dados.keys()].filter((k) => k.startsWith(prefixo)).sort();
    },
    conteudo() {
      return Object.fromEntries([...dados].map(([k, v]) => [k, JSON.parse(v)]));
    },
  };
}

/**
 * `linhas` sobre as mesmas chaves `ent:<e>` (mapa id → linha) e `sync:cursor:<e>` do caminho chave→JSON: mesma
 * semântica, sem ganho de desempenho. Prova a extensão sem SQLite (suíte de contrato do motor, T-0008 P1).
 */
export function comLinhasEmChaveJson(base: ArmazenamentoSync): ArmazenamentoSync {
  const mapa = async (e: string) => (await base.ler<Linhas>(CHAVE.entidade(e))) ?? {};
  const linhas: LinhasSync = {
    async aplicar(e, novas, cursor) {
      const m = await mapa(e);
      for (const l of novas) {
        if (l.deleted_at) delete m[l.id];
        else m[l.id] = l;
      }
      await base.gravar(CHAVE.entidade(e), m);
      if (cursor) await base.gravar(CHAVE.cursor(e), cursor);
    },
    listar: async <L extends LinhaSync>(e: string) => Object.values(await mapa(e)) as L[],
    async porIds<L extends LinhaSync>(e: string, ids: readonly string[]) {
      const m = await mapa(e);
      return ids.flatMap((id) => (m[id] ? [m[id] as L] : []));
    },
    ids: async (e) => Object.keys(await mapa(e)),
    contar: async (e) => Object.keys(await mapa(e)).length,
    async limpar(e) {
      await base.remover(CHAVE.entidade(e));
      await base.remover(CHAVE.cursor(e));
    },
  };
  return {
    ler: (c) => base.ler(c),
    gravar: (c, v) => base.gravar(c, v),
    remover: (c) => base.remover(c),
    chaves: (p) => base.chaves(p),
    linhas,
  };
}

/** Visão de um armazenamento restrita a um prefixo (ex.: `mod:vendedor:`), apagada junto com o módulo. Só a base: nunca `linhas`. */
export function comPrefixo(base: ArmazenamentoSync, prefixo: string): ArmazenamentoSync {
  return {
    ler: (c) => base.ler(prefixo + c),
    gravar: (c, v) => base.gravar(prefixo + c, v),
    remover: (c) => base.remover(prefixo + c),
    chaves: async (p) => (await base.chaves(prefixo + p)).map((k) => k.slice(prefixo.length)),
  };
}

// ---------- outbox ----------

export type SituacaoItemOutbox = 'pendente' | 'falhou' | 'modulo_inativo';

export interface ItemOutbox {
  /** UUID gerado no aparelho = chave de idempotência no servidor. */
  id: string;
  entidade: string;
  modulo: ModuloId;
  operacao: 'upsert' | 'remover';
  payload: unknown;
  /** Texto curto para a tela de sync (ex.: "Pedido · Auto Peças Rio Negro"). */
  rotulo: string;
  detalhe: string;
  criado_em: string;
  tentativas: number;
  ultimo_erro: string;
  ultima_tentativa_em: string | null;
  situacao: SituacaoItemOutbox;
  /**
   * Código devolvido pelo servidor na rejeição (RN-..., MODULO_INATIVO, PAYLOAD_INVALIDO…). Com `situacao` `pendente`,
   * um código retentável (`SYNC_NAO_IMPLEMENTADO`) = "envio ainda não disponível no servidor" (ADR 0009 §7).
   */
  codigo: string | null;
}

/** Aviso da última sincronização (não é erro: ela terminou). Ex.: entidade ainda sem provedor no servidor. */
export interface AvisoSync {
  entidade: string;
  codigo: string;
  mensagem: string;
}

/**
 * Item ACEITO pelo servidor que a tela continua sobrepondo às linhas até o pull trazer a linha (ADR 0009 §3, D-3).
 * Não conta como "na fila" (`estado.fila`); fica em `estado.aceitos`.
 */
export interface ItemAceito extends Omit<ItemOutbox, 'situacao'> {
  situacao: 'aceito';
  /** Relógio do aparelho quando a resposta chegou. */
  aceito_em: string;
  /** Instante do servidor (banco) depois de gravar (`ResultadoItemPush.em`); `null` = servidor não informou. */
  aceito_servidor_em: string | null;
}

/** O que a tela sobrepõe às linhas do pull: itens `pendente`/`falhou` da fila e os `aceito` ainda não cobertos. */
export type ItemSobreposicao = ItemOutbox | ItemAceito;

/**
 * Sem `horizonte`/`em` do servidor (ex.: servidor da Fase M), o pull só cobre o aceite se começou esta margem depois
 * dele no relógio do aparelho (o horizonte do servidor fica ao menos 2 s atrás do relógio dele; ADR 0006).
 */
export const MARGEM_ACEITE_SEM_HORIZONTE_MS = 5_000;

/**
 * Itens para a sobreposição (ADR 0009 §3), na ordem em que foram criados: aceitos ainda não cobertos pelo pull e
 * `pendente`/`falhou` da fila (`modulo_inativo` fica de fora). Pura sobre o estado: use em `useMemo` com
 * `[estado.fila, estado.aceitos]`. `entidades` filtra (ex.: `['visita', 'visita_checkout']`).
 */
export function itensParaSobrepor(
  estado: Pick<EstadoMotorSync, 'fila' | 'aceitos'>,
  entidades?: readonly string[],
): ItemSobreposicao[] {
  const quer = entidades ? new Set(entidades) : null;
  const daFila = estado.fila.filter((i) => i.situacao === 'pendente' || i.situacao === 'falhou');
  // sort estável: no empate de `criado_em`, o aceito (que estava antes na fila) vem primeiro
  return [...estado.aceitos, ...daFila]
    .filter((i) => !quer || quer.has(i.entidade))
    .sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : 0));
}

// ---------- fila de arquivos (ADR 0010 §4) ----------

/** `enviado` = aceito pelo servidor; fica na fila só até apagar o arquivo local (7 dias). */
export type SituacaoArquivo = SituacaoItemOutbox | 'enviado';

export interface ItemArquivo {
  /** UUID gerado no aparelho (o mesmo que o comando do módulo referencia). */
  id: string;
  modulo: ModuloId;
  /** Caminho relativo aos documentos do app (padrão `fotos/<id>.jpg`). */
  caminho: string;
  tipo: TipoArquivo;
  rotulo: string;
  criado_em: string;
  tentativas: number;
  ultimo_erro: string;
  ultima_tentativa_em: string | null;
  situacao: SituacaoArquivo;
  codigo: string | null;
  enviado_em: string | null;
}

export interface NovoArquivoFila {
  id: string;
  modulo: ModuloId;
  /** Padrão: `caminhoFoto(id)` (`fotos/<id>.jpg`, onde a câmera do shell grava). */
  caminho?: string;
  tipo?: TipoArquivo;
  /** Texto curto para a tela de sync (ex.: "Foto da fachada · Auto Peças Um"). */
  rotulo?: string;
}

export interface NovoItemOutbox {
  id: string;
  entidade: string;
  operacao?: 'upsert' | 'remover';
  payload: unknown;
  rotulo?: string;
  detalhe?: string;
}

/**
 * Etapa de carga própria de um módulo (ex.: carga REST da Fase M enquanto `/v1/sync/pull` não existe).
 * Recebe o ambiente do aparelho (`ctx.http`, `ctx.online()`, `ctx.novoId()`, `ctx.usuario()`) — ver `ambiente.ts`.
 */
export interface EtapaSync {
  id: string;
  rotulo: string;
  modulo: ModuloId;
  executar(ctx: ContextoEtapaSync): Promise<void>;
  /**
   * ADR 0021: a base do servidor foi recriada ou restaurada. A etapa apaga do armazenamento do módulo (`ctx.armazenamento`)
   * o que é cópia do servidor e guarda o que é do usuário (rascunho). Roda depois do envio da fila e antes do pull completo,
   * em todas as etapas registradas. Erro aqui = a sincronização termina com erro e a troca é repetida na próxima.
   */
  aoTrocarGeracao?(ctx: ContextoEtapaSync): Promise<void>;
}

export interface ContextoEtapaSync extends AmbienteModulo {
  /** Armazenamento do módulo (prefixo `mod:<modulo>:`): apagado quando o módulo é desativado. */
  armazenamento: ArmazenamentoSync;
  agora: () => Date;
}

export interface EstadoMotorSync {
  fila: readonly ItemOutbox[];
  /** Aceitos pelo servidor e ainda sobrepostos até o pull trazer a linha (D-3). Não são "itens na fila". */
  aceitos: readonly ItemAceito[];
  enviando: boolean;
  sincronizando: boolean;
  /** Rótulo da etapa em andamento da sincronização completa. */
  etapa: string;
  /** 0..1 */
  progresso: number;
  erro: string | null;
  sincronizado_em: string | null;
  modulosAtivos: readonly ModuloId[];
  /** RN-CORE-02: módulos desativados com itens não enviados, aguardando o "ok" do usuário. */
  limpezaPendente: readonly ModuloId[];
  /** Avisos da última sincronização (ADR 0009 §7: "ainda não disponível no servidor"). */
  avisos: readonly AvisoSync[];
  /** Fila de arquivos (ADR 0010 §4), incluindo os `enviado` ainda guardados no aparelho. */
  arquivos: readonly ItemArquivo[];
  /**
   * T-0059: posição da sincronização completa, para a tela (frases por módulo, sem nome técnico) e para retomar. `entidade`
   * e `modulo` = o que está sendo puxado agora (na etapa extra, `entidade` = id da etapa); `concluidas`/`total` contam
   * entidades + etapas; `paginas` = páginas já gravadas da entidade atual; `retomada` = esta passada continuou uma
   * sincronização interrompida (o app foi encerrado no meio) e pulou o que já estava gravado.
   */
  carga: ProgressoCarga;
}

export interface ProgressoCarga {
  entidade: string | null;
  modulo: ModuloId | null;
  concluidas: number;
  total: number;
  paginas: number;
  retomada: boolean;
}

/**
 * Registro da CARGA INICIAL em andamento, gravado no armazenamento a cada entidade ou etapa concluída (T-0059). Se o app é
 * encerrado no meio, a próxima `sincronizar()` pula o que já foi concluído (retoma de onde parou). Some quando a carga
 * termina. Mais velho que `VALIDADE_RETOMADA_MS` é ignorado (a passada recomeça; cada entidade do seu cursor).
 */
interface RegistroCarga {
  iniciada_em: string;
  concluidas: string[];
  /** Cobertura de cada entidade concluída (D-3): a retomada solta os aceitos que as entidades já puxadas cobrem. */
  coberturas?: Record<string, { horizonte: string | null; inicio: string } | 'indisponivel'>;
}

/** Passada interrompida há mais que isto não é retomada: tudo é conferido de novo (cada entidade continua do seu cursor). */
export const VALIDADE_RETOMADA_MS = 6 * 60 * 60_000;

/**
 * Ressincronização de uma entidade em andamento (ADR 0009 §4), gravada ANTES de cada página (T-0059). `vistos` = ids já
 * recebidos nesta passada (para apagar no fim o que saiu do escopo); `null` = carga inicial (nada local para apagar).
 */
interface RegistroRessinc {
  versao: string;
  vistos: string[] | null;
}

/** Posição vazia da carga (estado inicial; telas e testes que montam um `EstadoMotorSync`). */
export const CARGA_VAZIA: ProgressoCarga = Object.freeze({ entidade: null, modulo: null, concluidas: 0, total: 0, paginas: 0, retomada: false });

export interface OpcoesMotorSync {
  registro: RegistroSync;
  armazenamento: ArmazenamentoSync;
  transporte: TransporteSync;
  agora?: () => Date;
  /** `false` = sem sinal / modo sem sinal: nada sai do aparelho. Padrão: `ambiente.online` ou sempre `true`. */
  online?: () => boolean;
  /**
   * Ambiente do aparelho (HTTP com sessão, sinal, UUID, usuário) entregue às etapas (`ctx`) e às telas
   * (`motor.ambiente`). Sem ele, `ctx.http` falha com mensagem em português (`ambienteIndisponivel`).
   */
  ambiente?: AmbienteAparelho;
  /** Etapas extras de carga, por módulo; rodam depois do pull genérico, só de módulos efetivos. */
  etapas?: readonly EtapaSync[];
  /** Mensagem legível de um erro de transporte (o shell traduz HttpError etc.). */
  mensagemDeErro?: (e: unknown) => string;
  /** Leitura (e remoção) dos arquivos locais da fila de arquivos. Sem ela, os arquivos ficam na fila sem envio. */
  arquivos?: ArquivosLocais;
  /**
   * Consultas entre módulos no aparelho (`criarShell(...).consultas`, ADR 0012): `ambiente.consultar`. Sem ele, toda
   * consulta dá `ConsultaIndisponivel`.
   */
  consultas?: RegistroConsultasAparelho;
}

/** Parâmetros do tenant por módulo (`GET /v1/me/modulos`), guardados para valer offline (T-0029 E3). */
export type ParametrosModulos = Partial<Record<ModuloId, Readonly<Record<string, unknown>>>>;

const CHAVE = {
  fila: 'sync:fila',
  /** Itens aceitos ainda sobrepostos (D-3, ADR 0009 §3). */
  aceitos: 'sync:aceitos',
  /** Fila de arquivos (ADR 0010 §4), separada da fila de itens. */
  arquivos: 'sync:arquivos',
  modulos: 'sync:modulos',
  /** Parâmetros do tenant dos módulos ativos (E3): só os de módulos ativos; somem com o módulo (RN-CORE-02). */
  parametros: 'sync:parametros',
  limpeza: 'sync:limpeza_pendente',
  sincronizadoEm: 'sync:sincronizado_em',
  cursor: (e: string) => `sync:cursor:${e}`,
  /** Última `versao_escopo` recebida da entidade (ADR 0009 §4). */
  escopo: (e: string) => `sync:escopo:${e}`,
  /** Ressincronização em andamento da entidade (T-0059): retomada sem voltar ao início. */
  ressinc: (e: string) => `sync:ressinc:${e}`,
  /** Sincronização completa em andamento (T-0059): entidades e etapas já concluídas. */
  carga: 'sync:carga',
  /** Cursor de `GET /v1/sync/novidades` (RN-CORE-23, ADR 0018): grava só depois de puxar o que ele apontou. */
  novidades: 'sync:novidades',
  /** Última `geracao_base` vista no servidor (ADR 0021). */
  geracao: 'sync:geracao_base',
  entidade: (e: string) => `ent:${e}`,
  modulo: (m: string) => `mod:${m}:`,
};

export const ROTULO_SITUACAO: Readonly<Record<SituacaoItemOutbox, string>> = {
  pendente: 'na fila',
  falhou: 'não enviado — corrija ou descarte',
  modulo_inativo: 'não enviado — módulo desativado',
};

/** Rótulo do item na tela de sync, distinguindo o pendente retido pelo servidor (ADR 0009 §7) do pendente comum. */
export function rotuloDoItem(item: Pick<ItemOutbox, 'situacao' | 'codigo'>): string {
  if (item.situacao === 'pendente' && item.codigo && CODIGOS_RETENTAVEIS.includes(item.codigo))
    return 'na fila — envio ainda não disponível no servidor';
  return ROTULO_SITUACAO[item.situacao];
}

/** Situação do arquivo na tela de sync. */
export function rotuloDoArquivo(a: Pick<ItemArquivo, 'situacao' | 'codigo'>): string {
  if (a.situacao === 'enviado') return 'enviado';
  if (a.situacao === 'pendente' && a.codigo && CODIGOS_ARQUIVO_RETENTAVEIS.includes(a.codigo))
    return 'na fila — aguardando o registro chegar ao servidor';
  return ROTULO_SITUACAO[a.situacao];
}

const UUID_ARQUIVO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA_MS = 86_400_000;

/** Mensagem do aviso de entidade sem provedor no servidor. */
export const MENSAGEM_PULL_INDISPONIVEL =
  'Ainda não disponível no servidor; os outros dados foram sincronizados.';

type Linhas = Record<string, LinhaSync>;

/** Mensagem quando a geração da base muda de novo durante a própria troca (ADR 0021 §5). */
export const MENSAGEM_GERACAO_INSTAVEL =
  'A base do servidor mudou durante a sincronização. Tente sincronizar de novo em instantes; nada da fila foi perdido.';

/** Sinal interno: a página trouxe outra geração (ADR 0021). Nunca sai do motor. */
class GeracaoTrocada extends Error {
  constructor(readonly nova: string) {
    super('geração da base trocada');
    this.name = 'GeracaoTrocada';
  }
}

/** Até onde a passada completa do pull da entidade garante ter trazido as linhas (D-3); `indisponivel` = 501. */
type Cobertura = { horizonte: string | null; inicio: string } | 'indisponivel';

export function criarMotorSync(op: OpcoesMotorSync) {
  const agora = op.agora ?? (() => new Date());
  const base: AmbienteAparelho = op.ambiente ?? ambienteIndisponivel();
  const online = op.online ?? (op.ambiente ? () => base.online() : () => true);
  let parametros: ParametrosModulos = {};
  const SEM_PARAMETROS: Readonly<Record<string, unknown>> = Object.freeze({});
  const parametrosDe = (m: ModuloId): Readonly<Record<string, unknown>> =>
    (estado.modulosAtivos.includes(m) ? parametros[m] : undefined) ?? SEM_PARAMETROS;
  /** Só dos módulos ativos, congelados (o módulo não altera o que é do tenant). */
  const filtrarParametros = (p: ParametrosModulos, ativos: readonly ModuloId[]): ParametrosModulos => {
    const saida: ParametrosModulos = {};
    for (const m of ativos) if (p[m]) saida[m] = Object.freeze({ ...p[m] });
    return saida;
  };
  // o motor completa o ambiente do shell: consulta sobre as linhas locais do dono e parâmetros da última sessão
  const ambiente: AmbienteModulo = completarAmbiente(base, {
    consultar: (def, entrada) => {
      if (!op.consultas) return completarAmbiente(ambienteIndisponivel()).consultar(def, entrada);
      return op.consultas.consultar(def, entrada, {
        modulosAtivos: () => estado.modulosAtivos,
        donoDaEntidade: (e) => op.registro.entidade(e)?.modulo,
        linhas: (e) => motor.linhas(e) as never,
        linhasPorIds: (e, ids) => motor.linhasPorIds(e, ids) as never,
        agora,
        usuario: () => base.usuario(),
        parametros: parametrosDe,
      });
    },
    parametros: parametrosDe,
  });
  const msg = op.mensagemDeErro ?? ((e: unknown) => (e instanceof Error ? e.message : String(e)));
  const ouvintes = new Set<(e: EstadoMotorSync) => void>();

  let estado: EstadoMotorSync = {
    fila: [],
    aceitos: [],
    enviando: false,
    sincronizando: false,
    etapa: '',
    progresso: 0,
    erro: null,
    sincronizado_em: null,
    modulosAtivos: [],
    limpezaPendente: [],
    avisos: [],
    arquivos: [],
    carga: CARGA_VAZIA,
  };
  let envioEmCurso: Promise<ResultadoItemPush[]> | null = null;
  let syncEmCurso: Promise<boolean> | null = null;

  const mudar = (parcial: Partial<EstadoMotorSync>) => {
    estado = { ...estado, ...parcial };
    for (const f of ouvintes) f(estado);
  };

  const gravarFila = async (fila: ItemOutbox[]) => {
    mudar({ fila });
    await op.armazenamento.gravar(CHAVE.fila, fila);
  };

  const gravarAceitos = async (aceitos: ItemAceito[]) => {
    mudar({ aceitos });
    await op.armazenamento.gravar(CHAVE.aceitos, aceitos);
  };

  /**
   * Fila e aceitos mudam juntos no estado (a tela nunca vê o item fora dos dois). No disco, aceitos primeiro: se o app
   * cair entre as gravações, o item fica nos dois — é reenviado (idempotente) e a sobreposição repetida é inofensiva.
   */
  const gravarFilaEAceitos = async (fila: ItemOutbox[], aceitos: ItemAceito[]) => {
    mudar({ fila, aceitos });
    await op.armazenamento.gravar(CHAVE.aceitos, aceitos);
    await op.armazenamento.gravar(CHAVE.fila, fila);
  };

  /** O pull cobre o aceite? Com os campos do servidor, compara no relógio do banco; sem eles, no do aparelho. */
  const cobre = (item: ItemAceito, c: Cobertura | undefined): boolean => {
    if (c === undefined) return false;
    if (c === 'indisponivel') return true;
    if (item.aceito_servidor_em && c.horizonte) return Date.parse(c.horizonte) > Date.parse(item.aceito_servidor_em);
    return Date.parse(c.inicio) - MARGEM_ACEITE_SEM_HORIZONTE_MS > Date.parse(item.aceito_em);
  };

  /**
   * Entidades de pull que precisam cobrir o aceite: a própria (estado, `ambos`) ou, num comando só de push
   * (`visita_checkout`, `notificacao_leitura`), todas as de pull do mesmo módulo. Nenhuma = nada a esperar.
   */
  const alvosDoAceite = (item: ItemAceito): string[] => {
    const def = op.registro.entidade(item.entidade);
    if (def?.direcao === 'ambos') return [def.nome];
    return op.registro.entidadesAtivas([item.modulo], 'pull').map((e) => e.nome);
  };

  /** Fim da sincronização: sai da sobreposição o aceito cuja linha o pull já trouxe (D-3). */
  const liberarAceitos = async (coberturas: ReadonlyMap<string, Cobertura>) => {
    if (estado.aceitos.length === 0) return;
    const ficam = estado.aceitos.filter((i) => !alvosDoAceite(i).every((e) => cobre(i, coberturas.get(e))));
    if (ficam.length !== estado.aceitos.length) await gravarAceitos(ficam);
  };

  /** RN-CORE-02: os aceitos do módulo desativado saem da sobreposição (os dados dele saem do aparelho). */
  const descartarAceitosDoModulo = async (modulo: ModuloId) => {
    if (estado.aceitos.some((i) => i.modulo === modulo))
      await gravarAceitos(estado.aceitos.filter((i) => i.modulo !== modulo));
  };

  const gravarArquivos = async (arquivos: ItemArquivo[]) => {
    mudar({ arquivos });
    await op.armazenamento.gravar(CHAVE.arquivos, arquivos);
  };

  /** Apaga o arquivo local sem derrubar o fluxo (arquivo já ausente não é erro). */
  const removerLocal = async (caminho: string) => {
    try {
      await op.arquivos?.remover?.(caminho);
    } catch {
      // o arquivo pode já não existir; a fila segue
    }
  };

  /** Arquivo ainda não aceito do módulo (conta para a limpeza pendente, RN-CORE-02). */
  const temArquivoPendente = (modulo: ModuloId) =>
    estado.arquivos.some((a) => a.modulo === modulo && a.situacao !== 'enviado');

  /** RN-CORE-02: os arquivos do módulo desativado saem da fila e do aparelho. */
  const descartarArquivosDoModulo = async (modulo: ModuloId) => {
    const doModulo = estado.arquivos.filter((a) => a.modulo === modulo);
    if (doModulo.length === 0) return;
    await gravarArquivos(estado.arquivos.filter((a) => a.modulo !== modulo));
    for (const a of doModulo) await removerLocal(a.caminho);
  };

  const gravarLimpeza = async (limpezaPendente: ModuloId[]) => {
    mudar({ limpezaPendente });
    await op.armazenamento.gravar(CHAVE.limpeza, limpezaPendente);
  };

  const ativos = () => new Set(estado.modulosAtivos);

  const entidadesDoModulo = (modulo: ModuloId) => op.registro.entidadesAtivas([modulo]).map((e) => e.nome);

  /** Tudo-ou-nada quando o adaptador sabe (`emTransacao`); senão, em sequência (chave→JSON). */
  const emTransacao = <T>(fn: (a: ArmazenamentoSync) => Promise<T>): Promise<T> =>
    op.armazenamento.emTransacao ? op.armazenamento.emTransacao(fn) : fn(op.armazenamento);

  /** RN-CORE-02: linhas, cursores e versões de escopo das entidades, chaves `mod:<m>:` e estruturas próprias do módulo. */
  const limparModulo = async (modulo: ModuloId, a: ArmazenamentoSync) => {
    for (const e of entidadesDoModulo(modulo)) {
      if (a.linhas) await a.linhas.limpar(e);
      else {
        await a.remover(CHAVE.entidade(e));
        await a.remover(CHAVE.cursor(e));
      }
      await a.remover(CHAVE.escopo(e));
      await a.remover(CHAVE.ressinc(e));
    }
    for (const k of await a.chaves(CHAVE.modulo(modulo))) await a.remover(k);
    await a.removerModulo?.(modulo);
  };

  /** Contexto de uma etapa de módulo (`executar` e `aoTrocarGeracao`). */
  const contextoDaEtapa = (e: EtapaSync): ContextoEtapaSync => ({
    armazenamento: comPrefixo(op.armazenamento, CHAVE.modulo(e.modulo)),
    agora,
    http: ambiente.http,
    online,
    novoId: () => ambiente.novoId(),
    usuario: () => ambiente.usuario(),
    consultar: ambiente.consultar,
    parametros: ambiente.parametros,
  });

  // ---------- geração da base (ADR 0021) ----------
  /** `undefined` = ainda não lida do armazenamento. */
  let geracaoGuardada: string | null | undefined;
  const lerGeracao = async (): Promise<string | null> => {
    if (geracaoGuardada === undefined) geracaoGuardada = await op.armazenamento.ler<string>(CHAVE.geracao);
    return geracaoGuardada;
  };
  const gravarGeracao = async (g: string) => {
    const valor = normalizarGeracao(g);
    await op.armazenamento.gravar(CHAVE.geracao, valor);
    geracaoGuardada = valor;
  };
  /** Adota a primeira geração vista; outra = `GeracaoTrocada` (quem sincroniza faz a troca e recomeça). */
  const conferirGeracao = async (recebida: string | null | undefined): Promise<void> => {
    const decisao = decidirGeracao(await lerGeracao(), recebida);
    if (decisao === 'adotar') await gravarGeracao(recebida!);
    else if (decisao === 'trocou') throw new GeracaoTrocada(recebida!);
  };

  /**
   * Troca de geração (ADR 0021 §5), idempotente: se o app cair no meio, a geração guardada ainda é a antiga e a próxima
   * sincronização repete tudo. Nada da fila de itens nem da fila de arquivos é apagado.
   */
  const trocarGeracao = async (nova: string): Promise<void> => {
    mudar({ etapa: 'A base do servidor mudou: enviando a fila', progresso: 0 });
    // 1. aceitos ainda sobrepostos voltam para a fila (a base nova pode não ter recebido)
    if (estado.aceitos.length > 0) await gravarFilaEAceitos(filaNaTrocaDeGeracao(estado.fila, estado.aceitos), []);
    // 2. a fila vai primeiro (o que a base nova recusar fica `falhou`, visível)
    await motor.enviar();
    mudar({ etapa: 'A base do servidor mudou: recarregando os dados' });
    // 3. cópia local do servidor: linhas, cursores, escopos, ressincronizações, carga e cursor de novidades
    await emTransacao(async (a) => {
      for (const { nome } of op.registro.entidadesAtivas(MODULOS)) {
        if (a.linhas) await a.linhas.limpar(nome);
        else {
          await a.remover(CHAVE.entidade(nome));
          await a.remover(CHAVE.cursor(nome));
        }
        await a.remover(CHAVE.escopo(nome));
        await a.remover(CHAVE.ressinc(nome));
      }
      await a.remover(CHAVE.carga);
      await a.remover(CHAVE.novidades);
    });
    // 4. cache próprio de cada módulo (só ele sabe o que é cópia do servidor e o que é rascunho)
    for (const e of op.etapas ?? []) if (e.aoTrocarGeracao) await e.aoTrocarGeracao(contextoDaEtapa(e));
    // 5. só agora: a geração nova vale
    await gravarGeracao(nova);
  };

  // ---------- envio (push) ----------
  const enviarAgora = async (incluirFalhos: boolean): Promise<ResultadoItemPush[]> => {
    const resultados: ResultadoItemPush[] = [];
    if (!online()) return resultados;
    if (incluirFalhos) {
      await gravarFila(
        estado.fila.map((i) => (i.situacao === 'falhou' ? { ...i, situacao: 'pendente' as const } : i)),
      );
    }
    // itens de módulo recém-desativado continuam 'pendente' e vão: o servidor devolve MODULO_INATIVO e o usuário vê (RN-CORE-02)
    const aEnviar = estado.fila.filter((i) => i.situacao === 'pendente');
    if (aEnviar.length === 0) return resultados;
    mudar({ enviando: true });
    try {
      for (let i = 0; i < aEnviar.length; i += MAX_ITENS_PUSH) {
        if (!online()) break;
        const lote = aEnviar.slice(i, i + MAX_ITENS_PUSH);
        const quando = agora().toISOString();
        let resposta: ResultadoItemPush[];
        try {
          resposta = await op.transporte.push(
            lote.map((it) => ({
              entidade: it.entidade,
              id: it.id,
              operacao: it.operacao,
              payload: it.payload,
            })),
          );
        } catch (e) {
          const ids = new Set(lote.map((it) => it.id));
          const erro = msg(e);
          await gravarFila(
            estado.fila.map((it) =>
              ids.has(it.id)
                ? { ...it, tentativas: it.tentativas + 1, ultimo_erro: erro, ultima_tentativa_em: quando }
                : it,
            ),
          );
          break;
        }
        const porId = new Map(resposta.map((r) => [r.id, r] as const));
        resultados.push(...resposta);
        let parar = false;
        const fila: ItemOutbox[] = [];
        const aceitos: ItemAceito[] = [];
        for (const it of estado.fila) {
          const r = porId.get(it.id);
          if (!lote.some((l) => l.id === it.id)) {
            fila.push(it);
          } else if (!r) {
            parar = true;
            fila.push({
              ...it,
              tentativas: it.tentativas + 1,
              ultimo_erro: 'O servidor não respondeu por este item.',
              ultima_tentativa_em: quando,
            });
          } else if (r.status === 'aceito') {
            // enviado: sai da fila, mas continua sobreposto até o pull trazer a linha (D-3, ADR 0009 §3)
            aceitos.push({
              ...it,
              situacao: 'aceito',
              tentativas: it.tentativas + 1,
              ultimo_erro: '',
              ultima_tentativa_em: quando,
              codigo: null,
              aceito_em: agora().toISOString(),
              aceito_servidor_em: r.em ?? null,
            });
          } else if (r.status === 'rejeitado' && CODIGOS_RETENTAVEIS.includes(r.codigo)) {
            // ADR 0009 §7: o servidor ainda não recebe a entidade — o item não tem culpa, continua na fila
            fila.push({
              ...it,
              tentativas: it.tentativas + 1,
              ultimo_erro: r.mensagem,
              ultima_tentativa_em: quando,
              situacao: 'pendente',
              codigo: r.codigo,
            });
          } else if (r.status === 'rejeitado') {
            const situacao: SituacaoItemOutbox = r.codigo === 'MODULO_INATIVO' ? 'modulo_inativo' : 'falhou';
            fila.push({
              ...it,
              tentativas: it.tentativas + 1,
              ultimo_erro: r.mensagem,
              ultima_tentativa_em: quando,
              situacao,
              codigo: r.codigo,
            });
          } else {
            fila.push({
              ...it,
              tentativas: it.tentativas + 1,
              ultimo_erro: r.mensagem,
              ultima_tentativa_em: quando,
              situacao: 'falhou',
              codigo: 'CONFLITO',
            });
          }
        }
        if (aceitos.length > 0) {
          const novos = new Set(aceitos.map((x) => x.id));
          await gravarFilaEAceitos(fila, [...estado.aceitos.filter((x) => !novos.has(x.id)), ...aceitos]);
        } else await gravarFila(fila);
        if (parar) break;
      }
    } finally {
      mudar({ enviando: false });
    }
    return resultados;
  };

  // ---------- envio de arquivos (ADR 0010 §4) ----------
  const enviarArquivosAgora = async (incluirFalhos: boolean): Promise<void> => {
    const ler = op.arquivos?.ler;
    const enviarArquivo = op.transporte.enviarArquivo?.bind(op.transporte);
    // aceitos há 7 dias ou mais: apaga o arquivo local e sai da fila (a tela já não precisa da foto offline)
    const limite = agora().getTime() - DIAS_RETENCAO_ARQUIVO_LOCAL * DIA_MS;
    const vencidos = estado.arquivos.filter(
      (a) => a.situacao === 'enviado' && a.enviado_em !== null && Date.parse(a.enviado_em) <= limite,
    );
    if (vencidos.length > 0) {
      const ids = new Set(vencidos.map((a) => a.id));
      await gravarArquivos(estado.arquivos.filter((a) => !ids.has(a.id)));
      for (const a of vencidos) await removerLocal(a.caminho);
    }
    if (incluirFalhos && estado.arquivos.some((a) => a.situacao === 'falhou'))
      await gravarArquivos(
        estado.arquivos.map((a) => (a.situacao === 'falhou' ? { ...a, situacao: 'pendente' as const } : a)),
      );
    if (!ler || !enviarArquivo || !online()) return;
    const aEnviar = estado.arquivos.filter((a) => a.situacao === 'pendente').map((a) => a.id);
    const atualizar = (id: string, mudanca: Partial<ItemArquivo>) =>
      gravarArquivos(estado.arquivos.map((a) => (a.id === id ? { ...a, ...mudanca } : a)));
    for (const id of aEnviar) {
      if (!online()) break;
      const item = estado.arquivos.find((a) => a.id === id);
      if (!item || item.situacao !== 'pendente') continue; // descartado durante o envio
      const quando = agora().toISOString();
      const tentativas = item.tentativas + 1;
      const bytes = await ler(item.caminho).catch(() => null);
      if (!bytes) {
        await atualizar(id, {
          situacao: 'falhou',
          codigo: CODIGOS_ARQUIVO.ausenteNoAparelho,
          ultimo_erro: 'O arquivo não está mais no aparelho. Descarte e registre de novo.',
          tentativas,
          ultima_tentativa_em: quando,
        });
        continue;
      }
      let r: ResultadoEnvioArquivo;
      try {
        r = await enviarArquivo({ id: item.id, tipo: item.tipo, bytes });
      } catch (e) {
        // sem rede / 5xx: conta a tentativa e para (os próximos também falhariam)
        await atualizar(id, { tentativas, ultimo_erro: msg(e), ultima_tentativa_em: quando });
        break;
      }
      if (r.status === 'aceito') {
        await atualizar(id, {
          situacao: 'enviado',
          enviado_em: quando,
          codigo: null,
          ultimo_erro: '',
          tentativas,
          ultima_tentativa_em: quando,
        });
        continue;
      }
      const situacao: SituacaoArquivo = CODIGOS_ARQUIVO_RETENTAVEIS.includes(r.codigo)
        ? 'pendente'
        : r.codigo === 'MODULO_INATIVO'
          ? 'modulo_inativo'
          : 'falhou';
      await atualizar(id, { situacao, codigo: r.codigo, ultimo_erro: r.mensagem, tentativas, ultima_tentativa_em: quando });
    }
  };

  // ---------- recebimento (pull) ----------
  /**
   * Puxa todas as páginas da entidade. `'indisponivel'` = o servidor respondeu 501 `SYNC_NAO_IMPLEMENTADO` (nada
   * muda no aparelho). Ressincroniza quando a `versao_escopo` da página difere da guardada (ADR 0009 §4).
   */
  const puxarEntidade = async (
    entidade: string,
    coberturas?: Map<string, Cobertura>,
    aoGravarPagina?: () => void,
  ): Promise<'ok' | 'indisponivel'> => {
    const a = op.armazenamento;
    const inicio = agora().toISOString();
    /** Menor horizonte entre as páginas: a passada inteira trouxe toda linha com `updated_at` abaixo dele (D-3). */
    let horizonte: string | null = null;
    let semHorizonte = false;
    const versaoGuardada = await a.ler<string>(CHAVE.escopo(entidade));
    const ressincGuardada = await a.ler<RegistroRessinc>(CHAVE.ressinc(entidade));
    let cursor = await a.ler<string>(CHAVE.cursor(entidade));
    /** Carga inicial: nunca recebeu versão nem página — não há linha local de outra passada para apagar no fim. */
    const cargaInicial = versaoGuardada === null && cursor === null;
    // caminho chave→JSON: o mapa é lido uma vez e regravado por página (com `linhas`, o adaptador grava por linha)
    const mapa: Linhas = a.linhas ? {} : ((await a.ler<Linhas>(CHAVE.entidade(entidade))) ?? {});
    /** `vistos` nulo = carga inicial (nada a apagar no fim). */
    let ressinc: { versao: string; vistos: Set<string> | null } | null = null;
    const gravarRessinc = (r: { versao: string; vistos: Set<string> | null }) =>
      a.gravar(CHAVE.ressinc(entidade), { versao: r.versao, vistos: r.vistos ? [...r.vistos] : null } satisfies RegistroRessinc);
    for (;;) {
      let pagina: PaginaSync<LinhaSync>;
      try {
        pagina = await op.transporte.pull(entidade, cursor);
      } catch (e) {
        if (ehSyncNaoImplementado(e) && !ressinc) {
          coberturas?.set(entidade, 'indisponivel');
          return 'indisponivel';
        }
        throw e;
      }
      // ADR 0021: outra geração = a base foi recriada; nada desta página é aplicado sobre a cópia antiga
      await conferirGeracao(pagina.geracao_base);
      if (!pagina.horizonte) semHorizonte = true;
      else if (horizonte === null || Date.parse(pagina.horizonte) < Date.parse(horizonte)) horizonte = pagina.horizonte;
      const versao = pagina.versao_escopo;
      if (!ressinc && versao !== undefined && versao !== versaoGuardada) {
        if (cursor !== null && ressincGuardada?.versao === versao) {
          // T-0059: a passada desta mesma versão foi interrompida (app encerrado): continua do cursor gravado, sem recomeçar
          ressinc = { versao, vistos: ressincGuardada.vistos ? new Set(ressincGuardada.vistos) : null };
        } else {
          ressinc = { versao, vistos: cargaInicial ? null : new Set() };
          await gravarRessinc(ressinc);
          if (cursor !== null) {
            // o conjunto visível mudou: linhas antigas de quem entrou estão atrás do cursor — recomeça do início
            cursor = null;
            continue;
          }
        }
      }
      if (ressinc?.vistos) {
        for (const l of pagina.itens) ressinc.vistos.add(l.id);
        // antes de aplicar: se o app cair entre as duas gravações, `vistos` sobra (nunca falta) e nada visível é apagado
        await gravarRessinc(ressinc);
      }
      const ultimo = pagina.itens[pagina.itens.length - 1];
      const proximo = pagina.proximo_cursor ?? (ultimo ? codificarCursor(ultimo) : cursor);
      if (a.linhas) await a.linhas.aplicar(entidade, pagina.itens, proximo);
      else {
        for (const l of pagina.itens) {
          if (l.deleted_at) delete mapa[l.id];
          else mapa[l.id] = l;
        }
        await a.gravar(CHAVE.entidade(entidade), mapa);
        if (proximo) await a.gravar(CHAVE.cursor(entidade), proximo);
      }
      cursor = proximo;
      aoGravarPagina?.();
      if (!pagina.proximo_cursor) break;
    }
    if (ressinc) {
      // fim da passada completa: o que não veio saiu do escopo (RN-CORE-04) e sai do aparelho
      const { vistos, versao } = ressinc;
      if (vistos === null) {
        // carga inicial: tudo o que está no aparelho veio desta passada
      } else if (a.linhas) {
        const quando = agora().toISOString();
        const sobra = (await a.linhas.ids(entidade)).filter((id) => !vistos.has(id));
        if (sobra.length > 0)
          await a.linhas.aplicar(
            entidade,
            sobra.map((id) => ({ id, updated_at: quando, deleted_at: quando })),
            null,
          );
      } else {
        for (const id of Object.keys(mapa)) if (!vistos.has(id)) delete mapa[id];
        await a.gravar(CHAVE.entidade(entidade), mapa);
      }
      // só agora: se o app cair no meio, a próxima passada vê a versão antiga e RETOMA pela `sync:ressinc` (T-0059)
      await a.gravar(CHAVE.escopo(entidade), versao);
      await a.remover(CHAVE.ressinc(entidade));
    }
    coberturas?.set(entidade, { horizonte: semHorizonte ? null : horizonte, inicio });
    return 'ok';
  };

  /**
   * Sincronização completa (corpo de `motor.sincronizar`, sem o controle de uma-por-vez). `podeTrocar` = pode fazer a troca de
   * geração e recomeçar (ADR 0021); na passada que já recomeçou, outra troca termina com erro.
   */
  const passadaCompleta = async (podeTrocar: boolean): Promise<boolean> => {
    if (!online()) {
      mudar({ erro: 'Sem sinal: a sincronização fica para quando a conexão voltar.' });
      return false;
    }
    const defs = op.registro.entidadesAtivas(estado.modulosAtivos, 'pull');
    const entidades = defs.map((e) => e.nome);
    const moduloDe = new Map(defs.map((d) => [d.nome, d.modulo] as const));
    const etapas = (op.etapas ?? []).filter((e) => ativos().has(e.modulo));
    const total = 1 + entidades.length + etapas.length;
    // T-0059: na CARGA INICIAL (ainda sem `sincronizado_em`), uma passada anterior interrompida (app encerrado no meio) e
    // recente = pula o que ela já concluiu. Depois da carga, cada entidade já continua do seu cursor (delta barato).
    const cargaInicial = estado.sincronizado_em === null;
    const anterior = cargaInicial ? await op.armazenamento.ler<RegistroCarga>(CHAVE.carga) : null;
    const retomar =
      anterior !== null && agora().getTime() - Date.parse(anterior.iniciada_em) < VALIDADE_RETOMADA_MS;
    const registro: RegistroCarga = retomar
      ? { iniciada_em: anterior.iniciada_em, concluidas: [...anterior.concluidas], coberturas: { ...(anterior.coberturas ?? {}) } }
      : { iniciada_em: agora().toISOString(), concluidas: [], coberturas: {} };
    const jaFeitas = new Set(registro.concluidas);
    const chaveEtapa = (id: string) => `etapa:${id}`;
    const puladas =
      entidades.filter((e) => jaFeitas.has(e)).length + etapas.filter((e) => jaFeitas.has(chaveEtapa(e.id))).length;
    const carga = (parcial: Partial<ProgressoCarga>): ProgressoCarga => ({ ...estado.carga, ...parcial });
    mudar({
      sincronizando: true,
      erro: null,
      etapa: 'Enviando a fila',
      progresso: puladas / total,
      avisos: [],
      carga: { entidade: null, modulo: null, concluidas: puladas, total, paginas: 0, retomada: retomar && puladas > 0 },
    });
    if (cargaInicial) await op.armazenamento.gravar(CHAVE.carga, registro);
    const coberturas = new Map<string, Cobertura>();
    // entidades puladas na retomada: valem as coberturas da passada interrompida (D-3)
    for (const [e, c] of Object.entries(registro.coberturas ?? {})) if (jaFeitas.has(e)) coberturas.set(e, c);
    const concluir = async (chave: string) => {
      registro.concluidas.push(chave);
      const c = coberturas.get(chave);
      if (c !== undefined) registro.coberturas = { ...(registro.coberturas ?? {}), [chave]: c };
      if (cargaInicial) await op.armazenamento.gravar(CHAVE.carga, registro);
    };
    try {
      await motor.enviar();
      // ADR 0018: cursor-base das novidades lido ANTES dos pulls (o horizonte dele fica abaixo do de cada pull). Retomada
      // com entidades puladas não grava (elas foram puxadas antes deste horizonte). Servidor sem a rota: segue sem cursor.
      const base =
        op.transporte.novidades && puladas === 0 ? await op.transporte.novidades(null).catch(() => null) : null;
      let feito = 1 + puladas;
      const avisos: AvisoSync[] = [];
      for (const e of entidades) {
        if (jaFeitas.has(e)) continue;
        mudar({ etapa: e, progresso: feito / total, carga: carga({ entidade: e, modulo: moduloDe.get(e) ?? null, paginas: 0 }) });
        const resultado = await puxarEntidade(e, coberturas, () => mudar({ carga: carga({ paginas: estado.carga.paginas + 1 }) }));
        if (resultado === 'indisponivel') {
          avisos.push({
            entidade: e,
            codigo: SYNC_NAO_IMPLEMENTADO,
            mensagem: MENSAGEM_PULL_INDISPONIVEL,
          });
          mudar({ avisos: [...avisos] });
        }
        feito++;
        await concluir(e);
        mudar({ carga: carga({ concluidas: feito - 1 }) });
      }
      for (const e of etapas) {
        if (jaFeitas.has(chaveEtapa(e.id))) continue;
        mudar({ etapa: e.rotulo, progresso: feito / total, carga: carga({ entidade: e.id, modulo: e.modulo, paginas: 0 }) });
        await e.executar(contextoDaEtapa(e));
        feito++;
        await concluir(chaveEtapa(e.id));
        mudar({ carga: carga({ concluidas: feito - 1 }) });
      }
      // carga em massa da busca: `rebuild` uma vez no fim (desenho T-0008 §2.3)
      await op.armazenamento.busca?.finalizar?.();
      await liberarAceitos(coberturas);
      const quando = agora().toISOString();
      await op.armazenamento.gravar(CHAVE.sincronizadoEm, quando);
      if (base) await op.armazenamento.gravar(CHAVE.novidades, base.cursor);
      else await op.armazenamento.remover(CHAVE.novidades);
      if (cargaInicial) await op.armazenamento.remover(CHAVE.carga);
      mudar({
        sincronizando: false,
        etapa: 'Pronto',
        progresso: 1,
        sincronizado_em: quando,
        carga: carga({ entidade: null, modulo: null, concluidas: total, paginas: 0 }),
      });
      return true;
    } catch (e) {
      if (e instanceof GeracaoTrocada) return depoisDaGeracaoTrocada(e, podeTrocar);
      // o que já foi puxado nesta passada vale: sai da sobreposição o aceito que as entidades que chegaram cobrem
      await liberarAceitos(coberturas).catch(() => undefined);
      mudar({ sincronizando: false, etapa: '', progresso: 0, erro: msg(e) });
      return false;
    }
  };

  /** ADR 0021: troca a geração e faz a passada completa de novo (uma vez); falha na troca = erro, a próxima repete. */
  const depoisDaGeracaoTrocada = async (e: GeracaoTrocada, podeTrocar: boolean): Promise<boolean> => {
    if (!podeTrocar) {
      mudar({ sincronizando: false, etapa: '', progresso: 0, erro: MENSAGEM_GERACAO_INSTAVEL });
      return false;
    }
    try {
      await trocarGeracao(e.nova);
    } catch (erro) {
      mudar({ sincronizando: false, etapa: '', progresso: 0, erro: msg(erro) });
      return false;
    }
    return passadaCompleta(false);
  };

  const motor = {
    /** Ambiente do aparelho (o mesmo que as etapas recebem): telas usam via `useAmbiente()`. */
    ambiente,
    /** Atalho para `ambiente.http` (cliente HTTP com a sessão; respeita o modo sem sinal). */
    http: ambiente.http,

    /** Lê do armazenamento a fila, os módulos e as pendências (chamar uma vez ao abrir o app / trocar de usuário). */
    async carregar(): Promise<void> {
      const [fila, modulos, limpeza, sincronizadoEm, arquivos, aceitos, params, geracao] = await Promise.all([
        op.armazenamento.ler<ItemOutbox[]>(CHAVE.fila),
        op.armazenamento.ler<ModuloId[]>(CHAVE.modulos),
        op.armazenamento.ler<ModuloId[]>(CHAVE.limpeza),
        op.armazenamento.ler<string>(CHAVE.sincronizadoEm),
        op.armazenamento.ler<ItemArquivo[]>(CHAVE.arquivos),
        op.armazenamento.ler<ItemAceito[]>(CHAVE.aceitos),
        op.armazenamento.ler<ParametrosModulos>(CHAVE.parametros),
        op.armazenamento.ler<string>(CHAVE.geracao),
      ]);
      geracaoGuardada = geracao;
      parametros = filtrarParametros(params ?? {}, modulos ?? []);
      mudar({
        fila: fila ?? [],
        aceitos: aceitos ?? [],
        arquivos: arquivos ?? [],
        modulosAtivos: modulos ?? [],
        limpezaPendente: limpeza ?? [],
        sincronizado_em: sincronizadoEm,
        erro: null,
      });
    },

    estado(): EstadoMotorSync {
      return estado;
    },

    assinar(fn: (e: EstadoMotorSync) => void): () => void {
      ouvintes.add(fn);
      return () => ouvintes.delete(fn);
    },

    /** Põe na fila (FIFO). Mesmo id não entra duas vezes. Valida entidade, direção e payload (bug no app = exceção). */
    async enfileirar(novo: NovoItemOutbox): Promise<ItemOutbox> {
      const existente = estado.fila.find((i) => i.id === novo.id);
      if (existente) return existente;
      const def = op.registro.entidade(novo.entidade);
      if (!def || def.direcao === 'pull')
        throw new Error(`Entidade ${novo.entidade} não aceita envio (registre com direcao push/ambos)`);
      const operacao = novo.operacao ?? 'upsert';
      if (operacao === 'upsert') {
        const p = def.schema.safeParse(novo.payload);
        if (!p.success)
          throw new Error(
            `Payload inválido para ${novo.entidade}: ${p.error.issues.map((i) => i.message).join('; ')}`,
          );
      }
      const item: ItemOutbox = {
        id: novo.id,
        entidade: novo.entidade,
        modulo: def.modulo,
        operacao,
        payload: novo.payload,
        rotulo: novo.rotulo ?? novo.entidade,
        detalhe: novo.detalhe ?? '',
        criado_em: agora().toISOString(),
        tentativas: 0,
        ultimo_erro: '',
        ultima_tentativa_em: null,
        situacao: 'pendente',
        codigo: null,
      };
      await gravarFila([...estado.fila, item]);
      return item;
    },

    /** Altera um item ainda na fila (ex.: editar pedido não enviado), mantendo id e posição. */
    async alterar(
      id: string,
      mudanca: Partial<Pick<ItemOutbox, 'payload' | 'rotulo' | 'detalhe'>>,
    ): Promise<boolean> {
      if (!estado.fila.some((i) => i.id === id)) return false;
      await gravarFila(
        estado.fila.map((i) =>
          i.id === id
            ? { ...i, ...mudanca, situacao: 'pendente' as const, ultimo_erro: '', codigo: null }
            : i,
        ),
      );
      return true;
    },

    async descartar(id: string): Promise<void> {
      await gravarFila(estado.fila.filter((i) => i.id !== id));
    },

    /**
     * Põe um arquivo (foto) na fila de arquivos (ADR 0010 §4). Mesmo id não entra duas vezes. Enfileire DEPOIS do
     * comando que o referencia (`enfileirar`): o upload só é aceito quando o comando já chegou ao servidor.
     */
    async enfileirarArquivo(novo: NovoArquivoFila): Promise<ItemArquivo> {
      const id = novo.id.toLowerCase();
      const existente = estado.arquivos.find((a) => a.id === id);
      if (existente) return existente;
      if (!UUID_ARQUIVO_RE.test(id)) throw new Error('Arquivo: id precisa ser o UUID gerado no aparelho');
      const tipo = novo.tipo ?? 'image/jpeg';
      if (!(TIPOS_ARQUIVO as readonly string[]).includes(tipo)) throw new Error(`Arquivo: tipo ${tipo} não aceito`);
      const item: ItemArquivo = {
        id,
        modulo: novo.modulo,
        caminho: novo.caminho ?? caminhoFoto(id),
        tipo,
        rotulo: novo.rotulo ?? 'Foto',
        criado_em: agora().toISOString(),
        tentativas: 0,
        ultimo_erro: '',
        ultima_tentativa_em: null,
        situacao: 'pendente',
        codigo: null,
        enviado_em: null,
      };
      await gravarArquivos([...estado.arquivos, item]);
      return item;
    },

    /** Tira o arquivo da fila e apaga o arquivo local (o usuário desistiu dele ou vai registrar de novo). */
    async descartarArquivo(id: string): Promise<void> {
      const a = estado.arquivos.find((x) => x.id === id.toLowerCase());
      if (!a) return;
      await gravarArquivos(estado.arquivos.filter((x) => x.id !== a.id));
      await removerLocal(a.caminho);
    },

    /** Arquivos ainda não aceitos pelo servidor ("Fotos pendentes: N" na tela de sync). */
    arquivosPendentes(): readonly ItemArquivo[] {
      return estado.arquivos.filter((a) => a.situacao !== 'enviado');
    },

    /**
     * Envia a fila de itens em ordem e, depois, a fila de arquivos (ADR 0010 §4). Uma execução por vez (chamadas
     * simultâneas recebem a mesma promessa). Devolve os resultados dos itens.
     */
    enviar(opcoes: { incluirFalhos?: boolean } = {}): Promise<ResultadoItemPush[]> {
      if (envioEmCurso) return envioEmCurso;
      envioEmCurso = (async () => {
        const r = await enviarAgora(!!opcoes.incluirFalhos);
        await enviarArquivosAgora(!!opcoes.incluirFalhos);
        return r;
      })().finally(() => {
        envioEmCurso = null;
      });
      return envioEmCurso;
    },

    /** Sincronização completa: envia a fila, puxa as entidades dos módulos efetivos e roda as etapas extras. */
    sincronizar(): Promise<boolean> {
      if (syncEmCurso) return syncEmCurso;
      syncEmCurso = passadaCompleta(true).finally(() => {
        syncEmCurso = null;
      });
      return syncEmCurso;
    },

    /**
     * Atualização LEVE (RN-CORE-23, ADR 0018): envia a fila (só se houver pendente), consulta `GET /v1/sync/novidades`
     * com o cursor guardado, aplica os módulos efetivos se mudaram e puxa só as entidades que mudaram. Com
     * `opcoes.entidades` (lista do push silencioso), puxa só essas, sem consultar novidades (o cursor não anda).
     * Sem `transporte.novidades` ou antes da primeira sincronização completa, faz a completa (`sincronizar`).
     * Uma por vez, junto com `sincronizar` (quem chama durante uma em curso recebe a mesma promessa).
     */
    sincronizarNovidades(opcoes: { entidades?: readonly string[] } = {}): Promise<boolean> {
      const consultar = op.transporte.novidades?.bind(op.transporte);
      if (!consultar || estado.sincronizado_em === null) return motor.sincronizar();
      if (syncEmCurso) return syncEmCurso;
      syncEmCurso = (async () => {
        if (!online()) {
          mudar({ erro: 'Sem sinal: a sincronização fica para quando a conexão voltar.' });
          return false;
        }
        mudar({ sincronizando: true, erro: null, etapa: 'Verificando novidades', progresso: 0, avisos: [] });
        const coberturas = new Map<string, Cobertura>();
        const ativasPull = () => new Set(op.registro.entidadesAtivas(estado.modulosAtivos, 'pull').map((e) => e.nome));
        try {
          await motor.enviar();
          let alvo: string[];
          let cursorNovo: string | null = null;
          if (opcoes.entidades) {
            const ativas = ativasPull();
            alvo = [...new Set(opcoes.entidades)].filter((e) => ativas.has(e));
          } else {
            const r = await consultar(await op.armazenamento.ler<string>(CHAVE.novidades));
            if (r.modulos_mudaram && r.modulos) {
              const lista = r.modulos.modulos;
              await motor.aplicarModulosAtivos(
                lista.map((m) => m.id),
                Object.fromEntries(lista.map((m) => [m.id, m.parametros ?? {}])) as ParametrosModulos,
              );
            }
            // ADR 0021: base recriada → troca de geração e passada completa (o `catch` abaixo)
            await conferirGeracao(r.geracao_base);
            const ativas = ativasPull();
            alvo = [...new Set(r.entidades)].filter((e) => ativas.has(e)).sort();
            cursorNovo = r.cursor;
          }
          const avisos: AvisoSync[] = [];
          for (const [i, e] of alvo.entries()) {
            mudar({ etapa: e, progresso: (i + 1) / (alvo.length + 1) });
            if ((await puxarEntidade(e, coberturas)) === 'indisponivel')
              avisos.push({ entidade: e, codigo: SYNC_NAO_IMPLEMENTADO, mensagem: MENSAGEM_PULL_INDISPONIVEL });
          }
          if (alvo.length > 0) await op.armazenamento.busca?.finalizar?.();
          await liberarAceitos(coberturas);
          // só agora: se um pull falhar, a próxima consulta repete as mesmas entidades (nada se perde)
          if (cursorNovo) await op.armazenamento.gravar(CHAVE.novidades, cursorNovo);
          const quando = agora().toISOString();
          await op.armazenamento.gravar(CHAVE.sincronizadoEm, quando);
          mudar({ sincronizando: false, etapa: 'Pronto', progresso: 1, sincronizado_em: quando, avisos });
          return true;
        } catch (e) {
          if (e instanceof GeracaoTrocada) return depoisDaGeracaoTrocada(e, true);
          await liberarAceitos(coberturas).catch(() => undefined);
          mudar({ sincronizando: false, etapa: '', progresso: 0, erro: msg(e) });
          return false;
        }
      })().finally(() => {
        syncEmCurso = null;
      });
      return syncEmCurso;
    },

    /**
     * Novo conjunto de módulos efetivos (vindo de `GET /v1/me/modulos` no sync). RN-CORE-02: o que saiu
     * é apagado do aparelho — na hora se não há nada dele na fila; senão tenta enviar e aguarda confirmação.
     * `novosParametros` (os `parametros` de cada módulo da mesma resposta, E3) substituem os guardados; sem eles, ficam
     * os guardados dos módulos que continuam ativos. Os de módulo que saiu somem na hora.
     */
    async aplicarModulosAtivos(modulos: readonly ModuloId[], novosParametros?: ParametrosModulos): Promise<void> {
      const anteriores = estado.modulosAtivos;
      const novos = new Set(modulos);
      parametros = filtrarParametros(novosParametros ?? parametros, modulos);
      await op.armazenamento.gravar(CHAVE.parametros, parametros);
      mudar({ modulosAtivos: [...modulos] });
      await op.armazenamento.gravar(CHAVE.modulos, [...modulos]);
      // módulo que voltou: itens marcados como "módulo desativado" voltam para a fila
      const voltaram = estado.fila.some((i) => i.situacao === 'modulo_inativo' && novos.has(i.modulo));
      if (estado.arquivos.some((a) => a.situacao === 'modulo_inativo' && novos.has(a.modulo)))
        await gravarArquivos(
          estado.arquivos.map((a) =>
            a.situacao === 'modulo_inativo' && novos.has(a.modulo)
              ? { ...a, situacao: 'pendente' as const, codigo: null, ultimo_erro: '' }
              : a,
          ),
        );
      if (voltaram)
        await gravarFila(
          estado.fila.map((i) =>
            i.situacao === 'modulo_inativo' && novos.has(i.modulo)
              ? { ...i, situacao: 'pendente' as const, codigo: null, ultimo_erro: '' }
              : i,
          ),
        );
      let limpeza = estado.limpezaPendente.filter((m) => !novos.has(m));
      let tentarEnviar = false;
      for (const m of anteriores.filter((x) => !novos.has(x))) {
        if (estado.fila.some((i) => i.modulo === m) || temArquivoPendente(m)) {
          if (!limpeza.includes(m)) limpeza = [...limpeza, m];
          tentarEnviar = true;
        } else {
          await emTransacao((a) => limparModulo(m, a));
          await descartarArquivosDoModulo(m);
          await descartarAceitosDoModulo(m);
        }
      }
      await gravarLimpeza(limpeza);
      if (tentarEnviar) await motor.enviar();
    },

    /** O usuário viu os itens não enviados do módulo desativado: apaga a fila e os dados locais dele. */
    async confirmarLimpeza(modulo: ModuloId): Promise<void> {
      if (!estado.limpezaPendente.includes(modulo)) return;
      const fila = estado.fila.filter((i) => i.modulo !== modulo);
      const limpeza = estado.limpezaPendente.filter((m) => m !== modulo);
      // fila, dados e pendência juntos (com `emTransacao`, tudo ou nada); o estado só muda depois de gravado
      await emTransacao(async (a) => {
        await a.gravar(CHAVE.fila, fila);
        await limparModulo(modulo, a);
        await a.gravar(CHAVE.limpeza, limpeza);
      });
      mudar({ fila, limpezaPendente: limpeza });
      await descartarArquivosDoModulo(modulo);
      await descartarAceitosDoModulo(modulo);
    },

    /**
     * RN-CORE-15 (aparelho bloqueado): apaga TUDO o que o motor guarda deste usuário — linhas, cursores, versões de
     * escopo, chaves `mod:*`, estruturas próprias dos módulos, fila de itens e fila de arquivos (com os arquivos locais
     * que ela conhece). Numa transação quando o adaptador sabe. Fotos ainda não enfileiradas são do shell (pasta `fotos/`).
     */
    async limparAparelho(): Promise<void> {
      const arquivos = estado.arquivos;
      await emTransacao(async (a) => {
        for (const m of MODULOS) await limparModulo(m, a);
        for (const k of await a.chaves('')) await a.remover(k);
      });
      parametros = {};
      geracaoGuardada = null;
      mudar({ fila: [], aceitos: [], arquivos: [], limpezaPendente: [], modulosAtivos: [], sincronizado_em: null, avisos: [], erro: null, carga: CARGA_VAZIA });
      for (const x of arquivos) await removerLocal(x.caminho);
    },

    /** Registros locais de uma entidade (sem os removidos). */
    async linhas<L extends LinhaSync = LinhaSync>(entidade: string): Promise<L[]> {
      if (op.armazenamento.linhas) return op.armazenamento.linhas.listar<L>(entidade);
      const l = (await op.armazenamento.ler<Record<string, L>>(CHAVE.entidade(entidade))) ?? {};
      return Object.values(l);
    },

    /** Registros locais pelos ids (na ordem pedida; ids ausentes ficam de fora). */
    async linhasPorIds<L extends LinhaSync = LinhaSync>(
      entidade: string,
      ids: readonly string[],
    ): Promise<L[]> {
      if (op.armazenamento.linhas) return op.armazenamento.linhas.porIds<L>(entidade, ids);
      const l = (await op.armazenamento.ler<Record<string, L>>(CHAVE.entidade(entidade))) ?? {};
      return ids.flatMap((id) => (l[id] ? [l[id]] : []));
    },

    /**
     * O que a tela sobrepõe às linhas do pull (ADR 0009 §3, ex.: `aplicarPendentesVisita`): `pendente`/`falhou` da fila
     * e os aceitos que o pull ainda não trouxe (D-3), na ordem de criação. Igual a `itensParaSobrepor(estado, entidades)`.
     */
    sobreposicao(entidades?: readonly string[]): ItemSobreposicao[] {
      return itensParaSobrepor(estado, entidades);
    },

    /** Itens ainda não aceitos da entidade (`pendente` e `falhou`), na ordem da fila. Para sobrepor, use `sobreposicao`. */
    pendentes(entidade: string): readonly ItemOutbox[] {
      return estado.fila.filter(
        (i) => i.entidade === entidade && (i.situacao === 'pendente' || i.situacao === 'falhou'),
      );
    },

    /**
     * Busca textual num índice registrado (`definirModuloShell({ indicesBusca })`): chaves por relevância. Sem a
     * capacidade no armazenamento, `null` (a tela filtra em memória como antes). Entrada hostil nunca lança.
     */
    async buscar(indice: string, consulta: ConsultaTexto): Promise<ResultadoBusca[] | null> {
      return op.armazenamento.busca ? op.armazenamento.busca.buscar(indice, consulta) : null;
    },

    /** Parâmetros do tenant do módulo (último `GET /v1/me/modulos`; offline vale o guardado). Módulo inativo = `{}`. */
    parametros(modulo: ModuloId): Readonly<Record<string, unknown>> {
      return parametrosDe(modulo);
    },

    /** Armazenamento próprio do módulo (prefixo `mod:<m>:`), apagado junto com o módulo (RN-CORE-02). */
    armazenamentoDoModulo(modulo: ModuloId): ArmazenamentoSync {
      return comPrefixo(op.armazenamento, CHAVE.modulo(modulo));
    },
  };
  return motor;
}

export type MotorSync = ReturnType<typeof criarMotorSync>;
