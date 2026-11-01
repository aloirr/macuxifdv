/**
 * Hub falso para os testes: servidor `node:http` em porta efêmera que implementa as rotas de
 * `/integracao/v1` com os schemas de `@macuxi/integracao/contracts` (envelope, registros por linha, retorno de pedido).
 * É uma simulação mínima (sem staging real): serve para exercitar o contrato do lado do Conector.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  API_PREFIX_INTEGRACAO,
  ENTIDADES,
  LIMITE_REGISTROS_LOTE,
  LoteEnvelope,
  PedidoParaErp,
  RetornoErp,
  SCHEMA_REGISTRO,
  type Cursor,
  type Entidade,
  type LinhaErro,
} from '@macuxi/integracao/contracts';
import { compararCursor } from '../../src/mapeamento';
import { compararVersoes, lerSemver } from '../../src/versao';

interface LoteGuardado {
  id: string;
  chave: string;
  envelope: LoteEnvelope;
  status: 'concluido' | 'concluido_com_erros' | 'falhou';
  erros: LinhaErro[];
  cursor: Cursor | null;
  contagens: { recebidas: number; com_erro: number; novas: number; atualizadas: number; inalteradas: number };
  consultasAntes: number;
  invalidasOmitidas: number;
  inativacao?: { situacao: 'aplicada' | 'aguardando_confirmacao' | 'nao_aplicavel'; candidatos?: number };
}

export interface Chamada {
  metodo: string;
  caminho: string;
  idempotencia?: string;
  /** Cabeçalhos do Conector (T-0023). */
  conectorId?: string;
  versao?: string;
}

const CODIGO_ZOD: Record<string, LinhaErro['codigo']> = {
  invalid_type: 'tipo_invalido',
  invalid_string: 'formato_invalido',
  invalid_enum_value: 'valor_nao_permitido',
  too_small: 'valor_fora_da_faixa',
  too_big: 'valor_fora_da_faixa',
  custom: 'regra_invalida',
};

export class HubFalso {
  readonly token = 'token-de-teste-123456';
  url = '';
  private servidor!: Server;
  readonly lotes = new Map<string, LoteGuardado>();
  private readonly porChave = new Map<string, string>();
  /** Cada POST /lotes que chegou ao processamento (não conta repetição por chave). */
  readonly envelopes: LoteEnvelope[] = [];
  readonly chamadas: Chamada[] = [];
  readonly cursores = new Map<string, Cursor>();
  readonly registros = new Map<string, Map<string, Record<string, unknown>>>();
  pedidosParaEntregar: PedidoParaErp[] = [];
  readonly retornos: unknown[] = [];
  readonly sinais: unknown[] = [];
  readonly reconciliacoes: unknown[] = [];
  /** As próximas N requisições respondem `status` (ex.: 503). */
  falhas: { restantes: number; status: number; retryAfter?: number } = { restantes: 0, status: 503 };
  /** Derruba a conexão sem responder (rede caiu). */
  caido = false;
  /** Quantas consultas de resultado respondem "processando" antes de concluir. */
  consultasProcessando = 0;
  /** Linhas (por external_id) que falham 1 vez com `falha_processamento`. */
  falhaTransitoria = new Set<string>();
  /** Recusa o envelope do próximo POST /lotes com este código. */
  recusarProximoEnvelope: { codigo: string; mensagem: string; status?: number } | null = null;
  /** Recusa o próximo POST de retorno de pedido (ex.: transição inválida, RN-INT-08). */
  recusarProximoRetorno: { codigo: string; mensagem: string } | null = null;
  /** Situação da inativação devolvida no último lote da sessão completa. */
  inativacaoNaSessaoCompleta: LoteGuardado['inativacao'] | undefined;
  /** Hub já tem cursor (Conector reinstalado): devolvido em GET /cursores. */
  tokenValido = true;
  /** Identificador do Conector que o Hub aceita (cabeçalho `X-Macuxi-Conector-Id`); `null` = não confere. */
  conectorIdEsperado: string | null = 'cnx-teste-01';
  /** Política de versão devolvida na resposta do sinal (`null` = Hub sem política). */
  politicaVersao: { versao_minima: string; versao_recomendada: string; mensagem?: string } | null = null;
  /** Chaves aceitas além de `token` (rotação: a antiga e a nova valem juntas na janela). */
  chavesExtras = new Set<string>();
  /**
   * T-0027: o Hub responde 426 `versao_conector_nao_suportada` nas rotas de dados para Conector abaixo desta versão (o sinal
   * passa). `informarMinima: false` simula um 426 sem `detalhes`.
   */
  exigirVersao: { minima: string; informarMinima?: boolean } | null = null;
  /**
   * T-0027: simula a inativação da carga completa como o domain do Hub (RN-INT-06): ao fechar a sessão, inativa os registros da
   * entidade que não vieram NEM como aceitos NEM como inválidos; linha sem id ou omitida impede a inativação.
   */
  simularInativacao = false;
  readonly inativados = new Map<string, Set<string>>();
  private readonly sessoes = new Map<string, { vistos: Set<string>; semId: number; falhou: boolean }>();

  static async iniciar(): Promise<HubFalso> {
    const h = new HubFalso();
    h.servidor = createServer((req, res) => void h.tratar(req, res));
    await new Promise<void>((ok) => h.servidor.listen(0, '127.0.0.1', ok));
    h.url = `http://127.0.0.1:${(h.servidor.address() as AddressInfo).port}`;
    return h;
  }

  async parar(): Promise<void> {
    this.servidor.closeAllConnections();
    await new Promise<void>((ok) => this.servidor.close(() => ok()));
  }

  linhasDe(entidade: Entidade): Record<string, unknown>[] {
    return [...(this.registros.get(entidade)?.values() ?? [])];
  }

  private responder(res: ServerResponse, status: number, corpo: unknown, cab: Record<string, string> = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...cab });
    res.end(JSON.stringify(corpo));
  }

  private async lerCorpo(req: IncomingMessage): Promise<string> {
    let t = '';
    for await (const c of req) t += c;
    return t;
  }

  private async tratar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const corpoTexto = await this.lerCorpo(req);
    const caminhoCompleto = req.url ?? '/';
    this.chamadas.push({
      metodo: req.method ?? '',
      caminho: caminhoCompleto,
      idempotencia: req.headers['idempotency-key'] as string | undefined,
      conectorId: req.headers['x-macuxi-conector-id'] as string | undefined,
      versao: req.headers['x-macuxi-conector-versao'] as string | undefined,
    });
    if (this.caido) {
      req.socket.destroy();
      return;
    }
    if (this.falhas.restantes > 0) {
      this.falhas.restantes--;
      this.responder(res, this.falhas.status, { erro: 'indisponivel' }, this.falhas.retryAfter ? { 'Retry-After': String(this.falhas.retryAfter) } : {});
      return;
    }
    const bearer = String(req.headers.authorization ?? '');
    const chaveOk = bearer === `Bearer ${this.token}` || [...this.chavesExtras].some((c) => bearer === `Bearer ${c}`);
    const idOk = this.conectorIdEsperado === null || req.headers['x-macuxi-conector-id'] === this.conectorIdEsperado;
    if (!this.tokenValido || !chaveOk || !idOk) {
      this.responder(res, 401, { erro: 'nao_autorizado' });
      return;
    }
    if (!caminhoCompleto.startsWith(API_PREFIX_INTEGRACAO)) {
      this.responder(res, 404, {});
      return;
    }
    const caminho = caminhoCompleto.slice(API_PREFIX_INTEGRACAO.length);
    const corpo = corpoTexto ? (JSON.parse(corpoTexto) as unknown) : undefined;
    const versao = String(req.headers['x-macuxi-conector-versao'] ?? '');
    if (this.exigirVersao && caminho !== '/sinal' && lerSemver(versao) && compararVersoes(versao, this.exigirVersao.minima) < 0) {
      const detalhes = this.exigirVersao.informarMinima === false ? undefined : { versao_minima: this.exigirVersao.minima };
      return this.responder(res, 426, { codigo: 'versao_conector_nao_suportada', mensagem: 'Atualize o Conector.', ...(detalhes ? { detalhes } : {}), erros: [{ codigo: 'versao_conector_nao_suportada', campo: null, mensagem: 'Atualize o Conector.' }] });
    }

    if (req.method === 'POST' && caminho === '/lotes') return this.receberLote(req, res, corpo);
    let m = /^\/lotes\/([^/]+)$/.exec(caminho);
    if (req.method === 'GET' && m) return this.resultadoLote(res, m[1] as string);
    m = /^\/cursores\/([^/]+)$/.exec(caminho);
    if (req.method === 'GET' && m) {
      const c = this.cursores.get(m[1] as string) ?? null;
      return this.responder(res, 200, { entidade: m[1], cursor: c, atualizado_em: c ? new Date().toISOString() : null });
    }
    if (req.method === 'GET' && caminho === '/pedidos/pendentes') {
      const pedidos = this.pedidosParaEntregar.map((p) => PedidoParaErp.parse(p));
      return this.responder(res, 200, { pedidos });
    }
    m = /^\/pedidos\/([^/]+)\/retorno$/.exec(caminho);
    if (req.method === 'POST' && m) {
      if (this.recusarProximoRetorno) {
        const rec = this.recusarProximoRetorno;
        this.recusarProximoRetorno = null;
        return this.responder(res, 422, { erros: [rec] });
      }
      const r = RetornoErp.safeParse(corpo);
      if (!r.success) return this.responder(res, 422, { erros: [{ codigo: 'retorno_invalido', mensagem: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }] });
      const repetido = this.retornos.some((x) => JSON.stringify(x) === JSON.stringify(corpo));
      if (!repetido) this.retornos.push(corpo);
      return this.responder(res, 200, { pedido_uuid: r.data.pedido_uuid, status: r.data.status, repetido });
    }
    if (req.method === 'POST' && caminho === '/sinal') {
      this.sinais.push(corpo);
      return this.responder(res, 200, { ...(this.politicaVersao ? { politica_versao: this.politicaVersao } : {}), recebido_em: new Date().toISOString() });
    }
    if (req.method === 'POST' && caminho === '/reconciliacoes') {
      this.reconciliacoes.push(corpo);
      return this.responder(res, 200, { divergente: false });
    }
    this.responder(res, 404, { erro: 'rota_desconhecida' });
  }

  private receberLote(req: IncomingMessage, res: ServerResponse, corpo: unknown): void {
    const chave = String(req.headers['idempotency-key'] ?? '');
    const existente = chave ? this.porChave.get(chave) : undefined;
    if (existente) {
      const l = this.lotes.get(existente) as LoteGuardado;
      return this.responder(res, 202, { lote_id: l.id, status: 'recebido', entidade: l.envelope.entidade, modo: l.envelope.modo, recebidos: l.envelope.registros.length, consulta: `${API_PREFIX_INTEGRACAO}/lotes/${l.id}` });
    }
    if (this.recusarProximoEnvelope) {
      const r = this.recusarProximoEnvelope;
      this.recusarProximoEnvelope = null;
      return this.responder(res, r.status ?? 422, { erros: [{ codigo: r.codigo, campo: null, mensagem: r.mensagem }] });
    }
    const env = LoteEnvelope.safeParse(corpo);
    if (!env.success) return this.responder(res, 400, { erros: [{ codigo: 'envelope_invalido', campo: null, mensagem: 'envelope inválido' }] });
    const e = env.data;
    const erros: { codigo: string; campo: string | null; mensagem: string }[] = [];
    if (e.versao_contrato !== 'v1') erros.push({ codigo: 'versao_nao_suportada', campo: 'versao_contrato', mensagem: 'versão não suportada' });
    if (!(ENTIDADES as readonly string[]).includes(e.entidade)) erros.push({ codigo: 'entidade_desconhecida', campo: 'entidade', mensagem: 'entidade desconhecida' });
    // exceção da RN-INT-01 (P-1, T-0025/T-0027): registros vazio com linhas inválidas do Conector é aceito
    const trazInvalidas = (e.linhas_invalidas?.length ?? 0) > 0 || (e.linhas_invalidas_omitidas ?? 0) > 0;
    if (e.registros.length === 0 && !trazInvalidas) erros.push({ codigo: 'lote_vazio', campo: 'registros', mensagem: 'lote vazio' });
    if (e.registros.length > LIMITE_REGISTROS_LOTE) erros.push({ codigo: 'acima_do_limite', campo: 'registros', mensagem: 'acima do limite' });
    if (e.modo === 'completo' && !e.sessao) erros.push({ codigo: 'sessao_ausente', campo: 'sessao', mensagem: 'sessão ausente' });
    if (e.modo === 'delta' && e.sessao) erros.push({ codigo: 'sessao_nao_se_aplica', campo: 'sessao', mensagem: 'delta não tem sessão' });
    if (erros.length > 0) return this.responder(res, 422, { erros });

    const entidade = e.entidade as Entidade;
    const base = this.registros.get(entidade) ?? new Map<string, Record<string, unknown>>();
    this.registros.set(entidade, base);
    const lErros: LinhaErro[] = [];
    const aceitas: Cursor[] = [];
    let novas = 0;
    let atualizadas = 0;
    let inalteradas = 0;
    e.registros.forEach((bruto, indice) => {
      const idBruto = (bruto as { external_id?: unknown } | null)?.external_id;
      const externalId = typeof idBruto === 'string' ? idBruto : null;
      if (externalId && this.falhaTransitoria.has(externalId)) {
        this.falhaTransitoria.delete(externalId);
        lErros.push({ indice, external_id: externalId, codigo: 'falha_processamento', campo: null, mensagem: 'falha ao gravar a linha; tente novamente', reprocessavel: true });
        return;
      }
      const r = SCHEMA_REGISTRO[entidade].safeParse(bruto);
      if (!r.success) {
        const i = r.error.issues[0];
        lErros.push({ indice, external_id: externalId, codigo: CODIGO_ZOD[i?.code ?? 'custom'] ?? 'regra_invalida', campo: i?.path.join('.') || null, mensagem: `campo ${i?.path.join('.') ?? ''} inválido`, reprocessavel: false });
        return;
      }
      const reg = r.data as Record<string, unknown>;
      const id = String(reg.external_id);
      const antigo = base.get(id);
      if (!antigo) novas++;
      else if (JSON.stringify({ ...antigo, alterado_em: 0 }) === JSON.stringify({ ...reg, alterado_em: 0 })) inalteradas++;
      else atualizadas++;
      base.set(id, reg);
      aceitas.push({ alterado_em: String(reg.alterado_em), external_id: id });
    });
    let cursor: Cursor | null = null;
    for (const a of aceitas) if (!cursor || compararCursor(a, cursor) > 0) cursor = a;
    const atual = this.cursores.get(entidade);
    if (cursor && (!atual || compararCursor(cursor, atual) > 0)) this.cursores.set(entidade, cursor);

    // linhas que o Conector recusou localmente (T-0023): viram erros com origem `conector`, sem processar nada
    const invalidas = e.linhas_invalidas ?? [];
    const doConector: LinhaErro[] = invalidas.map((l, i) => ({
      indice: i, external_id: l.external_id ?? null, codigo: l.codigo, campo: l.campo ?? null, mensagem: l.mensagem, reprocessavel: false, origem: 'conector' as const,
    }));
    const status = lErros.length === 0 ? (doConector.length > 0 || (e.linhas_invalidas_omitidas ?? 0) > 0 ? 'concluido_com_erros' : 'concluido') : lErros.length === e.registros.length ? 'falhou' : 'concluido_com_erros';
    if (e.sessao && this.simularInativacao) this.acumularSessao(entidade, e, aceitas, lErros, status);
    lErros.push(...doConector);
    const id = randomUUID();
    const guardado: LoteGuardado = {
      id, chave, envelope: e, status, erros: lErros, cursor: this.cursores.get(entidade) ?? null,
      contagens: { recebidas: e.registros.length, com_erro: lErros.length, novas, atualizadas, inalteradas },
      invalidasOmitidas: e.linhas_invalidas_omitidas ?? 0,
      consultasAntes: this.consultasProcessando,
      inativacao: e.sessao?.ultimo ? this.inativacaoNaSessaoCompleta : undefined,
    };
    this.lotes.set(id, guardado);
    if (chave) this.porChave.set(chave, id);
    this.envelopes.push(e);
    const recebidos = e.registros.length + invalidas.length + (e.linhas_invalidas_omitidas ?? 0);
    this.responder(res, 202, { lote_id: id, status: 'recebido', entidade, modo: e.modo, recebidos, consulta: `${API_PREFIX_INTEGRACAO}/lotes/${id}` });
  }

  /** Igual ao domain (`idsDaSessaoNoLote` + `calcularInativacao`), sem a trava dos 30%: o que importa aqui é QUEM sairia. */
  private acumularSessao(entidade: Entidade, e: LoteEnvelope, aceitas: Cursor[], errosHub: LinhaErro[], status: LoteGuardado['status']): void {
    const id = e.sessao?.id as string;
    const s = this.sessoes.get(id) ?? { vistos: new Set<string>(), semId: 0, falhou: false };
    this.sessoes.set(id, s);
    for (const a of aceitas) s.vistos.add(a.external_id);
    for (const x of errosHub) if (x.external_id) s.vistos.add(x.external_id); else s.semId++;
    for (const l of e.linhas_invalidas ?? []) if (l.external_id?.trim()) s.vistos.add(l.external_id.trim()); else s.semId++;
    s.semId += e.linhas_invalidas_omitidas ?? 0;
    if (status === 'falhou') s.falhou = true;
    if (!e.sessao?.ultimo || s.falhou || s.semId > 0 || s.vistos.size === 0) return;
    const fora = this.inativados.get(entidade) ?? new Set<string>();
    for (const ext of this.registros.get(entidade)?.keys() ?? []) if (!s.vistos.has(ext)) fora.add(ext);
    this.inativados.set(entidade, fora);
  }

  private resultadoLote(res: ServerResponse, id: string): void {
    const l = this.lotes.get(id);
    if (!l) return this.responder(res, 404, { erro: 'lote_desconhecido' });
    if (l.consultasAntes > 0) {
      l.consultasAntes--;
      return this.responder(res, 200, this.corpoResultado(l, 'processando'));
    }
    this.responder(res, 200, this.corpoResultado(l, l.status));
  }

  private corpoResultado(l: LoteGuardado, status: string) {
    const final = status !== 'processando';
    return {
      lote_id: l.id,
      entidade: l.envelope.entidade,
      modo: l.envelope.modo,
      status,
      contagens: { ...l.contagens, duplicadas_no_lote: 0 },
      erros: final ? l.erros : [],
      avisos: [],
      cursor: final ? l.cursor : null,
      inativadas: 0,
      invalidas_omitidas: l.invalidasOmitidas || null,
      recebido_em: new Date().toISOString(),
      concluido_em: final ? new Date().toISOString() : null,
      inativacao: final ? (l.inativacao ?? null) : null,
    };
  }
}
