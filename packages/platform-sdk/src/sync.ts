/**
 * Sincronização offline (docs/produto/04 "Sincronização offline").
 *
 * - Cada módulo registra as entidades declaradas em `sync` do manifesto, com a política de conflito.
 * - Pull: `GET /v1/sync/pull?entidades=...&cursor=...`, cursor `(updated_at, id)`, inclui removidos,
 *   páginas de 1.000, escopo da carteira, só entidades de módulos efetivos.
 * - Push: `POST /v1/sync/push` com lote da outbox do aparelho; idempotente pelo UUID gerado no
 *   aparelho; resposta por item: aceito | rejeitado (código RN) | conflito.
 *
 * Aqui ficam tipos, registro e funções puras; o motor (SQLite no app, Postgres na API) usa esta interface.
 */
import { z } from 'zod';
import type { Manifesto } from './manifesto';
import { ehEntidadeDePedido, type ModuloId, type Perfil } from './nomes';
import { ENTIDADE_SYNC_RE } from './nomes';

export const TAMANHO_PAGINA_SYNC = 1000;

/**
 * Limite silencioso do pull (R-20261115-125500-alexandre; ADR 0057 "Limite por usuário"): o motor manda o modo da
 * sincronização pedida pelo usuário neste cabeçalho (`parcial` | `completa`). Ausente, `auto` ou outro valor = automática, sem limite.
 */
export const CABECALHO_MODO_SYNC = 'x-macuxi-sync-modo';

/**
 * Intervalo mínimo (ms), por tenant, usuário, entidade e modo, entre dois INÍCIOS de pull (a constante única do limite).
 * Dentro dele, o servidor responde 200 "nada novo" (`PaginaSync.limitado`). Continuação de uma passada não conta.
 */
export const LIMITES_SYNC = { parcial: 30_000, completa: 300_000 } as const;
export type ModoSyncLimitado = keyof typeof LIMITES_SYNC;

/** Modo do cabeçalho `x-macuxi-sync-modo`; `null` = automática (sem cabeçalho, `auto` ou valor desconhecido). */
export function modoSyncDoCabecalho(valor: unknown): ModoSyncLimitado | null {
  return valor === 'parcial' || valor === 'completa' ? valor : null;
}
export const MAX_ITENS_PUSH = 500;

/**
 * - `servidor_vence`: dado vindo do ERP/BKO (cliente, produto, preço, estoque).
 * - `app_edita_ate_status`: o app edita até um status (ex.: pedido até `recebido`).
 * - `somente_insercao`: respostas de pesquisa, progresso, coletas — nunca conflita.
 */
export type PoliticaConflito = 'servidor_vence' | 'app_edita_ate_status' | 'somente_insercao';
export type DirecaoSync = 'pull' | 'push' | 'ambos';

export interface DefinicaoEntidadeSync<S extends z.ZodTypeAny = z.ZodTypeAny> {
  nome: string;
  modulo: ModuloId;
  direcao: DirecaoSync;
  conflito: PoliticaConflito;
  /**
   * Schema do payload aceito no push. Entidade só de pull (ou sem `schemaLinha`) usa o mesmo para a linha do pull.
   * ADR 0009 §2: em entidade de escrita, o payload (comando) e a linha do servidor têm formatos diferentes.
   */
  schema: S;
  /** Schema Zod da linha do pull (ADR 0009 §2). Os provedores validam a linha em teste; o app tipa a leitura local. */
  schemaLinha?: z.ZodTypeAny;
  /**
   * ADR 0009 §5 (T-0121): espelho, no aparelho, da janela de tempo do provedor (`data >= hoje − 40` etc.). A linha que
   * saiu da janela não é apagada pelo servidor (o cursor já passou por ela): depois do pull da entidade, no máximo uma
   * vez por dia, o motor apaga do aparelho as linhas com `naJanela(linha, hoje) === false` (fora as que estão na fila
   * ou sobrepostas). `hoje` é `AAAA-MM-DD` com FOLGA (`hojeParaPoda`: a data UTC de 24 h atrás, nunca depois do "hoje"
   * de nenhum fuso do Brasil): como a janela só tem limite inferior (adendo do §5), a folga só deixa a linha um dia a
   * mais, nunca apaga o que o servidor ainda manda. Use `diasAntes`/`mesesAntes`; na dúvida (campo ausente, formato
   * desconhecido), devolva `true` — a linha fica. Lançar também mantém a linha.
   */
  naJanela?(linha: Readonly<Record<string, unknown>>, hoje: string): boolean;
  /**
   * ADR 0057 (RN-CORE-61): `diaria` = a entidade vem ao aparelho uma vez por dia (estoque: `deposito`, `estoque_saldo`), na
   * carga diária (`OpcoesMotorSync.cargaDiariaDevida`) e na sincronização `completa`; novidades, push silencioso, a
   * sincronização padrão e a parcial a pulam. Ausente = `continua` (como sempre). Sem `cargaDiariaDevida` no motor, a
   * marca não muda nada.
   */
  cadencia?: CadenciaSync;
  /**
   * ADR 0057 (RN-CORE-23 item 1): a entidade entra na sincronização `parcial` (toque no botão "Sincronizar": pedidos e
   * clientes). Ausente = só nas outras sincronizações.
   */
  parcial?: boolean;
}

/** ADR 0057: de quanto em quanto tempo a entidade vem ao aparelho (`DefinicaoEntidadeSync.cadencia`). */
export type CadenciaSync = 'continua' | 'diaria';

const DATA_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function partesData(data: string): { a: number; m: number; d: number } {
  const r = DATA_ISO_RE.exec(data);
  if (!r) throw new Error(`Data inválida (esperado AAAA-MM-DD): ${data}`);
  return { a: Number(r[1]), m: Number(r[2]), d: Number(r[3]) };
}

/** `AAAA-MM-DD` de um instante, no calendário UTC. */
const dataUtc = (t: Date): string => t.toISOString().slice(0, 10);

/** T-0121: `hoje` da poda local (ADR 0009 §5): a data UTC de 24 h antes de `agora` (folga de fuso; ver `naJanela`). */
export function hojeParaPoda(agora: Date): string {
  return dataUtc(new Date(agora.getTime() - 24 * 60 * 60 * 1000));
}

/** `AAAA-MM-DD` `n` dias antes de `data` (`AAAA-MM-DD`), no calendário (sem fuso). */
export function diasAntes(data: string, n: number): string {
  const { a, m, d } = partesData(data);
  return dataUtc(new Date(Date.UTC(a, m - 1, d - n)));
}

/** `AAAA-MM-DD` `n` meses antes de `data`, com o dia limitado ao fim do mês (31/03 − 1 mês = 28 ou 29/02). */
export function mesesAntes(data: string, n: number): string {
  const { a, m, d } = partesData(data);
  const ultimoDia = new Date(Date.UTC(a, m - 1 - n + 1, 0)).getUTCDate();
  return dataUtc(new Date(Date.UTC(a, m - 1 - n, Math.min(d, ultimoDia))));
}

/**
 * Conjunto que filtra as linhas de um provedor de pull e do qual sai a `versao_escopo` (ADR 0009 §4):
 * - `carteira`: clientes visíveis (`ctx.carteira()`, RN-CORE-04) — títulos, contatos, histórico;
 * - `usuarios`: usuários visíveis (`ctx.usuariosVisiveis()`, RN-CORE-04) — visitas, rotas, metas, pedidos;
 * - `proprio`: só o usuário da sessão (notificações) — sem versão (nunca muda no aparelho);
 * - `tenant`: cadastro do tenant inteiro (produto, motivo) — sem versão.
 */
export const ESCOPOS_SYNC = ['carteira', 'usuarios', 'proprio', 'tenant'] as const;
export type EscopoSync = (typeof ESCOPOS_SYNC)[number];

/**
 * ADR 0009 §7 (D-2): a entidade é de módulo efetivo, mas o servidor ainda não a serve. No pull a API responde
 * 501 com este código e o motor pula a entidade; no push o item volta `rejeitado` com este código e o motor o
 * mantém `pendente` (retentável).
 */
export const SYNC_NAO_IMPLEMENTADO = 'SYNC_NAO_IMPLEMENTADO';

/** Códigos de rejeição de item que NÃO são culpa do item: o motor deixa o item `pendente` e tenta no próximo envio. */
export const CODIGOS_RETENTAVEIS: readonly string[] = [SYNC_NAO_IMPLEMENTADO];

/**
 * Erro de transporte que significa "entidade ainda não disponível no servidor" (ADR 0009 §7): `status` 501 ou
 * `codigo`/`code` `SYNC_NAO_IMPLEMENTADO` (o `HttpError` do app usa `code`). Qualquer outro erro continua erro.
 */
export function ehSyncNaoImplementado(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const x = e as { status?: unknown; codigo?: unknown; code?: unknown };
  return x.status === 501 || x.codigo === SYNC_NAO_IMPLEMENTADO || x.code === SYNC_NAO_IMPLEMENTADO;
}

export function definirEntidadeSync<S extends z.ZodTypeAny>(
  def: DefinicaoEntidadeSync<S>,
): DefinicaoEntidadeSync<S> {
  if (!ENTIDADE_SYNC_RE.test(def.nome)) throw new Error(`Entidade de sync inválida: ${def.nome}`);
  return def;
}

export function criarRegistroSync(manifestos: readonly Manifesto[]) {
  const porId = new Map(manifestos.map((m) => [m.id, m] as const));
  const entidades = new Map<string, DefinicaoEntidadeSync>();
  return {
    registrar(def: DefinicaoEntidadeSync): void {
      const m = porId.get(def.modulo);
      if (!m) throw new Error(`Módulo ${def.modulo} não está instalado`);
      if (!m.sync.includes(def.nome))
        throw new Error(`${def.nome} não está em "sync" do manifesto de ${def.modulo}`);
      const atual = entidades.get(def.nome);
      if (atual) throw new Error(`Entidade de sync ${def.nome} já registrada por ${atual.modulo}`);
      entidades.set(def.nome, def);
    },
    /** Entidades que o aparelho deve puxar/enviar, só de módulos efetivos (RN-CORE-02). */
    entidadesAtivas(modulosAtivos: Iterable<ModuloId>, direcao?: 'pull' | 'push'): DefinicaoEntidadeSync[] {
      const ativos = new Set(modulosAtivos);
      return [...entidades.values()]
        .filter((e) => ativos.has(e.modulo))
        .filter((e) => !direcao || e.direcao === 'ambos' || e.direcao === direcao)
        .sort((a, b) => a.nome.localeCompare(b.nome));
    },
    entidade(nome: string): DefinicaoEntidadeSync | undefined {
      return entidades.get(nome);
    },
    /** Módulo que declara a entidade em `sync` do manifesto, mesmo sem definição registrada (RN-CORE-02 no push). */
    dono(nome: string): ModuloId | undefined {
      return entidades.get(nome)?.modulo ?? manifestos.find((m) => m.sync.includes(nome))?.id;
    },
  };
}

export type RegistroSync = ReturnType<typeof criarRegistroSync>;

// ---------- cursor (updated_at, id) ----------

export interface CursorSync {
  /** Instante UTC ISO 8601. */
  updated_at: string;
  id: string;
}

const SEP = '|';

export function codificarCursor(c: CursorSync): string {
  return `${c.updated_at}${SEP}${c.id}`;
}

export function decodificarCursor(s: string | null | undefined): CursorSync | null {
  if (!s) return null;
  const i = s.indexOf(SEP);
  if (i <= 0 || i === s.length - 1) return null;
  const updated_at = s.slice(0, i);
  if (Number.isNaN(Date.parse(updated_at))) return null;
  return { updated_at, id: s.slice(i + 1) };
}

/** Ordem total do pull: por updated_at e, no empate, por id. */
export function compararCursor(a: CursorSync, b: CursorSync): number {
  const ta = Date.parse(a.updated_at);
  const tb = Date.parse(b.updated_at);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface LinhaSync extends CursorSync {
  deleted_at: string | null;
}

export interface PaginaSync<L> {
  itens: L[];
  proximo_cursor: string | null;
  /**
   * Hash curto do conjunto visível do escopo do provedor (ADR 0009 §4), igual em todas as páginas da mesma
   * requisição. Ausente em escopo `proprio`/`tenant`. Mudou desde a última passada = o motor ressincroniza a entidade.
   */
  versao_escopo?: string;
  /**
   * Horizonte usado nesta página (ISO, relógio do banco; ADR 0006): toda linha visível com `updated_at` abaixo dele
   * e depois do cursor já veio. O motor compara com `ResultadoItemPush.em` para soltar o aceito da sobreposição (D-3).
   */
  horizonte?: string;
  /**
   * Geração da base do tenant (ADR 0021): muda quando a base é recriada ou restaurada. Aditivo: servidor sem a coluna não
   * manda; o motor compara com a guardada (`decidirGeracao`) e, se mudou, reenvia a fila, apaga a cópia local e puxa tudo.
   */
  geracao_base?: string;
  /**
   * R-20261115-125500-alexandre: `true` = o mesmo modo foi pedido há pouco (`LIMITES_SYNC`); a página vem vazia e o motor não
   * muda nada no aparelho (nem cursor, nem cobertura, nem ressincronização) e não mostra erro. Só vem a quem mandou o modo.
   */
  limitado?: true;
}

/** Página após o cursor (inclui removidos). Usado no motor em memória e como referência do SQL. */
export function paginar<L extends LinhaSync>(
  linhas: readonly L[],
  cursor: string | null,
  limite = TAMANHO_PAGINA_SYNC,
): PaginaSync<L> {
  const desde = decodificarCursor(cursor);
  const ordenadas = [...linhas].sort(compararCursor);
  const depois = desde ? ordenadas.filter((l) => compararCursor(l, desde) > 0) : ordenadas;
  const itens = depois.slice(0, limite);
  const ultimo = itens[itens.length - 1];
  return { itens, proximo_cursor: depois.length > limite && ultimo ? codificarCursor(ultimo) : null };
}

// ---------- push ----------

/** Texto do item retido por `SYNC_NAO_IMPLEMENTADO` (fila do app e resposta da API). */
export const MENSAGEM_ENVIO_INDISPONIVEL =
  'Envio ainda não disponível no servidor; fica na fila e vai sozinho quando estiver.';

const Uuid = z.string().uuid('id precisa ser UUID gerado no aparelho');

export const ItemPushSchema = z.object({
  entidade: z.string().regex(ENTIDADE_SYNC_RE),
  /** UUID gerado no aparelho; também é a chave de idempotência. */
  id: Uuid,
  operacao: z.enum(['upsert', 'remover']).default('upsert'),
  payload: z.unknown(),
});
export type ItemPush = z.infer<typeof ItemPushSchema>;

export const PushRequestSchema = z.object({ itens: z.array(ItemPushSchema).min(1).max(MAX_ITENS_PUSH) });
export type PushRequest = z.infer<typeof PushRequestSchema>;

export type ResultadoItemPush =
  /**
   * `em` (ISO, relógio do BANCO, lido depois de gravar): o aparelho mantém o item sobreposto até um pull com
   * `PaginaSync.horizonte` posterior a ele (D-3, ADR 0009 §3). Opcional: sem ele, o motor usa o relógio do aparelho.
   */
  | { id: string; status: 'aceito'; em?: string }
  | { id: string; status: 'rejeitado'; codigo: string; mensagem: string }
  | { id: string; status: 'conflito'; mensagem: string; atual?: unknown };

/** Início do texto de `PAYLOAD_INVALIDO`; os motivos (em português, sem nome de campo) vêm depois dos dois-pontos. */
export const MENSAGEM_PAYLOAD_INVALIDO = 'O servidor não aceitou os dados deste registro';
/** Quantos motivos diferentes, no máximo, vão no texto (o resto só alonga a frase na tela). */
const MAX_MOTIVOS_PAYLOAD = 3;

/** Motivo em português para um problema do Zod sem mensagem própria do contrato (o padrão do Zod é inglês). */
function motivoEmPortugues(issue: z.ZodIssueOptionalMessage): string {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return 'falta um dado obrigatório';
      if (issue.expected === 'integer') return 'há um número que precisa ser inteiro';
      return 'há um dado no formato errado';
    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_union_discriminator:
      return 'há uma opção que não é aceita';
    case z.ZodIssueCode.unrecognized_keys:
      return 'há dados que o servidor não reconhece';
    case z.ZodIssueCode.invalid_date:
      return 'há uma data inválida';
    case z.ZodIssueCode.invalid_string:
      return 'há um texto no formato errado';
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return 'há um texto vazio ou curto demais';
      if (issue.type === 'array' || issue.type === 'set') return 'há uma lista com menos itens que o mínimo';
      if (issue.type === 'date') return 'há uma data antes do permitido';
      return 'há um número abaixo do mínimo';
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return 'há um texto longo demais';
      if (issue.type === 'array' || issue.type === 'set') return 'há uma lista com mais itens que o máximo';
      if (issue.type === 'date') return 'há uma data depois do permitido';
      return 'há um número acima do máximo';
    case z.ZodIssueCode.not_multiple_of:
    case z.ZodIssueCode.not_finite:
      return 'há um número inválido';
    default:
      return 'há um dado inválido';
  }
}

/**
 * Mapa de erros do push: troca o texto padrão do Zod (inglês) pelo motivo em português e mantém a mensagem que o contrato deu
 * (`refine(fn, 'texto')`, `.min(1, 'texto')`, `required_error`…), que já é frase em português.
 */
export const mapaDeErrosEmPortugues: z.ZodErrorMap = (issue, ctx) => {
  const padraoDoZod = z.defaultErrorMap(issue, { data: ctx.data, defaultError: '' }).message;
  return { message: ctx.defaultError !== padraoDoZod ? ctx.defaultError : motivoEmPortugues(issue) };
};

/** Frase de `PAYLOAD_INVALIDO` para a tela: português, sem código nem nome de campo, sem repetir motivo. */
export function mensagemPayloadInvalido(issues: readonly z.ZodIssue[]): string {
  const motivos = [...new Set(issues.map((i) => i.message.trim().replace(/\.+$/, '')).filter((m) => m !== ''))];
  if (motivos.length === 0) return `${MENSAGEM_PAYLOAD_INVALIDO}.`;
  const resto = motivos.length - MAX_MOTIVOS_PAYLOAD;
  const lista = motivos.slice(0, MAX_MOTIVOS_PAYLOAD).join('; ') + (resto > 0 ? ` e mais ${resto}` : '');
  return `${MENSAGEM_PAYLOAD_INVALIDO}: ${lista}.`;
}

/**
 * Item rejeitado com código, nunca descartado em silêncio. Ordem (desenho T-0004 §5; D-1 da T-0003):
 *  1. dono da entidade (pelo `sync` do manifesto) inativo → `MODULO_INATIVO` (RN-CORE-02; o app guarda o item e o
 *     reenvia quando o módulo volta), mesmo que a entidade ainda não tenha definição/provedor;
 *  2. promotor enviando entidade de pedido → `RN-PRO-01`;
 *  3. só de pull, ou fora de todos os manifestos → `ENTIDADE_DESCONHECIDA`;
 *  4. do manifesto de módulo ativo mas sem definição/provedor → `SYNC_NAO_IMPLEMENTADO` (retentável, ADR 0009 §7);
 *  5. payload fora do schema → `PAYLOAD_INVALIDO`.
 */
export function rejeitarItensInvalidos(
  req: PushRequest,
  registro: RegistroSync,
  modulosAtivos: Iterable<ModuloId>,
  opcoes: { perfil?: Perfil } = {},
): { validos: ItemPush[]; rejeitados: ResultadoItemPush[] } {
  const ativos = new Set(modulosAtivos);
  const validos: ItemPush[] = [];
  const rejeitados: ResultadoItemPush[] = [];
  const rejeitar = (item: ItemPush, codigo: string, mensagem: string) =>
    rejeitados.push({ id: item.id, status: 'rejeitado', codigo, mensagem });
  for (const item of req.itens) {
    const dono = registro.dono(item.entidade);
    const def = registro.entidade(item.entidade);
    if (dono && !ativos.has(dono)) rejeitar(item, 'MODULO_INATIVO', `Módulo ${dono} inativo`);
    else if (opcoes.perfil === 'promotor' && ehEntidadeDePedido(item.entidade))
      rejeitar(item, 'RN-PRO-01', 'Promotor não cria nem altera pedido.');
    else if (!def && dono) rejeitar(item, SYNC_NAO_IMPLEMENTADO, MENSAGEM_ENVIO_INDISPONIVEL);
    else if (!def || def.direcao === 'pull')
      rejeitar(item, 'ENTIDADE_DESCONHECIDA', `Entidade ${item.entidade} não aceita push`);
    else {
      const p = def.schema.safeParse(item.payload, { errorMap: mapaDeErrosEmPortugues });
      if (p.success) validos.push({ ...item, payload: p.data });
      else rejeitar(item, 'PAYLOAD_INVALIDO', mensagemPayloadInvalido(p.error.issues));
    }
  }
  return { validos, rejeitados };
}
