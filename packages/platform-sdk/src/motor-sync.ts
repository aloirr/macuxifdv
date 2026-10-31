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
 * - ADR 0009 §3: o pull nunca mexe na fila; a tela sobrepõe `motor.pendentes(entidade)` às linhas.
 * - T-0008 P1: extensões opcionais do armazenamento (`linhas`, `emTransacao`, `removerModulo`); sem elas, o
 *   caminho chave→JSON de sempre.
 */
import { ambienteIndisponivel, type AmbienteAparelho } from './ambiente';
import type { ModuloId } from './nomes';
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
}

/** Linhas das entidades de pull, por linha (desenho T-0008 §1.1). Toda operação é idempotente. */
export interface LinhasSync {
  /** Uma página do pull, atômica: upsert das vivas, apaga as com `deleted_at` e grava o cursor (`null` = mantém o atual). */
  aplicar(entidade: string, linhas: readonly LinhaSync[], cursor: string | null): Promise<void>;
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
}

export interface ContextoEtapaSync extends AmbienteAparelho {
  /** Armazenamento do módulo (prefixo `mod:<modulo>:`): apagado quando o módulo é desativado. */
  armazenamento: ArmazenamentoSync;
  agora: () => Date;
}

export interface EstadoMotorSync {
  fila: readonly ItemOutbox[];
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
}

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
}

const CHAVE = {
  fila: 'sync:fila',
  modulos: 'sync:modulos',
  limpeza: 'sync:limpeza_pendente',
  sincronizadoEm: 'sync:sincronizado_em',
  cursor: (e: string) => `sync:cursor:${e}`,
  /** Última `versao_escopo` recebida da entidade (ADR 0009 §4). */
  escopo: (e: string) => `sync:escopo:${e}`,
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

/** Mensagem do aviso de entidade sem provedor no servidor. */
export const MENSAGEM_PULL_INDISPONIVEL =
  'Ainda não disponível no servidor; os outros dados foram sincronizados.';

type Linhas = Record<string, LinhaSync>;

export function criarMotorSync(op: OpcoesMotorSync) {
  const agora = op.agora ?? (() => new Date());
  const ambiente: AmbienteAparelho = op.ambiente ?? ambienteIndisponivel();
  const online = op.online ?? (op.ambiente ? () => ambiente.online() : () => true);
  const msg = op.mensagemDeErro ?? ((e: unknown) => (e instanceof Error ? e.message : String(e)));
  const ouvintes = new Set<(e: EstadoMotorSync) => void>();

  let estado: EstadoMotorSync = {
    fila: [],
    enviando: false,
    sincronizando: false,
    etapa: '',
    progresso: 0,
    erro: null,
    sincronizado_em: null,
    modulosAtivos: [],
    limpezaPendente: [],
    avisos: [],
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
    }
    for (const k of await a.chaves(CHAVE.modulo(modulo))) await a.remover(k);
    await a.removerModulo?.(modulo);
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
            // enviado: sai da fila
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
        await gravarFila(fila);
        if (parar) break;
      }
    } finally {
      mudar({ enviando: false });
    }
    return resultados;
  };

  // ---------- recebimento (pull) ----------
  /**
   * Puxa todas as páginas da entidade. `'indisponivel'` = o servidor respondeu 501 `SYNC_NAO_IMPLEMENTADO` (nada
   * muda no aparelho). Ressincroniza quando a `versao_escopo` da página difere da guardada (ADR 0009 §4).
   */
  const puxarEntidade = async (entidade: string): Promise<'ok' | 'indisponivel'> => {
    const a = op.armazenamento;
    const versaoGuardada = await a.ler<string>(CHAVE.escopo(entidade));
    let cursor = await a.ler<string>(CHAVE.cursor(entidade));
    // caminho chave→JSON: o mapa é lido uma vez e regravado por página (com `linhas`, o adaptador grava por linha)
    const mapa: Linhas = a.linhas ? {} : ((await a.ler<Linhas>(CHAVE.entidade(entidade))) ?? {});
    let ressinc: { versao: string; vistos: Set<string> } | null = null;
    for (;;) {
      let pagina: PaginaSync<LinhaSync>;
      try {
        pagina = await op.transporte.pull(entidade, cursor);
      } catch (e) {
        if (ehSyncNaoImplementado(e) && !ressinc) return 'indisponivel';
        throw e;
      }
      const versao = pagina.versao_escopo;
      if (!ressinc && versao !== undefined && versao !== versaoGuardada) {
        ressinc = { versao, vistos: new Set() };
        if (cursor !== null) {
          // o conjunto visível mudou: linhas antigas de quem entrou estão atrás do cursor — recomeça do início
          cursor = null;
          continue;
        }
      }
      if (ressinc) for (const l of pagina.itens) ressinc.vistos.add(l.id);
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
      if (!pagina.proximo_cursor) break;
    }
    if (ressinc) {
      // fim da passada completa: o que não veio saiu do escopo (RN-CORE-04) e sai do aparelho
      const { vistos, versao } = ressinc;
      if (a.linhas) {
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
      // só agora: se o app cair no meio, a próxima passada ainda vê a versão antiga e ressincroniza de novo
      await a.gravar(CHAVE.escopo(entidade), versao);
    }
    return 'ok';
  };

  const motor = {
    /** Ambiente do aparelho (o mesmo que as etapas recebem): telas usam via `useAmbiente()`. */
    ambiente,
    /** Atalho para `ambiente.http` (cliente HTTP com a sessão; respeita o modo sem sinal). */
    http: ambiente.http,

    /** Lê do armazenamento a fila, os módulos e as pendências (chamar uma vez ao abrir o app / trocar de usuário). */
    async carregar(): Promise<void> {
      const [fila, modulos, limpeza, sincronizadoEm] = await Promise.all([
        op.armazenamento.ler<ItemOutbox[]>(CHAVE.fila),
        op.armazenamento.ler<ModuloId[]>(CHAVE.modulos),
        op.armazenamento.ler<ModuloId[]>(CHAVE.limpeza),
        op.armazenamento.ler<string>(CHAVE.sincronizadoEm),
      ]);
      mudar({
        fila: fila ?? [],
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

    /** Envia a fila em ordem. Uma execução por vez (chamadas simultâneas recebem a mesma promessa). */
    enviar(opcoes: { incluirFalhos?: boolean } = {}): Promise<ResultadoItemPush[]> {
      if (envioEmCurso) return envioEmCurso;
      envioEmCurso = enviarAgora(!!opcoes.incluirFalhos).finally(() => {
        envioEmCurso = null;
      });
      return envioEmCurso;
    },

    /** Sincronização completa: envia a fila, puxa as entidades dos módulos efetivos e roda as etapas extras. */
    sincronizar(): Promise<boolean> {
      if (syncEmCurso) return syncEmCurso;
      syncEmCurso = (async () => {
        if (!online()) {
          mudar({ erro: 'Sem sinal: a sincronização fica para quando a conexão voltar.' });
          return false;
        }
        const entidades = op.registro.entidadesAtivas(estado.modulosAtivos, 'pull').map((e) => e.nome);
        const etapas = (op.etapas ?? []).filter((e) => ativos().has(e.modulo));
        const total = 1 + entidades.length + etapas.length;
        mudar({ sincronizando: true, erro: null, etapa: 'Enviando a fila', progresso: 0, avisos: [] });
        try {
          await motor.enviar();
          let feito = 1;
          const avisos: AvisoSync[] = [];
          for (const e of entidades) {
            mudar({ etapa: e, progresso: feito / total });
            if ((await puxarEntidade(e)) === 'indisponivel') {
              avisos.push({
                entidade: e,
                codigo: SYNC_NAO_IMPLEMENTADO,
                mensagem: MENSAGEM_PULL_INDISPONIVEL,
              });
              mudar({ avisos: [...avisos] });
            }
            feito++;
          }
          for (const e of etapas) {
            mudar({ etapa: e.rotulo, progresso: feito / total });
            await e.executar({
              armazenamento: comPrefixo(op.armazenamento, CHAVE.modulo(e.modulo)),
              agora,
              http: ambiente.http,
              online,
              novoId: () => ambiente.novoId(),
              usuario: () => ambiente.usuario(),
            });
            feito++;
          }
          const quando = agora().toISOString();
          await op.armazenamento.gravar(CHAVE.sincronizadoEm, quando);
          mudar({ sincronizando: false, etapa: 'Pronto', progresso: 1, sincronizado_em: quando });
          return true;
        } catch (e) {
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
     */
    async aplicarModulosAtivos(modulos: readonly ModuloId[]): Promise<void> {
      const anteriores = estado.modulosAtivos;
      const novos = new Set(modulos);
      mudar({ modulosAtivos: [...modulos] });
      await op.armazenamento.gravar(CHAVE.modulos, [...modulos]);
      // módulo que voltou: itens marcados como "módulo desativado" voltam para a fila
      const voltaram = estado.fila.some((i) => i.situacao === 'modulo_inativo' && novos.has(i.modulo));
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
        if (estado.fila.some((i) => i.modulo === m)) {
          if (!limpeza.includes(m)) limpeza = [...limpeza, m];
          tentarEnviar = true;
        } else {
          await emTransacao((a) => limparModulo(m, a));
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
     * Itens ainda não aceitos da entidade (`pendente` e `falhou`), na ordem da fila: a tela os sobrepõe às linhas do
     * pull com a função pura do módulo (ADR 0009 §3, ex.: `aplicarPendentesVisita`). O pull nunca os apaga.
     */
    pendentes(entidade: string): readonly ItemOutbox[] {
      return estado.fila.filter(
        (i) => i.entidade === entidade && (i.situacao === 'pendente' || i.situacao === 'falhou'),
      );
    },

    /** Armazenamento próprio do módulo (prefixo `mod:<m>:`), apagado junto com o módulo (RN-CORE-02). */
    armazenamentoDoModulo(modulo: ModuloId): ArmazenamentoSync {
      return comPrefixo(op.armazenamento, CHAVE.modulo(modulo));
    },
  };
  return motor;
}

export type MotorSync = ReturnType<typeof criarMotorSync>;
