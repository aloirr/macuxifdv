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
 * - ADR 0054: na CARGA INICIAL, com as peças opcionais (`transporte.pacotes`, `arquivos.baixarPacote/lerBloco/gravarBloco`,
 *   `linhas.importarPacote`), cada pacote do manifesto vira um item da sequência ANTES das entidades que cobre: download com
 *   retomada (`.part`), bytes e md5 conferidos, `descompactarGzip` (fflate) e importação numa transação, que grava o cursor
 *   `(horizonte, UUID nulo)` e a `versao_escopo`; o pull de cada entidade continua dali. Qualquer falha que não seja de rede
 *   cai no pull paginado com o aviso `pacote_falhou` (Diagnóstico). `essenciais` (solução 5): `liberado_em` quando os itens
 *   essenciais da carga inicial terminam; `pendentes` = o que ainda falta dela.
 * - ADR 0021 (T-0079): `geracao_base` da página do pull e das novidades diferente da guardada = a base do tenant foi recriada
 *   ou restaurada. Troca de geração: aceitos sobrepostos voltam para a fila, a fila é enviada, linhas/cursores/escopos são
 *   apagados (a fila de itens e a de arquivos ficam), cada etapa limpa o próprio cache (`aoTrocarGeracao`) e o pull completo
 *   roda de novo na mesma sincronização. Sem o campo, nada muda; a primeira geração vista é adotada sem apagar nada.
 * - ADR 0057: entidades de cadência `diaria` (estoque) só vêm na CARGA DIÁRIA (`cargaDiariaDevida` injetada pelo shell;
 *   a primeira sincronização que a encontra devida a inclui e grava `carga_diaria_em`), na carga inicial e na `completa`.
 *   `sincronizar({ modo: 'parcial' })` = envio + pull só das entidades `parcial` (pedidos e clientes); `{ modo: 'completa' }`
 *   = tudo do zero (ressincronização forçada de cada entidade, retomável), diárias inclusive. Sem modo = a de sempre.
 */
import { ambienteIndisponivel, type AmbienteAparelho, type AmbienteModulo } from './ambiente';
import { completarAmbiente, type RegistroConsultasAparelho } from './consultas';
import { decidirGeracao, filaNaTrocaDeGeracao, normalizarGeracao } from './geracao-base';
import {
  caminhoFoto,
  CODIGOS_ARQUIVO,
  CODIGOS_ARQUIVO_RETENTAVEIS,
  DIAS_RETENCAO_ARQUIVO_LOCAL,
  TIPOS_ENVIO_APARELHO,
  type EnvioArquivo,
  type ResultadoEnvioArquivo,
  type TipoArquivo,
} from './arquivos';
import type { BuscaTextoSync, ConsultaTexto, DesfechoBusca, ResultadoBusca } from './busca-tipos';
import { MODULOS, type ModuloId } from './nomes';
import type { NovidadesResposta } from './novidades';
import { Gunzip } from 'fflate';
import {
  ErroPacoteSync,
  type CodigoFalhaPacote,
  type EntidadePacoteSync,
  type PacoteSync,
  type PacotesSyncResposta,
} from './pacotes-sync';
import type { ItemPush, LinhaSync, ModoSincronizacao, PaginaSync, RegistroSync, ResultadoItemPush } from './sync';
import {
  codificarCursor,
  CODIGOS_RETENTAVEIS,
  decodificarCursor,
  ehSyncNaoImplementado,
  hojeParaPoda,
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
  /**
   * T-0052-B4 (opcional): linhas com `<campo>` (raiz da linha) igual a um dos `valores`, comparação estrita de tipo
   * (`'5'` não casa `5`). Sem ordem garantida. O motor já valida o campo e filtra os valores (`valoresDeCampo`); sem ela,
   * o motor filtra `listar` em JS. No SQLite usa o índice de expressão `json_extract(dados, '$.<campo>')` do dono.
   */
  porCampo?<L extends LinhaSync>(entidade: string, campo: string, valores: readonly ValorCampoLinha[]): Promise<L[]>;
  /** Ids das linhas guardadas (ressincronização do escopo, ADR 0009 §4). */
  ids(entidade: string): Promise<string[]>;
  contar(entidade: string): Promise<number>;
  /** Apaga as linhas e o cursor da entidade. */
  limpar(entidade: string): Promise<void>;
  /**
   * ADR 0054 (opcional; SQLite): importa o pacote da primeira carga já descompactado em `caminho` (relativo aos documentos do
   * app). Numa transação exclusiva (tudo ou nada): `ATTACH`, upsert de cada `ent_<nome>` (só substitui com `updated_at`
   * maior), contagem conferida com `linhas` e com `_pacote.entidades`, grava `cursor` e `versao_escopo` de cada entidade,
   * `DETACH`; marca o FTS das entidades para reconstruir no `busca.finalizar`. Arquivo recusado = `ErroPacoteSync`.
   * Sem ela, o motor não usa pacote (pull paginado). `conferir`: o que o `_pacote` do arquivo tem de dizer (outra geração =
   * `ErroPacoteSync('geracao')`; outro módulo ou partição = `'formato'`).
   */
  importarPacote?(caminho: string, entidades: readonly EntidadePacoteSync[], conferir?: ConferenciaPacote): Promise<void>;
}

/** ADR 0054: o que a importação confere no `_pacote` do arquivo (ausente = não confere). */
export interface ConferenciaPacote {
  geracao_base?: string | null;
  modulo?: ModuloId;
  particao?: string;
}

/** Valor aceito em `linhasPorCampo` (ids, códigos, números). `null`, booleano e objeto ficam de fora. */
export type ValorCampoLinha = string | number;

/** Campo de primeiro nível de uma linha (vira `$.<campo>` no SQLite: nada além de `[a-z0-9_]`). */
const CAMPO_LINHA_RE = /^[a-z][a-z0-9_]*$/;

/** Campo validado (erro do app, não do usuário): mesmo erro em todo adaptador. */
export function validarCampoLinha(campo: string): string {
  if (!CAMPO_LINHA_RE.test(campo)) throw new Error(`Campo inválido: ${campo}`);
  return campo;
}

/** Valores únicos utilizáveis: strings e números finitos (NaN/Infinity nunca casam, igual ao SQLite). */
export function valoresDeCampo(valores: readonly ValorCampoLinha[]): ValorCampoLinha[] {
  return [...new Set(valores.filter((v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))))];
}

/** Filtro em JS de `linhasPorCampo` (caminho sem `porCampo` no adaptador). `valores` já passou por `valoresDeCampo`. */
function filtrarPorCampo<L extends LinhaSync>(linhas: readonly L[], campo: string, valores: readonly ValorCampoLinha[]): L[] {
  const alvo = new Set<unknown>(valores);
  return linhas.filter((l) => alvo.has((l as unknown as Record<string, unknown>)[campo]));
}

/**
 * Relógio das versões de linhas (`motor.versaoLinhas`). Do processo, não do motor: dois motores (troca de usuário) nunca
 * devolvem o mesmo número para dados diferentes, então o derivado memorizado de um nunca vale no outro.
 */
let relogioVersoes = 0;

/** Transporte com o servidor. Lançar exceção = falha de transporte (o motor tenta de novo depois). */
export interface TransporteSync {
  push(itens: ItemPush[]): Promise<ResultadoItemPush[]>;
  /**
   * `opcoes.modo` (R-20261115-125500-alexandre): sincronização pedida pelo usuário; o transporte HTTP manda no cabeçalho
   * `x-macuxi-sync-modo` (`CABECALHO_MODO_SYNC`). Sem ele = automática. Página `limitado` = nada muda no aparelho.
   */
  pull(entidade: string, cursor: string | null, opcoes?: { modo: ModoSincronizacao }): Promise<PaginaSync<LinhaSync>>;
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
  /**
   * ADR 0054: `GET /v1/sync/pacotes`, resposta já validada por `PacotesSyncRespostaSchema`. 404/501 = lista vazia (servidor
   * antigo ou desligado). Exceção = falha de transporte. Sem ele, a primeira carga é só pelo pull paginado.
   */
  pacotes?(): Promise<PacotesSyncResposta>;
}

/** Acesso do motor aos arquivos locais (shell: `expo-file-system`; testes: memória). Caminho relativo aos documentos do app. */
export interface ArquivosLocais {
  /** Bytes do arquivo ou `null` se não existe mais. */
  ler(caminho: string): Promise<Uint8Array | null>;
  /** Apaga o arquivo local (aceito há 7 dias, descartado ou de módulo desativado). Ausente = não apaga nada. */
  remover?(caminho: string): Promise<void>;
  /**
   * ADR 0054: baixa `url` (GET, aceita `Range`) para `destino`, continuando do byte `deBytes` (`.part` já no disco; 0 =
   * do início): grava a partir de `deBytes` (descarta o que houver depois dele) e `aoProgredir` recebe o tamanho do arquivo
   * até ali (`deBytes` + recebidos). `md5` do arquivo inteiro quando o shell sabe calcular (`null` = o motor confere só bytes e `quick_check`).
   * Exceção = falha de rede (a passada para e a próxima retoma). Sem ela, não há pacote.
   */
  baixarPacote?(
    url: string,
    destino: string,
    opcoes: { deBytes: number; aoProgredir?: (feitos: number) => void },
  ): Promise<{ bytes: number; md5: string | null }>;
  /** ADR 0054: até `tamanho` bytes a partir de `inicio` (vazio = fim do arquivo). Descompactação em blocos. */
  lerBloco?(caminho: string, inicio: number, tamanho: number): Promise<Uint8Array>;
  /** ADR 0054: grava `bytes` no fim do arquivo (`acrescentar`) ou cria/substitui o arquivo. */
  gravarBloco?(caminho: string, bytes: Uint8Array, opcoes: { acrescentar: boolean }): Promise<void>;
  /** ADR 0054: bytes livres no disco do app; `null` = desconhecido. Sem espaço para ~3× o pacote, pull paginado. */
  espacoLivre?(): Promise<number | null>;
}

// ---------- pacote da primeira carga (ADR 0054) ----------

/** Pasta dos temporários do pacote (relativa aos documentos do app): `<id>.sqlite.gz.part` e `<id>.sqlite`. */
export const PASTA_PACOTES = 'pacotes';
/**
 * Espaço livre exigido antes do download, em múltiplos do `.gz`: o `.gz`, o `.sqlite` temporário e as linhas copiadas
 * (o SQLite é ~4× o gzip; pico ≈ 3× o descompactado).
 */
export const FATOR_ESPACO_PACOTE = 10;
/** Falhas de download do mesmo pacote com sinal: depois disto, as entidades dele seguem no pull paginado. */
export const MAX_TENTATIVAS_PACOTE = 3;
/** Bloco lido do `.gz` por vez na descompactação. */
export const TAMANHO_BLOCO_GZIP = 1024 * 1024;
/** Código do aviso (Diagnóstico) de pacote não usado; a `mensagem` traz o `CodigoFalhaPacote`. */
export const AVISO_PACOTE_FALHOU = 'pacote_falhou';

/**
 * ADR 0054: descompacta o gzip `origem` em `destino` em blocos (`lerBloco`/`gravarBloco` do shell), sem carregar o arquivo
 * inteiro na memória. `fflate` (JS puro): roda no Hermes e no Node. Arquivo que não é gzip = `ErroPacoteSync('formato')`;
 * erro de disco sobe como veio. Devolve os bytes gravados.
 */
export async function descompactarGzip(
  arquivos: Pick<ArquivosLocais, 'lerBloco' | 'gravarBloco'>,
  origem: string,
  destino: string,
  tamanhoBloco = TAMANHO_BLOCO_GZIP,
): Promise<number> {
  const { lerBloco, gravarBloco } = arquivos;
  if (!lerBloco || !gravarBloco) throw new ErroPacoteSync('indisponivel');
  let saida: Uint8Array[] = [];
  let terminou = false;
  const g = new Gunzip();
  g.ondata = (parte, final) => {
    saida.push(parte);
    if (final) terminou = true;
  };
  let gravados = 0;
  let primeiro = true;
  const despejar = async () => {
    const partes = saida;
    saida = [];
    for (const parte of partes) {
      if (parte.length === 0) continue;
      await gravarBloco(destino, parte, { acrescentar: !primeiro });
      primeiro = false;
      gravados += parte.length;
    }
  };
  for (let inicio = 0; ; ) {
    const bloco = await lerBloco(origem, inicio, tamanhoBloco);
    const fim = bloco.length === 0;
    try {
      g.push(bloco, fim);
    } catch {
      throw new ErroPacoteSync('formato');
    }
    await despejar();
    if (fim) break;
    inicio += bloco.length;
  }
  // gzip truncado: o fflate não reclama; o `quick_check` e a contagem pegam, mas aqui já se sabe
  if (!terminou) throw new ErroPacoteSync('formato');
  if (primeiro) await gravarBloco(destino, new Uint8Array(0), { acrescentar: false });
  return gravados;
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
    porCampo: async <L extends LinhaSync>(e: string, campo: string, valores: readonly ValorCampoLinha[]) =>
      filtrarPorCampo(Object.values(await mapa(e)) as L[], campo, valores),
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
  /** ADR 0041 (T-0147): apagar o arquivo local assim que o servidor aceitar (documento sensível; sem os 7 dias). */
  apagar_ao_enviar?: true;
}

export interface NovoArquivoFila {
  id: string;
  modulo: ModuloId;
  /** Padrão: `caminhoFoto(id)` (`fotos/<id>.jpg`, onde a câmera do shell grava). */
  caminho?: string;
  tipo?: TipoArquivo;
  /** Texto curto para a tela de sync (ex.: "Foto da fachada · Auto Peças Um"). */
  rotulo?: string;
  /**
   * ADR 0041 (T-0147): apaga o arquivo local e tira da fila assim que o envio for aceito (documento sensível, como CNH e
   * contrato social, não fica no aparelho). Padrão: fica 7 dias (`DIAS_RETENCAO_ARQUIVO_LOCAL`) para a tela mostrar offline.
   */
  apagarAoEnviar?: boolean;
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
  /**
   * ADR 0054 (solução 5): quando os itens `essenciais` da carga inicial terminaram (ISO UTC; persistido). O shell libera a
   * entrada com `sincronizado_em || liberado_em`. Ausente = motor sem a peça (só `sincronizado_em` libera).
   */
  liberado_em?: string | null;
  /**
   * ADR 0054: chaves (entidades e etapas) da carga inicial ainda não concluídas; vazio depois dela. Com o Catálogo pendente,
   * busca e preço vão à API.
   */
  pendentes?: readonly string[];
  /**
   * ADR 0057: fim da última carga diária (ISO UTC, relógio do aparelho; persistido): a passada que trouxe todas as entidades
   * `diaria` terminou. Nulo = nunca houve (ou a geração trocou). Ausente/nulo sempre sem `cargaDiariaDevida` no motor.
   */
  carga_diaria_em?: string | null;
}

export type { ModoSincronizacao } from './sync';

export interface ProgressoCarga {
  entidade: string | null;
  modulo: ModuloId | null;
  concluidas: number;
  total: number;
  paginas: number;
  retomada: boolean;
  /** ADR 0054: download do pacote em andamento (o percentual da etapa anda por ele). */
  bytes?: { feitos: number; total: number };
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
  /** ADR 0054: pacotes da carga inicial. Passa de uma passada para a outra mesmo depois de `VALIDADE_RETOMADA_MS`. */
  pacotes?: RegistroPacotes;
}

/**
 * ADR 0054: o cursor que a importação grava vale para a entidade só quando TODAS as partições que a cobrem (ex.: uma por
 * filial) estão importadas; até lá, `particoes` lembra quais eram esperadas (o app pode cair entre dois pacotes).
 */
interface RegistroPacotes {
  /** Pacote importado → partição (`<modulo>/<particao>`) e cursor de cada entidade gravada. */
  importados: Record<string, { particao: string; cursores: Record<string, string> }>;
  /** Entidade → partições esperadas (do manifesto em que ela entrou no pacote). */
  particoes: Record<string, string[]>;
  /** Entidades que caíram no pull paginado (não voltam a pacote nesta carga). */
  semPacote: string[];
  /** Download em andamento: bytes já no `.part` (última notícia) e tentativas com sinal. */
  baixando: Record<string, { baixados: number; tentativas: number }>;
}

/** Passada interrompida há mais que isto não é retomada: tudo é conferido de novo (cada entidade continua do seu cursor). */
export const VALIDADE_RETOMADA_MS = 6 * 60 * 60_000;

/**
 * Ressincronização de uma entidade em andamento (ADR 0009 §4), gravada ANTES de cada página (T-0059). `vistos` = ids já
 * recebidos nesta passada (para apagar no fim o que saiu do escopo); `null` = carga inicial (nada local para apagar).
 */
interface RegistroRessinc {
  /** `null` só no `refazer` de entidade sem `versao_escopo` (tenant/próprio). */
  versao: string | null;
  vistos: string[] | null;
  /**
   * ADR 0057: ressincronização forçada pela sincronização `completa` (tudo do zero). Qualquer passada que puxar a entidade
   * a retoma de `desde` (o cursor da página em curso, gravado ANTES de aplicá-la: a página volta, nunca falta).
   */
  refazer?: true;
  desde?: string | null;
}

/** Item da sincronização completa entregue a `OpcoesMotorSync.ordemDaCarga`. */
export interface ItemDaCarga {
  /** Nome da entidade ou id da etapa extra (o mesmo de `ProgressoCarga.entidade` enquanto ele roda). */
  chave: string;
  modulo: ModuloId | null;
  tipo: 'entidade' | 'etapa';
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
  /**
   * Etapas extras de carga, por módulo; rodam depois do pull genérico, só de módulos efetivos (a menos que `ordemDaCarga`
   * as misture com as entidades).
   */
  etapas?: readonly EtapaSync[];
  /**
   * Ordem da sincronização completa (RN-CORE-48: a tela de entrada mostra as etapas "n de N" em sequência). Recebe cada
   * entidade de pull e cada etapa extra e devolve a chave de ordenação: menor roda antes. Entidades e etapas formam UMA
   * sequência; a ordenação é estável (empate = a ordem padrão: entidades na ordem do registro, depois etapas na ordem de
   * `etapas`). Chave não finita ou função que lança = ordem padrão. Sem ela, a ordem padrão. Também ordena o pull das
   * novidades (só entidades; empate = ordem alfabética).
   *
   * Dependências que a ordem precisa respeitar (dê a mesma chave ou uma menor ao item de que o outro depende):
   * - Vendedor (demonstração, Fase M): `produtos` lê os `clientes` gravados pela etapa `carteira`; `pedidos` lê o `me`
   *   gravado pela etapa `alcadas` (sem ele, cai no fuso padrão). Mesma chave para as quatro preserva a ordem.
   * - Entidades de pull não dependem umas das outras (coberturas, retomada e `ressinc` são por entidade); a busca é
   *   finalizada uma vez no fim, depois de todas. As etapas do Core (`metas`, `pedidos-da-visita`, `core-inicio`,
   *   `core-rv`) e do Gestor (`gestor-equipe`) leem só a API e o `me` do Core: não dependem de entidade nem de etapa.
   */
  ordemDaCarga?: (item: ItemDaCarga) => number;
  /** Mensagem legível de um erro de transporte (o shell traduz HttpError etc.). */
  mensagemDeErro?: (e: unknown) => string;
  /** Leitura (e remoção) dos arquivos locais da fila de arquivos. Sem ela, os arquivos ficam na fila sem envio. */
  arquivos?: ArquivosLocais;
  /**
   * Consultas entre módulos no aparelho (`criarShell(...).consultas`, ADR 0012): `ambiente.consultar`. Sem ele, toda
   * consulta dá `ConsultaIndisponivel`.
   */
  consultas?: RegistroConsultasAparelho;
  /**
   * ADR 0054 (solução 5): itens da carga inicial que liberam a entrada (Core: `essencialDaEntrada`). Quando todos concluem,
   * o motor grava `liberado_em`. Sem ela, só `sincronizado_em` libera.
   */
  essenciais?: (item: ItemDaCarga) => boolean;
  /**
   * ADR 0057 (RN-CORE-63): a carga diária está devida? Recebe a última (`carga_diaria_em`, ISO ou `null`) e o `agora`; o
   * shell injeta a função pura do Core com o fuso do tenant e `estoque_carga_hora`. Sem ela, as entidades `diaria` são
   * contínuas e `carga_diaria_em` não é gravado (o de sempre). Se lançar, vale "devida" (na dúvida, carrega).
   */
  cargaDiariaDevida?: (ultima: string | null, agora: Date) => boolean;
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
  /** ADR 0054 (solução 5): quando os itens essenciais da carga inicial terminaram (entrada liberada). */
  liberadoEm: 'sync:liberado_em',
  /** ADR 0057: fim da última carga diária (entidades `diaria`). */
  cargaDiaria: 'sync:carga_diaria_em',
  cursor: (e: string) => `sync:cursor:${e}`,
  /** Última `versao_escopo` recebida da entidade (ADR 0009 §4). */
  escopo: (e: string) => `sync:escopo:${e}`,
  /** Ressincronização em andamento da entidade (T-0059): retomada sem voltar ao início. */
  ressinc: (e: string) => `sync:ressinc:${e}`,
  /** T-0121 (ADR 0009 §5): `hoje` da última poda local da entidade com janela (uma vez por dia). */
  poda: (e: string) => `sync:poda:${e}`,
  /** Sincronização completa em andamento (T-0059): entidades e etapas já concluídas. */
  carga: 'sync:carga',
  /** Cursor de `GET /v1/sync/novidades` (RN-CORE-23, ADR 0018): grava só depois de puxar o que ele apontou. */
  novidades: 'sync:novidades',
  /** Última `geracao_base` vista no servidor (ADR 0021). */
  geracao: 'sync:geracao_base',
  entidade: (e: string) => `ent:${e}`,
  modulo: (m: string) => `mod:${m}:`,
};

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
        linhasPorCampo: (e, campo, valores) => motor.linhasPorCampo(e, campo, valores) as never,
        versaoLinhas: (e) => motor.versaoLinhas(e),
        buscarComDesfecho: (indice, consulta) => motor.buscarComDesfecho(indice, consulta),
        agora,
        usuario: () => base.usuario(),
        parametros: parametrosDe,
      });
    },
    parametros: parametrosDe,
  });
  /**
   * Gancho de reindexação marcada (T-0084): o fuso do tenant (login; sem ele, o padrão) vai para a indexação e cada
   * índice com `versaoDocumentos` é conferido (virada de ano no fuso do tenant, formato novo). Antes de toda busca, de
   * cada pull de entidade e do `finalizar`; barato quando nada mudou. Falha aqui nunca impede a busca nem o sync.
   */
  const conferirVersoesBusca = async () => {
    const busca = op.armazenamento.busca;
    if (!busca?.conferirVersoes) return;
    try {
      await busca.conferirVersoes({ fuso: base.usuario()?.fuso });
    } catch {
      // o armazenamento do SDK nunca lança aqui; o de fora pode: a busca segue com o índice que tem
    }
  };
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
    liberado_em: null,
    pendentes: [],
    carga_diaria_em: null,
  };
  let envioEmCurso: Promise<ResultadoItemPush[]> | null = null;
  /** Passada pedida com um envio em curso: roda depois dele (uma só para todos os pedidos que chegaram no meio). */
  let proximoEnvio: Promise<ResultadoItemPush[]> | null = null;
  let proximoIncluiFalhos = false;
  let syncEmCurso: Promise<boolean> | null = null;
  /** ADR 0057: a `completa` pedida (talvez esperando outra terminar); um segundo pedido recebe a mesma. */
  let completaEmCurso: Promise<boolean> | null = null;
  /** Roda a sincronização como a única em curso; ao terminar, solta a vaga se ela ainda for desta. */
  const emCurso = (fazer: () => Promise<boolean>): Promise<boolean> => {
    const p: Promise<boolean> = fazer().finally(() => {
      if (syncEmCurso === p) syncEmCurso = null;
    });
    syncEmCurso = p;
    return p;
  };

  // ---------- versão das linhas (T-0052-B4) ----------
  /** Entidade → versão das linhas locais; ausente = ainda não perguntada desde a última mudança (ganha número novo). */
  const versoes = new Map<string, number>();
  /**
   * Chamado DEPOIS de gravar (e depois do fim da transação): quem lê a versão ANTES das linhas, no pior caso, guarda o
   * derivado novo com a versão velha e relê uma vez a mais; nunca guarda derivado velho com a versão nova.
   */
  const linhasMudaram = (entidade: string) => versoes.set(entidade, ++relogioVersoes);
  /** Limpeza de módulo, troca de geração, aparelho bloqueado: invalida todas (raro; mais simples que listar as tocadas). */
  const todasAsLinhasMudaram = () => versoes.clear();
  /** Escrita que apaga linhas de várias entidades: invalida as versões no fim, deu certo ou não (sem transação, pode ter apagado parte). */
  const apagandoLinhas = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } finally {
      todasAsLinhasMudaram();
    }
  };

  const mudar = (parcial: Partial<EstadoMotorSync>) => {
    estado = { ...estado, ...parcial };
    for (const f of ouvintes) f(estado);
  };

  // ---------- gravação das filas (D-T0039d) ----------
  /**
   * Fila, aceitos, arquivos, limpeza e módulos: o DISCO primeiro, o estado em memória só depois. Gravação que falha
   * (disco cheio, SQLite travado) deixa memória e disco como estavam — sem item "fantasma" que a tela mostra e o envio
   * manda, mas que some ao fechar o app. As mudanças rodam uma por vez e cada uma calcula a lista nova sobre o estado
   * DA SUA VEZ: sem isso, duas mudanças simultâneas (ex.: `enfileirar` durante o `push`) leriam a mesma lista e a
   * segunda apagaria a primeira. Regra: nada chamado dentro de `emSerie` chama `emSerie` de novo (travaria).
   */
  let gravacoes: Promise<unknown> = Promise.resolve();
  const emSerie = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = gravacoes.then(fn);
    gravacoes = r.catch(() => undefined);
    return r;
  };

  /** Listas novas da fila e/ou dos aceitos; `primeiro` = a que GANHA itens (vai primeiro ao disco). */
  type MudancaFila = { fila?: ItemOutbox[]; aceitos?: ItemAceito[]; primeiro?: 'fila' | 'aceitos' };

  /**
   * Muda fila e aceitos: `calcular` recebe o estado da vez (`null` = nada muda). Com as duas listas, grava primeiro a
   * que ganha itens (padrão: aceitos, o item vai da fila para a sobreposição): se a segunda gravação falhar ou o app
   * cair entre as duas, o item fica nos dois — é reenviado (idempotente) e a sobreposição repetida é inofensiva; nunca
   * fica em nenhum. A memória segue o disco também nesse caso (só a lista gravada muda).
   */
  const mudarFila = (calcular: (e: EstadoMotorSync) => MudancaFila | null): Promise<void> =>
    emSerie(async () => {
      const m = calcular(estado);
      if (!m || (!m.fila && !m.aceitos)) return;
      const ordem: Array<'fila' | 'aceitos'> = m.primeiro === 'fila' ? ['fila', 'aceitos'] : ['aceitos', 'fila'];
      const gravadas: Partial<EstadoMotorSync> = {};
      try {
        for (const k of ordem) {
          const lista = m[k];
          if (!lista) continue;
          await op.armazenamento.gravar(k === 'fila' ? CHAVE.fila : CHAVE.aceitos, lista);
          Object.assign(gravadas, { [k]: lista });
        }
      } finally {
        if (Object.keys(gravadas).length > 0) mudar(gravadas);
      }
    });

  const gravarFila = (fila: (atual: readonly ItemOutbox[]) => ItemOutbox[] | null) =>
    mudarFila((e) => {
      const nova = fila(e.fila);
      return nova ? { fila: nova } : null;
    });

  const gravarAceitos = (aceitos: (atual: readonly ItemAceito[]) => ItemAceito[] | null) =>
    mudarFila((e) => {
      const nova = aceitos(e.aceitos);
      return nova ? { aceitos: nova } : null;
    });

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
    await gravarAceitos((atual) => {
      const ficam = atual.filter((i) => !alvosDoAceite(i).every((e) => cobre(i, coberturas.get(e))));
      return ficam.length !== atual.length ? ficam : null;
    });
  };

  /** RN-CORE-02: os aceitos do módulo desativado saem da sobreposição (os dados dele saem do aparelho). */
  const descartarAceitosDoModulo = (modulo: ModuloId) =>
    gravarAceitos((atual) => (atual.some((i) => i.modulo === modulo) ? atual.filter((i) => i.modulo !== modulo) : null));

  /** Fila de arquivos: mesmo cuidado da fila de itens (disco primeiro, uma mudança por vez, sobre o estado da vez). */
  const gravarArquivos = (calcular: (atual: readonly ItemArquivo[]) => ItemArquivo[] | null): Promise<void> =>
    emSerie(async () => {
      const arquivos = calcular(estado.arquivos);
      if (!arquivos) return;
      await op.armazenamento.gravar(CHAVE.arquivos, arquivos);
      mudar({ arquivos });
    });

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
    let doModulo: ItemArquivo[] = [];
    await gravarArquivos((atual) => {
      doModulo = atual.filter((a) => a.modulo === modulo);
      return doModulo.length > 0 ? atual.filter((a) => a.modulo !== modulo) : null;
    });
    for (const a of doModulo) await removerLocal(a.caminho);
  };

  const gravarLimpeza = (limpezaPendente: ModuloId[]) =>
    emSerie(async () => {
      await op.armazenamento.gravar(CHAVE.limpeza, limpezaPendente);
      mudar({ limpezaPendente });
    });

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
    posicaoAgora: () => ambiente.posicaoAgora(),
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
    //    (a fila ganha os itens: vai primeiro ao disco — se o app cair entre as gravações, o item fica nos dois, nunca em nenhum)
    await mudarFila((e) =>
      e.aceitos.length > 0 ? { fila: filaNaTrocaDeGeracao(e.fila, e.aceitos), aceitos: [], primeiro: 'fila' } : null,
    );
    // 2. a fila vai primeiro (o que a base nova recusar fica `falhou`, visível)
    await motor.enviar();
    mudar({ etapa: 'A base do servidor mudou: recarregando os dados' });
    // 3. cópia local do servidor: linhas, cursores, escopos, ressincronizações, carga e cursor de novidades
    await apagandoLinhas(() => emTransacao(async (a) => {
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
      // ADR 0057: a carga diária da base antiga não vale; a próxima passada traz as diárias de novo
      await a.remover(CHAVE.cargaDiaria);
    }));
    mudar({ carga_diaria_em: null });
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
      await gravarFila((atual) =>
        atual.some((i) => i.situacao === 'falhou')
          ? atual.map((i) => (i.situacao === 'falhou' ? { ...i, situacao: 'pendente' as const } : i))
          : null,
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
          await gravarFila((atual) =>
            atual.map((it) =>
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
        // calculado na vez da gravação, sobre a fila de então (o que entrou ou saiu durante o push é respeitado)
        const enviados = new Map(lote.map((l) => [l.id, l] as const));
        await mudarFila((e) => {
          parar = false;
          const fila: ItemOutbox[] = [];
          const aceitos: ItemAceito[] = [];
          for (const it of e.fila) {
            const r = porId.get(it.id);
            const enviado = enviados.get(it.id);
            // fora do lote, ou alterado (`alterar`) com o push em voo: o servidor recebeu a versão anterior; esta fica
            // pendente como está e vai no próximo push (upsert idempotente pelo mesmo id) — a edição não se perde
            if (!enviado || it.payload !== enviado.payload || it.operacao !== enviado.operacao) {
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
          if (aceitos.length === 0) return { fila };
          const novos = new Set(aceitos.map((x) => x.id));
          return { fila, aceitos: [...e.aceitos.filter((x) => !novos.has(x.id)), ...aceitos] };
        });
        if (parar) break;
      }
    } finally {
      mudar({ enviando: false });
    }
    return resultados;
  };

  // ---------- envio de arquivos (ADR 0010 §4) ----------
  /** `comSinal` = a passada começou online (o push dos itens rodou): sem ele, nenhum upload vai antes do seu comando. */
  const enviarArquivosAgora = async (incluirFalhos: boolean, comSinal: boolean): Promise<void> => {
    const ler = op.arquivos?.ler;
    const enviarArquivo = op.transporte.enviarArquivo?.bind(op.transporte);
    // aceitos há 7 dias ou mais: apaga o arquivo local e sai da fila (a tela já não precisa da foto offline)
    const limite = agora().getTime() - DIAS_RETENCAO_ARQUIVO_LOCAL * DIA_MS;
    const vencido = (a: ItemArquivo) =>
      a.situacao === 'enviado' && a.enviado_em !== null && Date.parse(a.enviado_em) <= limite;
    let vencidos: ItemArquivo[] = [];
    await gravarArquivos((atual) => {
      vencidos = atual.filter(vencido);
      return vencidos.length > 0 ? atual.filter((a) => !vencido(a)) : null;
    });
    for (const a of vencidos) await removerLocal(a.caminho);
    if (incluirFalhos)
      await gravarArquivos((atual) =>
        atual.some((a) => a.situacao === 'falhou')
          ? atual.map((a) => (a.situacao === 'falhou' ? { ...a, situacao: 'pendente' as const } : a))
          : null,
      );
    if (!ler || !enviarArquivo || !comSinal || !online()) return;
    const aEnviar = estado.arquivos.filter((a) => a.situacao === 'pendente').map((a) => a.id);
    const atualizar = (id: string, mudanca: Partial<ItemArquivo>) =>
      gravarArquivos((atual) =>
        atual.some((a) => a.id === id) ? atual.map((a) => (a.id === id ? { ...a, ...mudanca } : a)) : null,
      );
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
      if (r.status === 'aceito' && item.apagar_ao_enviar) {
        // documento sensível (ADR 0041): sai da fila e do aparelho na hora
        await gravarArquivos((atual) => (atual.some((a) => a.id === id) ? atual.filter((a) => a.id !== id) : null));
        await removerLocal(item.caminho);
        continue;
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

  // ---------- poda local por janela (ADR 0009 §5; T-0121) ----------
  /**
   * Ids que a poda não apaga: os dos itens da fila e dos aceitos sobrepostos (o próprio `id` e os `id`/`*_id` de 1º nível
   * do payload): a tela ainda casa o item com a linha.
   */
  const idsProtegidosDaPoda = (): Set<string> => {
    const ids = new Set<string>();
    for (const i of [...estado.fila, ...estado.aceitos]) {
      ids.add(i.id);
      if (i.payload && typeof i.payload === 'object')
        for (const [k, v] of Object.entries(i.payload as Record<string, unknown>))
          if (typeof v === 'string' && (k === 'id' || k.endsWith('_id'))) ids.add(v);
    }
    return ids;
  };

  /**
   * Apaga do aparelho as linhas que saíram da janela do provedor (`DefinicaoEntidadeSync.naJanela`), no máximo uma vez
   * por dia e por entidade. Predicado que lança ou linha protegida = a linha fica. `mapa` é o do caminho chave→JSON.
   */
  const podarJanela = async (entidade: string, mapa: Linhas): Promise<void> => {
    const def = op.registro.entidade(entidade);
    if (!def?.naJanela) return;
    const a = op.armazenamento;
    const hoje = hojeParaPoda(agora());
    if ((await a.ler<string>(CHAVE.poda(entidade))) === hoje) return;
    const protegidos = idsProtegidosDaPoda();
    const fora = (l: LinhaSync): boolean => {
      if (protegidos.has(l.id)) return false;
      try {
        return def.naJanela!(l as unknown as Readonly<Record<string, unknown>>, hoje) === false;
      } catch {
        return false;
      }
    };
    if (a.linhas) {
      const sair = (await a.linhas.listar(entidade)).filter(fora);
      if (sair.length > 0) {
        const quando = agora().toISOString();
        try {
          await a.linhas.aplicar(entidade, sair.map((l) => ({ id: l.id, updated_at: quando, deleted_at: quando })), null);
        } finally {
          linhasMudaram(entidade);
        }
      }
    } else {
      const sair = Object.values(mapa).filter(fora);
      if (sair.length > 0) {
        for (const l of sair) delete mapa[l.id];
        await a.gravar(CHAVE.entidade(entidade), mapa);
        linhasMudaram(entidade);
      }
    }
    await a.gravar(CHAVE.poda(entidade), hoje);
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
    /** ADR 0057: `completa` = tudo do zero (ressincronização forçada; no fim apaga o que não veio). */
    refazer = false,
    /** ADR 0057: pull da sincronização `parcial` (o modo vai ao servidor, para o limite silencioso). */
    parcial = false,
  ): Promise<'ok' | 'indisponivel'> => {
    const a = op.armazenamento;
    // T-0084: o fuso do tenant vale para os documentos de busca montados nesta página (e a versão é conferida)
    await conferirVersoesBusca();
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
    type Ressinc = { versao: string | null; vistos: Set<string> | null; refazer?: true };
    let ressinc: Ressinc | null = null;
    /** Modo informado ao servidor (limite silencioso por usuário); `undefined` = automática, a chamada de sempre. */
    let modo: ModoSincronizacao | undefined = parcial ? 'parcial' : undefined;
    const gravarRessinc = (r: Ressinc, desde: string | null = null) =>
      a.gravar(CHAVE.ressinc(entidade), {
        versao: r.versao,
        vistos: r.vistos ? [...r.vistos] : null,
        ...(r.refazer ? { refazer: true as const, desde } : {}),
      } satisfies RegistroRessinc);
    if (ressincGuardada?.refazer && !cargaInicial) {
      // ADR 0057: `completa` interrompida (app encerrado, queda): qualquer passada continua da página em curso dela
      ressinc = { versao: ressincGuardada.versao, vistos: new Set(ressincGuardada.vistos ?? []), refazer: true };
      cursor = ressincGuardada.desde ?? null;
    } else if (refazer && !cargaInicial) {
      // ADR 0057: tudo do zero; as linhas locais ficam até o fim e só sai o que não veio
      ressinc = { versao: versaoGuardada, vistos: new Set(), refazer: true };
      cursor = null;
      modo = 'completa';
      await gravarRessinc(ressinc);
    }
    /** Páginas recebidas nesta chamada (501 na primeira = entidade sem provedor, também no `refazer`). */
    let recebidas = 0;
    for (;;) {
      let pagina: PaginaSync<LinhaSync>;
      try {
        pagina = modo ? await op.transporte.pull(entidade, cursor, { modo }) : await op.transporte.pull(entidade, cursor);
      } catch (e) {
        if (ehSyncNaoImplementado(e) && (!ressinc || (ressinc.refazer && recebidas === 0))) {
          // `refazer` sem provedor: nada foi pedido de novo; o registro sai (nada local é apagado)
          if (ressinc?.refazer) await a.remover(CHAVE.ressinc(entidade));
          coberturas?.set(entidade, 'indisponivel');
          return 'indisponivel';
        }
        throw e;
      }
      recebidas++;
      if (pagina.limitado) {
        // limite silencioso do servidor: nada muda no aparelho; a `completa` segurada não deixa ressincronização pendente
        if (modo === 'completa' && recebidas === 1) {
          if (ressincGuardada) await a.gravar(CHAVE.ressinc(entidade), ressincGuardada);
          else await a.remover(CHAVE.ressinc(entidade));
        }
        return 'ok';
      }
      // ADR 0021: outra geração = a base foi recriada; nada desta página é aplicado sobre a cópia antiga
      await conferirGeracao(pagina.geracao_base);
      if (!pagina.horizonte) semHorizonte = true;
      else if (horizonte === null || Date.parse(pagina.horizonte) < Date.parse(horizonte)) horizonte = pagina.horizonte;
      const versao = pagina.versao_escopo;
      if (ressinc?.refazer && versao !== undefined && versao !== ressinc.versao) {
        // ADR 0057: o conjunto visível mudou no meio do `refazer`: recomeça do zero com a versão nova (no 1º pedido, só adota)
        const recomecar = cursor !== null;
        ressinc = { versao, vistos: new Set(), refazer: true };
        await gravarRessinc(ressinc);
        if (recomecar) {
          cursor = null;
          continue;
        }
      }
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
        // (no `refazer`, `desde` = o cursor desta página: a retomada a pede de novo)
        await gravarRessinc(ressinc, cursor);
      }
      const ultimo = pagina.itens[pagina.itens.length - 1];
      const proximo = pagina.proximo_cursor ?? (ultimo ? codificarCursor(ultimo) : cursor);
      try {
        if (a.linhas) await a.linhas.aplicar(entidade, pagina.itens, proximo);
        else {
          for (const l of pagina.itens) {
            if (l.deleted_at) delete mapa[l.id];
            else mapa[l.id] = l;
          }
          await a.gravar(CHAVE.entidade(entidade), mapa);
          if (proximo) await a.gravar(CHAVE.cursor(entidade), proximo);
        }
      } finally {
        // também na falha: a página grande vai em lotes (SQLite) e parte dela pode ter sido gravada
        if (pagina.itens.length > 0) linhasMudaram(entidade);
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
        if (sobra.length > 0) {
          try {
            await a.linhas.aplicar(
              entidade,
              sobra.map((id) => ({ id, updated_at: quando, deleted_at: quando })),
              null,
            );
          } finally {
            linhasMudaram(entidade);
          }
        }
      } else {
        const sobra = Object.keys(mapa).filter((id) => !vistos.has(id));
        for (const id of sobra) delete mapa[id];
        await a.gravar(CHAVE.entidade(entidade), mapa);
        if (sobra.length > 0) linhasMudaram(entidade);
      }
      // só agora: se o app cair no meio, a próxima passada vê a versão antiga e RETOMA pela `sync:ressinc` (T-0059)
      if (versao !== null) await a.gravar(CHAVE.escopo(entidade), versao);
      await a.remover(CHAVE.ressinc(entidade));
    }
    await podarJanela(entidade, mapa);
    coberturas?.set(entidade, { horizonte: semHorizonte ? null : horizonte, inicio });
    return 'ok';
  };

  /** `op.ordemDaCarga` aplicada com ordenação estável; sem ela (ou se ela lança), a lista como veio. */
  const ordenarCarga = <T,>(lista: readonly T[], itemDe: (x: T) => ItemDaCarga): T[] => {
    const ordem = op.ordemDaCarga;
    if (!ordem) return [...lista];
    try {
      const chaves = lista.map((x) => {
        const k = ordem(itemDe(x));
        return Number.isFinite(k) ? k : Number.POSITIVE_INFINITY;
      });
      return lista
        .map((x, i) => ({ x, i, k: chaves[i]! }))
        .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k < b.k ? -1 : 1))
        .map((y) => y.x);
    } catch {
      return [...lista];
    }
  };

  // ---------- pacote da primeira carga (ADR 0054) ----------
  /** Só com todas as peças opcionais; sem elas, a carga inicial é a de sempre (pull paginado). */
  const podeUsarPacote = (): boolean =>
    !!(
      op.transporte.pacotes &&
      op.armazenamento.linhas?.importarPacote &&
      op.arquivos?.baixarPacote &&
      op.arquivos.lerBloco &&
      op.arquivos.gravarBloco
    );
  const chaveParticao = (p: Pick<PacoteSync, 'modulo' | 'particao'>) => `${p.modulo}/${p.particao}`;
  const temporariosDoPacote = (id: string) => ({
    gz: `${PASTA_PACOTES}/${id}.sqlite.gz.part`,
    db: `${PASTA_PACOTES}/${id}.sqlite`,
  });
  /** Aviso do Diagnóstico: módulo e código, sem url, partição nem dado pessoal. */
  const avisoPacote = (modulo: string, codigo: CodigoFalhaPacote): AvisoSync => ({
    entidade: `pacote:${modulo}`,
    codigo: AVISO_PACOTE_FALHOU,
    mensagem: `Pacote da primeira carga não usado (${codigo}); os dados vêm pelo pull paginado.`,
  });
  /** O menor dos dois cursores pela data (os do pacote usam o UUID nulo): a entidade continua do menor horizonte. */
  const menorCursor = (a: string, b: string): string => {
    const x = decodificarCursor(a);
    const y = decodificarCursor(b);
    return x && y && Date.parse(y.updated_at) < Date.parse(x.updated_at) ? b : a;
  };
  /** Partições já importadas que cobrem a entidade. */
  const particoesImportadas = (rp: RegistroPacotes, e: string) =>
    new Set(Object.values(rp.importados).filter((i) => e in i.cursores).map((i) => i.particao));

  /**
   * A entidade sai do pacote nesta carga: o que um pacote anterior gravou dela (cobertura incompleta, com o cursor desse
   * pacote) é apagado, e o pull recomeça do zero. Nunca fica linha de filial sem o resto, nem cursor à frente do que veio.
   */
  const entidadeSemPacote = async (rp: RegistroPacotes, e: string) => {
    if (!rp.semPacote.includes(e)) rp.semPacote.push(e);
    if (particoesImportadas(rp, e).size > 0) {
      try {
        await op.armazenamento.linhas!.limpar(e);
        await op.armazenamento.remover(CHAVE.escopo(e));
      } finally {
        linhasMudaram(e);
      }
      for (const i of Object.values(rp.importados)) delete i.cursores[e];
    }
    delete rp.particoes[e];
  };

  interface ItemPacote {
    pacote: PacoteSync;
    /** Entidades que este pacote grava nesta passada. */
    entidades: string[];
  }

  /**
   * Manifesto → pacotes a importar nesta passada. Entra no pacote a entidade pendente que nunca foi puxada (sem cursor e
   * sem versão) ou que já tem partições importadas de uma passada anterior; a que perdeu uma partição esperada (manifesto
   * novo sem ela) cai no pull. Manifesto que falha = pull paginado (aviso). Outra geração = `GeracaoTrocada` (recomeça).
   */
  const planejarPacotes = async (
    pendentes: readonly string[],
    rp: RegistroPacotes,
    avisos: AvisoSync[],
  ): Promise<{ itens: ItemPacote[]; geracao: string | null }> => {
    let resp: PacotesSyncResposta;
    try {
      resp = await op.transporte.pacotes!();
    } catch {
      avisos.push(avisoPacote('plataforma', 'indisponivel'));
      for (const e of Object.keys(rp.particoes)) if (pendentes.includes(e)) await entidadeSemPacote(rp, e);
      return { itens: [], geracao: null };
    }
    // pacote substituído (o id saiu do manifesto): o `.part` dele não serve mais
    for (const id of Object.keys(rp.baixando))
      if (!resp.pacotes.some((p) => p.id === id)) {
        delete rp.baixando[id];
        await removerLocal(temporariosDoPacote(id).gz);
      }
    if (resp.pacotes.length > 0) await conferirGeracao(resp.geracao_base);
    const pend = new Set(pendentes);
    const porParticao = new Map<string, PacoteSync>();
    for (const p of resp.pacotes) if (!porParticao.has(chaveParticao(p))) porParticao.set(chaveParticao(p), p);
    const cobre = (k: string, e: string) => porParticao.get(k)?.entidades.some((x) => x.nome === e) === true;
    const plano = new Map<string, Set<string>>();
    const planejar = (k: string, e: string) => {
      const id = porParticao.get(k)!.id;
      if (!plano.has(id)) plano.set(id, new Set());
      plano.get(id)!.add(e);
    };
    // entidades com pacote começado numa passada anterior
    for (const [e, esperadas] of Object.entries(rp.particoes)) {
      if (!pend.has(e)) continue;
      const feitas = particoesImportadas(rp, e);
      const faltam = esperadas.filter((k) => !feitas.has(k));
      if (faltam.some((k) => !cobre(k, e))) {
        await entidadeSemPacote(rp, e);
        avisos.push(avisoPacote(op.registro.entidade(e)?.modulo ?? 'plataforma', 'indisponivel'));
        continue;
      }
      for (const k of faltam) planejar(k, e);
    }
    // entidades que entram agora: nunca puxadas (sem cursor e sem versão)
    const cobertura = new Map<string, string[]>();
    for (const p of porParticao.values())
      for (const { nome } of p.entidades)
        if (pend.has(nome)) cobertura.set(nome, [...(cobertura.get(nome) ?? []), chaveParticao(p)]);
    for (const [e, ks] of cobertura) {
      if (rp.particoes[e] || rp.semPacote.includes(e)) continue;
      if ((await op.armazenamento.ler(CHAVE.cursor(e))) !== null || (await op.armazenamento.ler(CHAVE.escopo(e))) !== null)
        continue;
      rp.particoes[e] = ks;
      for (const k of ks) planejar(k, e);
    }
    return {
      itens: resp.pacotes.filter((p) => plano.has(p.id)).map((p) => ({ pacote: p, entidades: [...plano.get(p.id)!] })),
      geracao: resp.geracao_base ?? null,
    };
  };

  /**
   * Um pacote: espaço, download com retomada, bytes e md5, descompactação, importação. Erro de rede (do download) sobe e
   * a passada para (a próxima retoma do `.part`); depois de `MAX_TENTATIVAS_PACOTE` falhas com sinal, ou em qualquer outra
   * falha, as entidades dele caem no pull paginado com aviso. `gravarRegistro` persiste o registro da carga.
   */
  const rodarPacote = async (
    item: ItemPacote,
    rp: RegistroPacotes,
    geracao: string | null,
    avisos: AvisoSync[],
    gravarRegistro: () => Promise<void>,
  ): Promise<void> => {
    const p = item.pacote;
    const entidades = item.entidades.filter((e) => !rp.semPacote.includes(e));
    if (entidades.length === 0) return;
    const arq = op.arquivos!;
    const { gz, db } = temporariosDoPacote(p.id);
    const bytes = (feitos: number) => mudar({ carga: { ...estado.carga, bytes: { feitos, total: p.bytes } } });
    mudar({
      etapa: entidades[0]!,
      carga: { ...estado.carga, entidade: entidades[0]!, modulo: p.modulo, paginas: 0, bytes: { feitos: 0, total: p.bytes } },
    });
    const dl = (rp.baixando[p.id] ??= { baixados: 0, tentativas: 0 });
    /** O download falhou por rede (e ainda há tentativas): o `.part` fica e a passada para. */
    let deRede = false as boolean;
    let falha: CodigoFalhaPacote | null = null;
    try {
      const livre = arq.espacoLivre ? await arq.espacoLivre().catch(() => null) : null;
      if (livre !== null && livre < FATOR_ESPACO_PACOTE * p.bytes) throw new ErroPacoteSync('sem_espaco');
      // retomada: só se o `.part` ainda tem ao menos os bytes anotados
      let de = dl.baixados;
      if (de > 0 && (await arq.lerBloco!(gz, de - 1, 1).catch(() => new Uint8Array(0))).length !== 1) de = 0;
      let ultimo = de;
      let r: { bytes: number; md5: string | null };
      try {
        r = await arq.baixarPacote!(p.url, gz, {
          deBytes: de,
          aoProgredir: (f) => {
            ultimo = f;
            bytes(f);
          },
        });
      } catch (e) {
        dl.baixados = ultimo;
        if (online()) dl.tentativas++;
        if (dl.tentativas >= MAX_TENTATIVAS_PACOTE) throw new ErroPacoteSync('indisponivel');
        deRede = true;
        throw e;
      }
      bytes(r.bytes);
      if (r.bytes !== p.bytes) throw new ErroPacoteSync('tamanho');
      if (r.md5 !== null && r.md5.toLowerCase() !== p.md5.toLowerCase()) throw new ErroPacoteSync('md5');
      await descompactarGzip(arq, gz, db);
      const alvo = p.entidades
        .filter((e) => entidades.includes(e.nome))
        .map((e) => ({
          ...e,
          // várias partições (filiais): a entidade continua do MENOR horizonte entre elas (§1.5)
          cursor: Object.values(rp.importados).reduce((c, i) => (i.cursores[e.nome] ? menorCursor(c, i.cursores[e.nome]!) : c), e.cursor),
        }));
      try {
        await op.armazenamento.linhas!.importarPacote!(db, alvo, { geracao_base: geracao, modulo: p.modulo, particao: p.particao });
      } finally {
        for (const e of alvo) linhasMudaram(e.nome);
      }
      rp.importados[p.id] = {
        particao: chaveParticao(p),
        cursores: Object.fromEntries(p.entidades.filter((e) => entidades.includes(e.nome)).map((e) => [e.nome, e.cursor])),
      };
    } catch (e) {
      if (deRede) {
        await gravarRegistro();
        throw e;
      }
      falha = e instanceof ErroPacoteSync ? e.codigo : 'indisponivel';
    } finally {
      await removerLocal(db);
      if (!deRede) {
        delete rp.baixando[p.id];
        await removerLocal(gz);
      }
      mudar({ carga: { ...estado.carga, bytes: undefined } });
    }
    if (falha) {
      for (const e of entidades) await entidadeSemPacote(rp, e);
      avisos.push(avisoPacote(p.modulo, falha));
      mudar({ avisos: [...avisos] });
    }
    await gravarRegistro();
  };

  /** Módulo de uma chave de `pendentes` (entidade do registro ou id de etapa). */
  const moduloDaChave = (k: string): ModuloId | undefined =>
    op.registro.entidade(k)?.modulo ?? (op.etapas ?? []).find((e) => e.id === k)?.modulo;

  /** Chaves da carga inicial ainda não concluídas (abertura do app): entidades e etapas ativas menos as do registro. */
  const pendentesDaCarga = (modulos: readonly ModuloId[], concluidas: readonly string[]): string[] => {
    const feitas = new Set(concluidas);
    const ativosM = new Set(modulos);
    return [
      ...op.registro.entidadesAtivas(modulos, 'pull').map((e) => e.nome).filter((e) => !feitas.has(e)),
      ...(op.etapas ?? []).filter((e) => ativosM.has(e.modulo) && !feitas.has(`etapa:${e.id}`)).map((e) => e.id),
    ];
  };

  // ---------- carga diária (ADR 0057) ----------
  /** Entidades `diaria` ativas; vazio sem `cargaDiariaDevida` (aí elas são contínuas, como sempre). */
  const entidadesDiarias = (): Set<string> =>
    op.cargaDiariaDevida
      ? new Set(
          op.registro
            .entidadesAtivas(estado.modulosAtivos, 'pull')
            .filter((d) => d.cadencia === 'diaria')
            .map((d) => d.nome),
        )
      : new Set();
  /** A função do shell decide; se ela lançar, carrega (na dúvida, o estoque vem). */
  const cargaDiariaDevida = (): boolean => {
    try {
      return op.cargaDiariaDevida?.(estado.carga_diaria_em ?? null, agora()) ?? false;
    } catch {
      return true;
    }
  };
  /** Só depois de a passada inteira terminar (queda no meio = a próxima refaz do cursor de cada diária). */
  const gravarCargaDiaria = async (quando: string): Promise<void> => {
    await op.armazenamento.gravar(CHAVE.cargaDiaria, quando);
    mudar({ carga_diaria_em: quando });
  };

  /**
   * Sincronização completa (corpo de `motor.sincronizar`, sem o controle de uma-por-vez). `podeTrocar` = pode fazer a troca de
   * geração e recomeçar (ADR 0021); na passada que já recomeçou, outra troca termina com erro. `completa` (ADR 0057) = tudo do
   * zero (ressincronização forçada de cada entidade), diárias inclusive.
   */
  const passadaCompleta = async (podeTrocar: boolean, completa = false): Promise<boolean> => {
    if (!online()) {
      mudar({ erro: 'Sem sinal: a sincronização fica para quando a conexão voltar.' });
      return false;
    }
    // T-0059: na CARGA INICIAL (ainda sem `sincronizado_em`), uma passada anterior interrompida (app encerrado no meio) e
    // recente = pula o que ela já concluiu. Depois da carga, cada entidade já continua do seu cursor (delta barato).
    const cargaInicial = estado.sincronizado_em === null;
    // ADR 0057: as diárias entram na carga inicial, na `completa` e quando a carga do dia está devida
    const diarias = entidadesDiarias();
    const comDiarias = diarias.size > 0 && (cargaInicial || completa || cargaDiariaDevida());
    const defs = op.registro
      .entidadesAtivas(estado.modulosAtivos, 'pull')
      .filter((d) => comDiarias || !diarias.has(d.nome));
    const entidades = defs.map((e) => e.nome);
    const moduloDe = new Map(defs.map((d) => [d.nome, d.modulo] as const));
    const etapas = (op.etapas ?? []).filter((e) => ativos().has(e.modulo));
    const total = 1 + entidades.length + etapas.length;
    const anterior = cargaInicial ? await op.armazenamento.ler<RegistroCarga>(CHAVE.carga) : null;
    const retomar =
      anterior !== null && agora().getTime() - Date.parse(anterior.iniciada_em) < VALIDADE_RETOMADA_MS;
    const registro: RegistroCarga = retomar
      ? { iniciada_em: anterior.iniciada_em, concluidas: [...anterior.concluidas], coberturas: { ...(anterior.coberturas ?? {}) } }
      : { iniciada_em: agora().toISOString(), concluidas: [], coberturas: {} };
    // ADR 0054: o que os pacotes gravaram vale mesmo sem retomada (o cursor de uma filial só vale com todas importadas)
    if (anterior?.pacotes) registro.pacotes = anterior.pacotes;
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
      const ordenada = ordenarCarga<{ item: ItemDaCarga; etapa?: EtapaSync; pacote?: ItemPacote }>(
        [
          ...entidades.map((e) => ({ item: { chave: e, modulo: moduloDe.get(e) ?? null, tipo: 'entidade' as const } })),
          ...etapas.map((e) => ({ item: { chave: e.id, modulo: e.modulo, tipo: 'etapa' as const }, etapa: e })),
        ],
        (x) => x.item,
      );
      const feitoNaCarga = (i: ItemDaCarga) => jaFeitas.has(i.tipo === 'etapa' ? chaveEtapa(i.chave) : i.chave);
      // ADR 0054 (solução 5): o que falta da carga inicial e quando os essenciais liberam a entrada
      const feitos = new Set(ordenada.filter((x) => feitoNaCarga(x.item)).map((x) => x.item.chave));
      const essencial = (i: ItemDaCarga) => {
        try {
          return op.essenciais?.(i) === true;
        } catch {
          return false;
        }
      };
      const essenciais = cargaInicial && op.essenciais ? ordenada.map((x) => x.item).filter(essencial) : [];
      const liberar = async () => {
        if (estado.liberado_em || essenciais.length === 0 || !essenciais.every((i) => feitos.has(i.chave))) return;
        const quando = agora().toISOString();
        await op.armazenamento.gravar(CHAVE.liberadoEm, quando);
        mudar({ liberado_em: quando });
      };
      const marcarFeito = async (i: ItemDaCarga) => {
        feitos.add(i.chave);
        if (!cargaInicial) return;
        mudar({ pendentes: (estado.pendentes ?? []).filter((k) => k !== i.chave) });
        await liberar();
      };
      if (cargaInicial) {
        mudar({ pendentes: ordenada.filter((x) => !feitos.has(x.item.chave)).map((x) => x.item.chave) });
        await liberar();
      }
      // ADR 0054: pacotes da carga inicial, cada um logo antes da primeira entidade que cobre
      let sequencia = ordenada;
      let geracaoPacotes: string | null = null;
      if (cargaInicial && podeUsarPacote()) {
        const rp = (registro.pacotes ??= { importados: {}, particoes: {}, semPacote: [], baixando: {} });
        const plano = await planejarPacotes(entidades.filter((e) => !jaFeitas.has(e)), rp, avisos);
        geracaoPacotes = plano.geracao;
        await op.armazenamento.gravar(CHAVE.carga, registro);
        if (avisos.length > 0) mudar({ avisos: [...avisos] });
        sequencia = [];
        const colocados = new Set<ItemPacote>();
        for (const x of ordenada) {
          if (x.item.tipo === 'entidade')
            for (const ip of plano.itens)
              if (!colocados.has(ip) && ip.entidades.includes(x.item.chave)) {
                colocados.add(ip);
                sequencia.push({ item: x.item, pacote: ip });
              }
          sequencia.push(x);
        }
      }
      for (const { item, etapa: et, pacote } of sequencia) {
        if (pacote) {
          if (feitoNaCarga(item)) continue;
          await rodarPacote(pacote, registro.pacotes!, geracaoPacotes, avisos, () =>
            op.armazenamento.gravar(CHAVE.carga, registro),
          );
          continue;
        }
        if (et === undefined) {
          const e = item.chave;
          if (jaFeitas.has(e)) continue;
          mudar({ etapa: e, progresso: feito / total, carga: carga({ entidade: e, modulo: item.modulo, paginas: 0 }) });
          const resultado = await puxarEntidade(
            e,
            coberturas,
            () => mudar({ carga: carga({ paginas: estado.carga.paginas + 1 }) }),
            completa,
          );
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
          await marcarFeito(item);
        } else {
          if (jaFeitas.has(chaveEtapa(et.id))) continue;
          mudar({ etapa: et.rotulo, progresso: feito / total, carga: carga({ entidade: et.id, modulo: et.modulo, paginas: 0 }) });
          await et.executar(contextoDaEtapa(et));
          feito++;
          await concluir(chaveEtapa(et.id));
          mudar({ carga: carga({ concluidas: feito - 1 }) });
          await marcarFeito(item);
        }
      }
      // carga em massa da busca: `rebuild` uma vez no fim (desenho T-0008 §2.3); antes, a versão dos índices (T-0084)
      await conferirVersoesBusca();
      await op.armazenamento.busca?.finalizar?.();
      await liberarAceitos(coberturas);
      const quando = agora().toISOString();
      await op.armazenamento.gravar(CHAVE.sincronizadoEm, quando);
      if (base) await op.armazenamento.gravar(CHAVE.novidades, base.cursor);
      else await op.armazenamento.remover(CHAVE.novidades);
      if (cargaInicial) await op.armazenamento.remover(CHAVE.carga);
      // sem item essencial na sequência, a entrada fica liberada no fim da carga
      if (cargaInicial && op.essenciais && !estado.liberado_em) {
        await op.armazenamento.gravar(CHAVE.liberadoEm, quando);
        mudar({ liberado_em: quando });
      }
      if (comDiarias) await gravarCargaDiaria(quando);
      mudar({
        sincronizando: false,
        etapa: 'Pronto',
        progresso: 1,
        sincronizado_em: quando,
        pendentes: [],
        carga: carga({ entidade: null, modulo: null, concluidas: total, paginas: 0 }),
      });
      return true;
    } catch (e) {
      if (e instanceof GeracaoTrocada) return depoisDaGeracaoTrocada(e, podeTrocar, completa);
      // o que já foi puxado nesta passada vale: sai da sobreposição o aceito que as entidades que chegaram cobrem
      await liberarAceitos(coberturas).catch(() => undefined);
      mudar({ sincronizando: false, etapa: '', progresso: 0, erro: msg(e) });
      return false;
    }
  };

  /** ADR 0021: troca a geração e faz a passada completa de novo (uma vez); falha na troca = erro, a próxima repete. */
  const depoisDaGeracaoTrocada = async (e: GeracaoTrocada, podeTrocar: boolean, completa = false): Promise<boolean> => {
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
    return passadaCompleta(false, completa);
  };

  /** ADR 0057: entidades da sincronização `parcial` (ativas, de pull, `parcial` e não diárias), na ordem da carga. */
  const entidadesParciais = (): string[] => {
    const diarias = entidadesDiarias();
    const defs = op.registro
      .entidadesAtivas(estado.modulosAtivos, 'pull')
      .filter((d) => d.parcial === true && !diarias.has(d.nome));
    return ordenarCarga(defs, (d): ItemDaCarga => ({ chave: d.nome, modulo: d.modulo, tipo: 'entidade' })).map((d) => d.nome);
  };

  /**
   * Passada LEVE (novidades, push silencioso e `parcial`): envia a fila, `escolher` diz o que puxar (cada entidade do seu
   * cursor), sem etapas. `cursorNovo` = cursor de novidades a gravar no fim; `comDiarias` = grava `carga_diaria_em` no fim.
   */
  const passadaLeve = async (
    etapa: string,
    escolher: () => Promise<{ alvo: string[]; cursorNovo: string | null; comDiarias: boolean }>,
    parcial = false,
  ): Promise<boolean> => {
    if (!online()) {
      mudar({ erro: 'Sem sinal: a sincronização fica para quando a conexão voltar.' });
      return false;
    }
    mudar({ sincronizando: true, erro: null, etapa, progresso: 0, avisos: [] });
    const coberturas = new Map<string, Cobertura>();
    try {
      await motor.enviar();
      const { alvo, cursorNovo, comDiarias } = await escolher();
      const avisos: AvisoSync[] = [];
      for (const [i, e] of alvo.entries()) {
        mudar({ etapa: e, progresso: (i + 1) / (alvo.length + 1) });
        if ((await puxarEntidade(e, coberturas, undefined, false, parcial)) === 'indisponivel')
          avisos.push({ entidade: e, codigo: SYNC_NAO_IMPLEMENTADO, mensagem: MENSAGEM_PULL_INDISPONIVEL });
      }
      if (alvo.length > 0) {
        await conferirVersoesBusca();
        await op.armazenamento.busca?.finalizar?.();
      }
      await liberarAceitos(coberturas);
      // só agora: se um pull falhar, a próxima consulta repete as mesmas entidades (nada se perde)
      if (cursorNovo) await op.armazenamento.gravar(CHAVE.novidades, cursorNovo);
      const quando = agora().toISOString();
      await op.armazenamento.gravar(CHAVE.sincronizadoEm, quando);
      if (comDiarias) await gravarCargaDiaria(quando);
      mudar({ sincronizando: false, etapa: 'Pronto', progresso: 1, sincronizado_em: quando, avisos });
      return true;
    } catch (e) {
      if (e instanceof GeracaoTrocada) return depoisDaGeracaoTrocada(e, true);
      await liberarAceitos(coberturas).catch(() => undefined);
      mudar({ sincronizando: false, etapa: '', progresso: 0, erro: msg(e) });
      return false;
    }
  };

  const motor = {
    /** Ambiente do aparelho (o mesmo que as etapas recebem): telas usam via `useAmbiente()`. */
    ambiente,
    /** Atalho para `ambiente.http` (cliente HTTP com a sessão; respeita o modo sem sinal). */
    http: ambiente.http,

    /** Lê do armazenamento a fila, os módulos e as pendências (chamar uma vez ao abrir o app / trocar de usuário). */
    async carregar(): Promise<void> {
      // na vez das gravações: nunca lê o disco antes de uma gravação em curso e sobrescreve a memória depois dela
      await emSerie(async () => {
        const [fila, modulos, limpeza, sincronizadoEm, arquivos, aceitos, params, geracao, liberadoEm, cargaGuardada, cargaDiaria] = await Promise.all([
          op.armazenamento.ler<ItemOutbox[]>(CHAVE.fila),
          op.armazenamento.ler<ModuloId[]>(CHAVE.modulos),
          op.armazenamento.ler<ModuloId[]>(CHAVE.limpeza),
          op.armazenamento.ler<string>(CHAVE.sincronizadoEm),
          op.armazenamento.ler<ItemArquivo[]>(CHAVE.arquivos),
          op.armazenamento.ler<ItemAceito[]>(CHAVE.aceitos),
          op.armazenamento.ler<ParametrosModulos>(CHAVE.parametros),
          op.armazenamento.ler<string>(CHAVE.geracao),
          op.armazenamento.ler<string>(CHAVE.liberadoEm),
          op.armazenamento.ler<RegistroCarga>(CHAVE.carga),
          op.armazenamento.ler<string>(CHAVE.cargaDiaria),
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
          // ADR 0054: app reaberto no meio da carga inicial entra direto (liberado) e sabe o que ainda falta
          liberado_em: liberadoEm,
          pendentes: sincronizadoEm === null ? pendentesDaCarga(modulos ?? [], cargaGuardada?.concluidas ?? []) : [],
          carga_diaria_em: cargaDiaria,
          erro: null,
        });
      });
    },

    estado(): EstadoMotorSync {
      return estado;
    },

    /**
     * ADR 0054 (solução 5): a carga inicial ainda não trouxe tudo do módulo (`estado.pendentes`). Com o Catálogo pendente,
     * busca, ficha e preço vão à API.
     */
    cargaPendente(modulo: ModuloId): boolean {
      return (estado.pendentes ?? []).some((k) => moduloDaChave(k) === modulo);
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
      // D-T0039d: só entra no estado depois de gravado; disco cheio = exceção e a fila fica como estava.
      // A checagem do id repete na vez da gravação: dois `enfileirar` simultâneos do mesmo id gravam um só.
      let gravado = item;
      await gravarFila((atual) => {
        const ja = atual.find((i) => i.id === item.id);
        if (ja) {
          gravado = ja;
          return null;
        }
        return [...atual, item];
      });
      return gravado;
    },

    /** Altera um item ainda na fila (ex.: editar pedido não enviado), mantendo id e posição. */
    async alterar(
      id: string,
      mudanca: Partial<Pick<ItemOutbox, 'payload' | 'rotulo' | 'detalhe'>>,
    ): Promise<boolean> {
      let achou = false;
      await gravarFila((atual) => {
        achou = atual.some((i) => i.id === id);
        if (!achou) return null;
        return atual.map((i) =>
          i.id === id ? { ...i, ...mudanca, situacao: 'pendente' as const, ultimo_erro: '', codigo: null } : i,
        );
      });
      return achou;
    },

    async descartar(id: string): Promise<void> {
      await gravarFila((atual) => (atual.some((i) => i.id === id) ? atual.filter((i) => i.id !== id) : null));
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
      if (!(TIPOS_ENVIO_APARELHO as readonly string[]).includes(tipo)) throw new Error(`Arquivo: tipo ${tipo} não aceito`);
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
        ...(novo.apagarAoEnviar ? { apagar_ao_enviar: true as const } : {}),
      };
      let gravado = item;
      await gravarArquivos((atual) => {
        const ja = atual.find((a) => a.id === id);
        if (ja) {
          gravado = ja;
          return null;
        }
        return [...atual, item];
      });
      return gravado;
    },

    /** Tira o arquivo da fila e apaga o arquivo local (o usuário desistiu dele ou vai registrar de novo). */
    async descartarArquivo(id: string): Promise<void> {
      const saiu: ItemArquivo[] = [];
      await gravarArquivos((atual) => {
        saiu.push(...atual.filter((x) => x.id === id.toLowerCase()));
        return saiu.length > 0 ? atual.filter((x) => x.id !== id.toLowerCase()) : null;
      });
      for (const a of saiu) await removerLocal(a.caminho);
    },

    /** Arquivos ainda não aceitos pelo servidor ("Fotos pendentes: N" na tela de sync). */
    arquivosPendentes(): readonly ItemArquivo[] {
      return estado.arquivos.filter((a) => a.situacao !== 'enviado');
    },

    /**
     * Envia a fila de itens em ordem e, depois, a fila de arquivos (ADR 0010 §4). Uma passada por vez. Chamada com uma
     * passada em curso espera por ela e faz MAIS UMA (a mesma para todas as chamadas que chegaram no meio): a passada
     * em curso pode ter começado sem sinal ou antes de itens e edições novos, e quem chama (ex.: `sincronizar` logo
     * depois do `void enviar()` de uma tela, feito sem sinal) precisa que o que já estava na fila tenha ido. Devolve os
     * resultados dos itens da passada que a chamada esperou.
     */
    enviar(opcoes: { incluirFalhos?: boolean } = {}): Promise<ResultadoItemPush[]> {
      const passada = (incluirFalhos: boolean): Promise<ResultadoItemPush[]> => {
        const envio = (async () => {
          const comSinal = online();
          const r = await enviarAgora(incluirFalhos);
          await enviarArquivosAgora(incluirFalhos, comSinal);
          return r;
        })().finally(() => {
          if (envioEmCurso === envio) envioEmCurso = null;
        });
        envioEmCurso = envio;
        return envio;
      };
      if (!envioEmCurso) return passada(!!opcoes.incluirFalhos);
      if (opcoes.incluirFalhos) proximoIncluiFalhos = true;
      if (!proximoEnvio) {
        proximoEnvio = envioEmCurso
          .catch(() => undefined)
          .then(() => {
            const incluirFalhos = proximoIncluiFalhos;
            proximoEnvio = null;
            proximoIncluiFalhos = false;
            // alguém começou uma passada entre o fim da anterior e este ponto: ela já começou depois dos pedidos
            if (!envioEmCurso) return passada(incluirFalhos);
            return incluirFalhos ? motor.enviar({ incluirFalhos }) : envioEmCurso;
          });
      }
      return proximoEnvio;
    },

    /**
     * Sincronização (uma por vez, junto com `sincronizarNovidades`: quem chama durante uma em curso recebe a mesma promessa).
     * - Sem `modo`: a de sempre — envia a fila, puxa as entidades dos módulos efetivos (cada uma do seu cursor) e roda as
     *   etapas extras. As entidades `diaria` só entram na carga inicial ou com a carga diária devida (ADR 0057).
     * - `parcial` (toque no "Sincronizar", ADR 0057): envia a fila e puxa só as entidades `parcial` (pedidos e clientes), sem
     *   etapas, sem novidades e sem mexer no cursor delas. Antes da 1ª sincronização, ou sem entidade `parcial`, faz a de sempre.
     * - `completa` (segurar 10 s, ADR 0057): tudo do zero — cada entidade é ressincronizada desde o cursor nulo (no fim sai do
     *   aparelho o que não veio), diárias inclusive, com as etapas e o progresso da carga (`estado.carga`); no fim grava
     *   `carga_diaria_em`. Com outra sincronização em curso, espera ela terminar e roda depois.
     */
    sincronizar(opcoes: { modo?: ModoSincronizacao } = {}): Promise<boolean> {
      if (opcoes.modo === 'completa') {
        if (completaEmCurso) return completaEmCurso;
        const antes = syncEmCurso;
        const p = emCurso(async () => {
          if (antes) await antes.catch(() => false);
          return passadaCompleta(true, true);
        });
        completaEmCurso = p;
        void p.finally(() => {
          if (completaEmCurso === p) completaEmCurso = null;
        }).catch(() => undefined);
        return p;
      }
      if (syncEmCurso) return syncEmCurso;
      if (opcoes.modo === 'parcial' && estado.sincronizado_em !== null && entidadesParciais().length > 0)
        return emCurso(() =>
          passadaLeve('Enviando a fila', async () => ({ alvo: entidadesParciais(), cursorNovo: null, comDiarias: false }), true),
        );
      return emCurso(() => passadaCompleta(true));
    },

    /**
     * Atualização LEVE (RN-CORE-23, ADR 0018): envia a fila (só se houver pendente), consulta `GET /v1/sync/novidades`
     * com o cursor guardado, aplica os módulos efetivos se mudaram e puxa só as entidades que mudaram. Com
     * `opcoes.entidades` (lista do push silencioso), puxa só essas, sem consultar novidades (o cursor não anda).
     * ADR 0057: as entidades `diaria` ficam de fora; com a carga diária devida, entram todas (cada uma do seu cursor) e o
     * fim grava `carga_diaria_em`.
     * Sem `transporte.novidades` ou antes da primeira sincronização completa, faz a completa (`sincronizar`).
     * Uma por vez, junto com `sincronizar` (quem chama durante uma em curso recebe a mesma promessa).
     */
    sincronizarNovidades(opcoes: { entidades?: readonly string[] } = {}): Promise<boolean> {
      const consultar = op.transporte.novidades?.bind(op.transporte);
      if (!consultar || estado.sincronizado_em === null) return motor.sincronizar();
      if (syncEmCurso) return syncEmCurso;
      return emCurso(() =>
        passadaLeve('Verificando novidades', async () => {
          const ativasPull = () => new Set(op.registro.entidadesAtivas(estado.modulosAtivos, 'pull').map((e) => e.nome));
          const itemDe = (e: string): ItemDaCarga => ({ chave: e, modulo: op.registro.entidade(e)?.modulo ?? null, tipo: 'entidade' });
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
            // ADR 0021: base recriada → troca de geração e passada completa (o `catch` da passada leve)
            await conferirGeracao(r.geracao_base);
            const ativas = ativasPull();
            alvo = ordenarCarga([...new Set(r.entidades)].filter((e) => ativas.has(e)).sort(), itemDe);
            cursorNovo = r.cursor;
          }
          // ADR 0057: diárias só na carga do dia (o cursor de novidades anda; cada diária continua do seu cursor)
          const diarias = entidadesDiarias();
          const comDiarias = diarias.size > 0 && cargaDiariaDevida();
          alvo = alvo.filter((e) => !diarias.has(e));
          if (comDiarias) alvo.push(...ordenarCarga([...diarias].sort(), itemDe));
          return { alvo, cursorNovo, comDiarias };
        }),
      );
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
      // disco primeiro, memória depois (D-T0039d)
      const novosParams = filtrarParametros(novosParametros ?? parametros, modulos);
      await emSerie(async () => {
        await op.armazenamento.gravar(CHAVE.parametros, novosParams);
        parametros = novosParams;
        await op.armazenamento.gravar(CHAVE.modulos, [...modulos]);
        mudar({ modulosAtivos: [...modulos] });
      });
      // módulo que voltou: itens marcados como "módulo desativado" voltam para a fila
      const voltou = (x: { situacao: string; modulo: ModuloId }) => x.situacao === 'modulo_inativo' && novos.has(x.modulo);
      await gravarArquivos((atual) =>
        atual.some(voltou)
          ? atual.map((a) => (voltou(a) ? { ...a, situacao: 'pendente' as const, codigo: null, ultimo_erro: '' } : a))
          : null,
      );
      await gravarFila((atual) =>
        atual.some(voltou)
          ? atual.map((i) => (voltou(i) ? { ...i, situacao: 'pendente' as const, codigo: null, ultimo_erro: '' } : i))
          : null,
      );
      let limpeza = estado.limpezaPendente.filter((m) => !novos.has(m));
      let tentarEnviar = false;
      for (const m of anteriores.filter((x) => !novos.has(x))) {
        if (estado.fila.some((i) => i.modulo === m) || temArquivoPendente(m)) {
          if (!limpeza.includes(m)) limpeza = [...limpeza, m];
          tentarEnviar = true;
        } else {
          await apagandoLinhas(() => emTransacao((a) => limparModulo(m, a)));
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
      // fila, dados e pendência juntos (com `emTransacao`, tudo ou nada); o estado só muda depois de gravado, e a fila
      // nova é calculada na vez da gravação (o que entrou na fila enquanto isso não se perde)
      await emSerie(async () => {
        const fila = estado.fila.filter((i) => i.modulo !== modulo);
        const limpeza = estado.limpezaPendente.filter((m) => m !== modulo);
        await apagandoLinhas(() =>
          emTransacao(async (a) => {
            await a.gravar(CHAVE.fila, fila);
            await limparModulo(modulo, a);
            await a.gravar(CHAVE.limpeza, limpeza);
          }),
        );
        mudar({ fila, limpezaPendente: limpeza });
      });
      await descartarArquivosDoModulo(modulo);
      await descartarAceitosDoModulo(modulo);
    },

    /**
     * RN-CORE-15 (aparelho bloqueado): apaga TUDO o que o motor guarda deste usuário — linhas, cursores, versões de
     * escopo, chaves `mod:*`, estruturas próprias dos módulos, fila de itens e fila de arquivos (com os arquivos locais
     * que ela conhece). Numa transação quando o adaptador sabe. Fotos ainda não enfileiradas são do shell (pasta `fotos/`).
     */
    async limparAparelho(): Promise<void> {
      // na vez das gravações da fila: o que entrou antes também sai; o estado só muda depois de apagado
      const arquivos = await emSerie(async () => {
        const conhecidos = estado.arquivos;
        await apagandoLinhas(() =>
          emTransacao(async (a) => {
            for (const m of MODULOS) await limparModulo(m, a);
            for (const k of await a.chaves('')) await a.remover(k);
          }),
        );
        parametros = {};
        geracaoGuardada = null;
        mudar({ fila: [], aceitos: [], arquivos: [], limpezaPendente: [], modulosAtivos: [], sincronizado_em: null, liberado_em: null, pendentes: [], carga_diaria_em: null, avisos: [], erro: null, carga: CARGA_VAZIA });
        return conhecidos;
      });
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
     * T-0052-B4: registros locais com `<campo>` (de primeiro nível) igual a um dos `valores` — ex.: estoque, preço e
     * atributos só dos produtos candidatos. Comparação estrita de tipo (`'5'` não casa `5`); `null`, NaN e repetidos
     * são ignorados; sem ordem garantida. Campo fora de `[a-z][a-z0-9_]*` = erro do app. No SQLite fica rápido com o
     * índice de expressão do dono da entidade, escrito EXATAMENTE `json_extract(dados, '$.<campo>')`; sem índice, uma
     * varredura em C da tabela (ainda sem montar as linhas que não casam em JS).
     */
    async linhasPorCampo<L extends LinhaSync = LinhaSync>(
      entidade: string,
      campo: string,
      valores: readonly ValorCampoLinha[],
    ): Promise<L[]> {
      validarCampoLinha(campo);
      const unicos = valoresDeCampo(valores);
      if (unicos.length === 0) return [];
      if (op.armazenamento.linhas?.porCampo) return op.armazenamento.linhas.porCampo<L>(entidade, campo, unicos);
      return filtrarPorCampo(await motor.linhas<L>(entidade), campo, unicos);
    },

    /** T-0052-B4: quantas linhas locais a entidade tem, sem ler as linhas (SQLite: `count(*)`). */
    async contarLinhas(entidade: string): Promise<number> {
      if (op.armazenamento.linhas) return op.armazenamento.linhas.contar(entidade);
      const l = (await op.armazenamento.ler<Record<string, LinhaSync>>(CHAVE.entidade(entidade))) ?? {};
      return Object.keys(l).length;
    },

    /**
     * T-0052-B4: versão das linhas locais da entidade, para o módulo MEMORIZAR o que deriva delas (mapa por produto,
     * vocabulário) e só reler quando o sync mudar. Opaca: só compare com `===`. Muda quando uma página do pull grava
     * linhas da entidade, quando a ressincronização apaga o que saiu do escopo e quando o motor apaga linhas (módulo
     * desativado, troca de geração, aparelho bloqueado). Única no processo (outro motor, outro usuário = outro número).
     * Uso: leia a versão ANTES das linhas e guarde o derivado com ela. Não cobre a fila: sobreponha `sobreposicao()`.
     */
    versaoLinhas(entidade: string): number {
      let v = versoes.get(entidade);
      if (v === undefined) {
        v = ++relogioVersoes;
        versoes.set(entidade, v);
      }
      return v;
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
      if (!op.armazenamento.busca) return null;
      await conferirVersoesBusca();
      return op.armazenamento.busca.buscar(indice, consulta);
    },

    /**
     * Como `buscar`, separando "busquei e não achei" (`{ buscou: true, resultados: [] }`) de "não consegui buscar"
     * (`{ buscou: false, motivo }`: sem a capacidade, consulta vazia/1 letra, módulo indisponível, índice inválido, erro
     * do FTS). Só o primeiro autoriza concluir "nenhum resultado"; no segundo, o caminho de reserva (varredura).
     * Armazenamento de fora do SDK sem `buscarComDesfecho`: acerto = `buscou`, lista vazia = `indeterminado`.
     */
    async buscarComDesfecho(indice: string, consulta: ConsultaTexto): Promise<DesfechoBusca> {
      const busca = op.armazenamento.busca;
      if (!busca) return { buscou: false, motivo: 'sem_busca' };
      await conferirVersoesBusca();
      if (busca.buscarComDesfecho) return busca.buscarComDesfecho(indice, consulta);
      const resultados = await busca.buscar(indice, consulta);
      return resultados.length > 0 ? { buscou: true, resultados } : { buscou: false, motivo: 'indeterminado' };
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
