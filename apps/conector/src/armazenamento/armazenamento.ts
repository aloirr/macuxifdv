/**
 * Armazenamento local (node:sqlite, arquivo em disco): fila de lotes, cursores por entidade, erros por linha e
 * fila de retorno de pedidos. Sobrevive a queda de rede, reinício do serviço e queda de energia (WAL + synchronous FULL).
 * Nenhum dado pessoal fica depois que o lote termina: o envelope é apagado ao concluir.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Cursor } from '@macuxi/integracao/contracts';
import { abrirSqlite, type BancoSqlite } from '../util/sqlite';

export type EstadoLoteLocal = 'pendente' | 'aguardando' | 'concluido' | 'concluido_com_erros' | 'recusado' | 'falhou' | 'substituido';
export type Fase = 'completo' | 'delta';

export interface EstadoEntidade {
  entidade: string;
  fase: Fase;
  geracao: number;
  lido: Cursor | null;
  confirmado: Cursor | null;
  sessaoId: string | null;
  sessaoParte: number;
  cargaIniciadaMs: number | null;
  bloqueio: string | null;
  aviso: string | null;
  ultimaExecucaoMs: number | null;
  ultimoSucessoMs: number | null;
  ultimoErroMs: number | null;
  ultimoErro: string | null;
}

export interface LoteLocal {
  id: number;
  entidade: string;
  geracao: number;
  modo: 'completo' | 'delta';
  chave: string;
  envelope: string;
  linhas: number;
  bytes: number;
  cursor: Cursor | null;
  sessaoId: string | null;
  parte: number | null;
  ultimo: boolean;
  estado: EstadoLoteLocal;
  tentativas: number;
  proximaMs: number;
  loteId: string | null;
  erro: string | null;
  reenvios: number;
  confirmado: boolean;
  criadoMs: number;
}

export interface NovoLote {
  entidade: string;
  geracao: number;
  modo: 'completo' | 'delta';
  chave: string;
  envelope: string;
  linhas: number;
  bytes: number;
  cursor: Cursor | null;
  sessaoId: string | null;
  parte: number | null;
  ultimo: boolean;
  reenvios?: number;
  /** Reenvio de linhas: não mexe no cursor. */
  semCursor?: boolean;
}

export interface ErroLinhaLocal {
  entidade: string;
  origem: 'local' | 'hub';
  loteChave: string | null;
  indice: number | null;
  externalId: string | null;
  codigo: string;
  campo: string | null;
  mensagem: string;
  reprocessavel: boolean;
  criadoMs: number;
}

export interface PedidoLocal {
  pedidoUuid: string;
  estado: string;
  payload: string;
  tentativas: number;
  numeroErp: string | null;
  final: boolean;
  recebidoMs: number;
  proximaMs: number;
  erro: string | null;
}

export interface RetornoLocal {
  id: number;
  pedidoUuid: string;
  assinatura: string;
  corpo: string;
  estado: 'pendente' | 'enviado' | 'recusado';
  tentativas: number;
  proximaMs: number;
  erro: string | null;
}

type Linha = Record<string, unknown>;
const SQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entidade_estado(
  entidade TEXT PRIMARY KEY, fase TEXT NOT NULL, geracao INTEGER NOT NULL DEFAULT 1,
  lido_em TEXT, lido_id TEXT, confirmado_em TEXT, confirmado_id TEXT,
  sessao_id TEXT, sessao_parte INTEGER NOT NULL DEFAULT 0, carga_iniciada_ms INTEGER,
  bloqueio TEXT, aviso TEXT, ultima_execucao_ms INTEGER, ultimo_sucesso_ms INTEGER, ultimo_erro_ms INTEGER, ultimo_erro TEXT
);
CREATE TABLE IF NOT EXISTS lote(
  id INTEGER PRIMARY KEY AUTOINCREMENT, entidade TEXT NOT NULL, geracao INTEGER NOT NULL, modo TEXT NOT NULL,
  chave TEXT NOT NULL UNIQUE, envelope TEXT NOT NULL, linhas INTEGER NOT NULL, bytes INTEGER NOT NULL,
  cursor_em TEXT, cursor_id TEXT, sessao_id TEXT, parte INTEGER, ultimo INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL, tentativas INTEGER NOT NULL DEFAULT 0, proxima_ms INTEGER NOT NULL DEFAULT 0,
  lote_id TEXT, erro TEXT, reenvios INTEGER NOT NULL DEFAULT 0, confirmado INTEGER NOT NULL DEFAULT 0,
  criado_ms INTEGER NOT NULL, atualizado_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lote_estado ON lote(estado, proxima_ms);
CREATE INDEX IF NOT EXISTS ix_lote_entidade ON lote(entidade, geracao, id);
CREATE TABLE IF NOT EXISTS erro_linha(
  id INTEGER PRIMARY KEY AUTOINCREMENT, entidade TEXT NOT NULL, origem TEXT NOT NULL, lote_chave TEXT, indice INTEGER,
  external_id TEXT, codigo TEXT NOT NULL, campo TEXT, mensagem TEXT NOT NULL, reprocessavel INTEGER NOT NULL DEFAULT 0, criado_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_erro_entidade ON erro_linha(entidade, criado_ms);
CREATE TABLE IF NOT EXISTS pedido(
  pedido_uuid TEXT PRIMARY KEY, estado TEXT NOT NULL, payload TEXT NOT NULL, tentativas INTEGER NOT NULL DEFAULT 0,
  numero_erp TEXT, final INTEGER NOT NULL DEFAULT 0, recebido_ms INTEGER NOT NULL, proxima_ms INTEGER NOT NULL DEFAULT 0,
  erro TEXT, atualizado_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS retorno(
  id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_uuid TEXT NOT NULL, assinatura TEXT NOT NULL, corpo TEXT NOT NULL,
  estado TEXT NOT NULL, tentativas INTEGER NOT NULL DEFAULT 0, proxima_ms INTEGER NOT NULL DEFAULT 0, erro TEXT,
  criado_ms INTEGER NOT NULL, UNIQUE(pedido_uuid, assinatura)
);
`;

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const par = (em: unknown, id: unknown): Cursor | null => (em === null || em === undefined || id === null || id === undefined ? null : { alterado_em: String(em), external_id: String(id) });

export class Armazenamento {
  private constructor(private readonly db: BancoSqlite) {
    db.exec(SQL_SCHEMA);
  }

  static abrir(caminho: string): Armazenamento {
    if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
    return new Armazenamento(abrirSqlite(caminho));
  }

  fechar(): void {
    this.db.close();
  }

  private profundidade = 0;

  /** Executa `fn` numa transação (BEGIN IMMEDIATE); desfaz se lançar. Aninhada, junta-se à transação externa. */
  transacao<T>(fn: () => T): T {
    if (this.profundidade > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.profundidade++;
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.profundidade--;
    }
  }

  private all(sql: string, ...p: unknown[]): Linha[] {
    return this.db.prepare(sql).all(...(p as never[])) as Linha[];
  }
  private one(sql: string, ...p: unknown[]): Linha | undefined {
    return this.db.prepare(sql).get(...(p as never[])) as Linha | undefined;
  }
  private run(sql: string, ...p: unknown[]): number {
    return Number(this.db.prepare(sql).run(...(p as never[])).changes);
  }

  // ---------- meta ----------
  meta(chave: string): string | null {
    return s(this.one('SELECT valor FROM meta WHERE chave = ?', chave)?.valor);
  }
  definirMeta(chave: string, valor: string): void {
    this.run('INSERT INTO meta(chave, valor) VALUES(?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', chave, valor);
  }

  // ---------- estado por entidade ----------
  private paraEstado(r: Linha): EstadoEntidade {
    return {
      entidade: String(r.entidade),
      fase: r.fase as Fase,
      geracao: Number(r.geracao),
      lido: par(r.lido_em, r.lido_id),
      confirmado: par(r.confirmado_em, r.confirmado_id),
      sessaoId: s(r.sessao_id),
      sessaoParte: Number(r.sessao_parte),
      cargaIniciadaMs: n(r.carga_iniciada_ms),
      bloqueio: s(r.bloqueio),
      aviso: s(r.aviso),
      ultimaExecucaoMs: n(r.ultima_execucao_ms),
      ultimoSucessoMs: n(r.ultimo_sucesso_ms),
      ultimoErroMs: n(r.ultimo_erro_ms),
      ultimoErro: s(r.ultimo_erro),
    };
  }

  estado(entidade: string): EstadoEntidade | null {
    const r = this.one('SELECT * FROM entidade_estado WHERE entidade = ?', entidade);
    return r ? this.paraEstado(r) : null;
  }

  estados(): EstadoEntidade[] {
    return this.all('SELECT * FROM entidade_estado ORDER BY entidade').map((r) => this.paraEstado(r));
  }

  /** Cria (ou reinicia, com nova geração) o estado da entidade. */
  iniciarEstado(entidade: string, fase: Fase, opcoes: { cursor?: Cursor | null; sessaoId?: string | null; agoraMs: number }): EstadoEntidade {
    const atual = this.estado(entidade);
    const geracao = (atual?.geracao ?? 0) + 1;
    const c = opcoes.cursor ?? null;
    this.run(
      `INSERT INTO entidade_estado(entidade, fase, geracao, lido_em, lido_id, confirmado_em, confirmado_id, sessao_id, sessao_parte, carga_iniciada_ms)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(entidade) DO UPDATE SET fase = excluded.fase, geracao = excluded.geracao, lido_em = excluded.lido_em, lido_id = excluded.lido_id,
         confirmado_em = excluded.confirmado_em, confirmado_id = excluded.confirmado_id, sessao_id = excluded.sessao_id, sessao_parte = 0,
         carga_iniciada_ms = excluded.carga_iniciada_ms, bloqueio = NULL, aviso = NULL`,
      entidade, fase, geracao, c?.alterado_em ?? null, c?.external_id ?? null, c?.alterado_em ?? null, c?.external_id ?? null,
      opcoes.sessaoId ?? null, fase === 'completo' ? opcoes.agoraMs : null,
    );
    return this.estado(entidade) as EstadoEntidade;
  }

  /** Marca as colunas informadas; `undefined` mantém. */
  atualizarEstado(entidade: string, p: Partial<{ fase: Fase; lido: Cursor | null; confirmado: Cursor | null; sessaoId: string | null; sessaoParte: number; cargaIniciadaMs: number | null; bloqueio: string | null; aviso: string | null; ultimaExecucaoMs: number; ultimoSucessoMs: number; ultimoErroMs: number | null; ultimoErro: string | null }>): void {
    const cols: string[] = [];
    const vals: unknown[] = [];
    const add = (c: string, v: unknown) => (cols.push(`${c} = ?`), vals.push(v));
    if (p.fase !== undefined) add('fase', p.fase);
    if (p.lido !== undefined) {
      add('lido_em', p.lido?.alterado_em ?? null);
      add('lido_id', p.lido?.external_id ?? null);
    }
    if (p.confirmado !== undefined) {
      add('confirmado_em', p.confirmado?.alterado_em ?? null);
      add('confirmado_id', p.confirmado?.external_id ?? null);
    }
    if (p.sessaoId !== undefined) add('sessao_id', p.sessaoId);
    if (p.sessaoParte !== undefined) add('sessao_parte', p.sessaoParte);
    if (p.cargaIniciadaMs !== undefined) add('carga_iniciada_ms', p.cargaIniciadaMs);
    if (p.bloqueio !== undefined) add('bloqueio', p.bloqueio);
    if (p.aviso !== undefined) add('aviso', p.aviso);
    if (p.ultimaExecucaoMs !== undefined) add('ultima_execucao_ms', p.ultimaExecucaoMs);
    if (p.ultimoSucessoMs !== undefined) add('ultimo_sucesso_ms', p.ultimoSucessoMs);
    if (p.ultimoErroMs !== undefined) add('ultimo_erro_ms', p.ultimoErroMs);
    if (p.ultimoErro !== undefined) add('ultimo_erro', p.ultimoErro);
    if (cols.length === 0) return;
    this.run(`UPDATE entidade_estado SET ${cols.join(', ')} WHERE entidade = ?`, ...vals, entidade);
  }

  // ---------- lotes ----------
  private paraLote(r: Linha): LoteLocal {
    return {
      id: Number(r.id), entidade: String(r.entidade), geracao: Number(r.geracao), modo: r.modo as 'completo' | 'delta',
      chave: String(r.chave), envelope: String(r.envelope), linhas: Number(r.linhas), bytes: Number(r.bytes),
      cursor: par(r.cursor_em, r.cursor_id), sessaoId: s(r.sessao_id), parte: n(r.parte), ultimo: Number(r.ultimo) === 1,
      estado: r.estado as EstadoLoteLocal, tentativas: Number(r.tentativas), proximaMs: Number(r.proxima_ms), loteId: s(r.lote_id),
      erro: s(r.erro), reenvios: Number(r.reenvios), confirmado: Number(r.confirmado) === 1, criadoMs: Number(r.criado_ms),
    };
  }

  /** Enfileira (idempotente pela chave). Devolve `true` se entrou. */
  enfileirar(l: NovoLote, agoraMs: number): boolean {
    return (
      this.run(
        `INSERT OR IGNORE INTO lote(entidade, geracao, modo, chave, envelope, linhas, bytes, cursor_em, cursor_id, sessao_id, parte, ultimo, estado, reenvios, confirmado, criado_ms, atualizado_ms)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?)`,
        l.entidade, l.geracao, l.modo, l.chave, l.envelope, l.linhas, l.bytes, l.cursor?.alterado_em ?? null, l.cursor?.external_id ?? null,
        l.sessaoId, l.parte, l.ultimo ? 1 : 0, l.reenvios ?? 0, l.semCursor ? 1 : 0, agoraMs, agoraMs,
      ) > 0
    );
  }

  lote(id: number): LoteLocal | null {
    const r = this.one('SELECT * FROM lote WHERE id = ?', id);
    return r ? this.paraLote(r) : null;
  }

  lotesDaEntidade(entidade: string, estados?: EstadoLoteLocal[]): LoteLocal[] {
    const f = estados?.length ? ` AND estado IN (${estados.map(() => '?').join(',')})` : '';
    return this.all(`SELECT * FROM lote WHERE entidade = ?${f} ORDER BY id`, entidade, ...(estados ?? [])).map((r) => this.paraLote(r));
  }

  /** Lotes prontos para uma ação agora, na ordem da fila (id). */
  lotesProntos(estado: 'pendente' | 'aguardando', agoraMs: number): LoteLocal[] {
    return this.all('SELECT * FROM lote WHERE estado = ? AND proxima_ms <= ? ORDER BY id', estado, agoraMs).map((r) => this.paraLote(r));
  }

  contarLotes(entidade: string, estados: EstadoLoteLocal[]): number {
    return Number(this.one(`SELECT COUNT(*) AS c FROM lote WHERE entidade = ? AND estado IN (${estados.map(() => '?').join(',')})`, entidade, ...estados)?.c ?? 0);
  }

  atualizarLote(id: number, p: Partial<{ estado: EstadoLoteLocal; tentativas: number; proximaMs: number; loteId: string | null; erro: string | null; chave: string; envelope: string }>, agoraMs: number): void {
    const cols = ['atualizado_ms = ?'];
    const vals: unknown[] = [agoraMs];
    const add = (c: string, v: unknown) => (cols.push(`${c} = ?`), vals.push(v));
    if (p.estado !== undefined) add('estado', p.estado);
    if (p.tentativas !== undefined) add('tentativas', p.tentativas);
    if (p.proximaMs !== undefined) add('proxima_ms', p.proximaMs);
    if (p.loteId !== undefined) add('lote_id', p.loteId);
    if (p.erro !== undefined) add('erro', p.erro);
    if (p.chave !== undefined) add('chave', p.chave);
    if (p.envelope !== undefined) add('envelope', p.envelope);
    this.run(`UPDATE lote SET ${cols.join(', ')} WHERE id = ?`, ...vals, id);
  }

  /** Apaga o conteúdo (dado pessoal) de um lote que terminou. */
  esvaziarLote(id: number): void {
    this.run("UPDATE lote SET envelope = '' WHERE id = ?", id);
  }

  marcarConfirmado(id: number): void {
    this.run('UPDATE lote SET confirmado = 1 WHERE id = ?', id);
  }

  /** Lotes da geração atual ainda não confirmados no cursor, em ordem. */
  naoConfirmados(entidade: string, geracao: number): LoteLocal[] {
    return this.all('SELECT * FROM lote WHERE entidade = ? AND geracao = ? AND confirmado = 0 ORDER BY id', entidade, geracao).map((r) => this.paraLote(r));
  }

  /** Descarta da fila o que está parado (recusado/falhou/pendente) — usado em `retomar`. */
  substituirLotesAbertos(entidade: string, agoraMs: number): number {
    return this.run(
      "UPDATE lote SET estado = 'substituido', envelope = '', atualizado_ms = ? WHERE entidade = ? AND estado IN ('pendente','aguardando','recusado','falhou')",
      agoraMs, entidade,
    );
  }

  // ---------- erros por linha ----------
  registrarErros(erros: Omit<ErroLinhaLocal, 'criadoMs'>[], agoraMs: number): void {
    if (erros.length === 0) return;
    this.transacao(() => {
      const st = this.db.prepare(
        'INSERT INTO erro_linha(entidade, origem, lote_chave, indice, external_id, codigo, campo, mensagem, reprocessavel, criado_ms) VALUES(?,?,?,?,?,?,?,?,?,?)',
      );
      for (const e of erros) st.run(e.entidade, e.origem, e.loteChave, e.indice, e.externalId, e.codigo, e.campo, e.mensagem, e.reprocessavel ? 1 : 0, agoraMs);
    });
  }

  errosRecentes(entidade: string | null, limite = 20): ErroLinhaLocal[] {
    const rs = entidade
      ? this.all('SELECT * FROM erro_linha WHERE entidade = ? ORDER BY id DESC LIMIT ?', entidade, limite)
      : this.all('SELECT * FROM erro_linha ORDER BY id DESC LIMIT ?', limite);
    return rs.map((r) => ({
      entidade: String(r.entidade), origem: r.origem as 'local' | 'hub', loteChave: s(r.lote_chave), indice: n(r.indice), externalId: s(r.external_id),
      codigo: String(r.codigo), campo: s(r.campo), mensagem: String(r.mensagem), reprocessavel: Number(r.reprocessavel) === 1, criadoMs: Number(r.criado_ms),
    }));
  }

  contarErros(): { entidade: string; origem: string; total: number }[] {
    return this.all('SELECT entidade, origem, COUNT(*) AS total FROM erro_linha GROUP BY entidade, origem ORDER BY entidade').map((r) => ({
      entidade: String(r.entidade), origem: String(r.origem), total: Number(r.total),
    }));
  }

  // ---------- pedidos ----------
  private paraPedido(r: Linha): PedidoLocal {
    return {
      pedidoUuid: String(r.pedido_uuid), estado: String(r.estado), payload: String(r.payload), tentativas: Number(r.tentativas),
      numeroErp: s(r.numero_erp), final: Number(r.final) === 1, recebidoMs: Number(r.recebido_ms), proximaMs: Number(r.proxima_ms), erro: s(r.erro),
    };
  }
  pedido(uuid: string): PedidoLocal | null {
    const r = this.one('SELECT * FROM pedido WHERE pedido_uuid = ?', uuid);
    return r ? this.paraPedido(r) : null;
  }
  /** Guarda o pedido recebido do Hub antes de gravar no ERP. `true` se é novo. */
  registrarPedido(uuid: string, payload: string, agoraMs: number): boolean {
    return this.run("INSERT OR IGNORE INTO pedido(pedido_uuid, estado, payload, recebido_ms, atualizado_ms) VALUES(?, 'recebido', ?, ?, ?)", uuid, payload, agoraMs, agoraMs) > 0;
  }
  atualizarPedido(uuid: string, p: Partial<{ estado: string; tentativas: number; numeroErp: string | null; final: boolean; proximaMs: number; erro: string | null; payload: string }>, agoraMs: number): void {
    const cols = ['atualizado_ms = ?'];
    const vals: unknown[] = [agoraMs];
    const add = (c: string, v: unknown) => (cols.push(`${c} = ?`), vals.push(v));
    if (p.estado !== undefined) add('estado', p.estado);
    if (p.tentativas !== undefined) add('tentativas', p.tentativas);
    if (p.numeroErp !== undefined) add('numero_erp', p.numeroErp);
    if (p.final !== undefined) add('final', p.final ? 1 : 0);
    if (p.proximaMs !== undefined) add('proxima_ms', p.proximaMs);
    if (p.erro !== undefined) add('erro', p.erro);
    if (p.payload !== undefined) add('payload', p.payload);
    this.run(`UPDATE pedido SET ${cols.join(', ')} WHERE pedido_uuid = ?`, ...vals, uuid);
  }
  pedidosPorEstado(estados: string[], agoraMs: number): PedidoLocal[] {
    return this.all(`SELECT * FROM pedido WHERE final = 0 AND estado IN (${estados.map(() => '?').join(',')}) AND proxima_ms <= ? ORDER BY recebido_ms`, ...estados, agoraMs).map((r) => this.paraPedido(r));
  }
  contarPedidos(): { estado: string; total: number }[] {
    return this.all('SELECT estado, COUNT(*) AS total FROM pedido GROUP BY estado ORDER BY estado').map((r) => ({ estado: String(r.estado), total: Number(r.total) }));
  }

  // ---------- retornos (fila de POST /pedidos/{uuid}/retorno) ----------
  /** Enfileira um retorno; a assinatura evita duplicar o mesmo fato. `true` se é novo. */
  enfileirarRetorno(uuid: string, assinatura: string, corpo: string, agoraMs: number): boolean {
    return this.run("INSERT OR IGNORE INTO retorno(pedido_uuid, assinatura, corpo, estado, criado_ms) VALUES(?,?,?, 'pendente', ?)", uuid, assinatura, corpo, agoraMs) > 0;
  }
  retornoExiste(uuid: string, assinatura: string): boolean {
    return this.one('SELECT 1 AS x FROM retorno WHERE pedido_uuid = ? AND assinatura = ?', uuid, assinatura) !== undefined;
  }
  retornosProntos(agoraMs: number): RetornoLocal[] {
    return this.all("SELECT * FROM retorno WHERE estado = 'pendente' AND proxima_ms <= ? ORDER BY id", agoraMs).map((r) => ({
      id: Number(r.id), pedidoUuid: String(r.pedido_uuid), assinatura: String(r.assinatura), corpo: String(r.corpo), estado: r.estado as RetornoLocal['estado'],
      tentativas: Number(r.tentativas), proximaMs: Number(r.proxima_ms), erro: s(r.erro),
    }));
  }
  atualizarRetorno(id: number, p: Partial<{ estado: RetornoLocal['estado']; tentativas: number; proximaMs: number; erro: string | null }>): void {
    const cols: string[] = [];
    const vals: unknown[] = [];
    const add = (c: string, v: unknown) => (cols.push(`${c} = ?`), vals.push(v));
    if (p.estado !== undefined) add('estado', p.estado);
    if (p.tentativas !== undefined) add('tentativas', p.tentativas);
    if (p.proximaMs !== undefined) add('proxima_ms', p.proximaMs);
    if (p.erro !== undefined) add('erro', p.erro);
    if (cols.length) this.run(`UPDATE retorno SET ${cols.join(', ')} WHERE id = ?`, ...vals, id);
  }
  contarRetornos(): { estado: string; total: number }[] {
    return this.all('SELECT estado, COUNT(*) AS total FROM retorno GROUP BY estado ORDER BY estado').map((r) => ({ estado: String(r.estado), total: Number(r.total) }));
  }

  // ---------- manutenção e status ----------
  /** Apaga lotes terminados e erros antigos (o log local não guarda dado por mais que a retenção). */
  limpar(agoraMs: number, retencaoDias: number): void {
    const limite = agoraMs - retencaoDias * 86_400_000;
    this.run("DELETE FROM lote WHERE estado IN ('concluido','concluido_com_erros','substituido') AND confirmado = 1 AND atualizado_ms < ?", limite);
    this.run('DELETE FROM erro_linha WHERE criado_ms < ?', limite);
    this.run("DELETE FROM retorno WHERE estado = 'enviado' AND criado_ms < ?", limite);
    this.run('DELETE FROM pedido WHERE final = 1 AND atualizado_ms < ?', limite);
  }

  resumoFila(): { estado: string; total: number; linhas: number; maisAntigoMs: number | null }[] {
    return this.all('SELECT estado, COUNT(*) AS total, COALESCE(SUM(linhas),0) AS linhas, MIN(criado_ms) AS antigo FROM lote GROUP BY estado ORDER BY estado').map((r) => ({
      estado: String(r.estado), total: Number(r.total), linhas: Number(r.linhas), maisAntigoMs: n(r.antigo),
    }));
  }
}
