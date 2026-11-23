/**
 * Trabalho `coletar_erp` (ADR 0058; RN-INT-17, RN-INT-20; desenho §2.3 e §2.4): busca na API do ERP UMA entidade de UM Conector `nuvem`,
 * converte pelo modelo do ERP e aplica pelo MESMO caminho do `POST /lotes` (`gravarLote`: idempotência por hash, sessão de carga
 * completa, staging e o evento `lote.recebido@1`). Disparado por `integracao.coleta.solicitada@1`; o alvo é a linha de `coleta_execucao`.
 *
 * - Roda como `macuxi_app` com o tenant definido (`ctx.emTransacao`); o `macuxi_worker` não lê `credencial_erp`. A credencial é
 *   decifrada em memória, no começo da fatia, e nunca vai a log, erro ou banco.
 * - Rede FORA da transação (T-0121): uma página por vez; cada lote numa transação curta.
 * - Fatia de 20 s: o ponto de retomada (página, parte) fica na memória do processo; sem ele (reinício) a coleta recomeça da primeira
 *   página, e os lotes repetidos voltam idempotentes (a chave é o hash do conteúdo, RN-INT-02).
 * - Carga completa: um lote por parte, com a sessão = a coleta; o último leva `ultimo = true` (só ele fecha a sessão e inativa, RN-INT-06).
 * - 401/403 param as coletas do Conector (`coletas_paradas_em`); rede, timeout, 429 e 5xx esperam 1, 2, 4, 8 e 16 min (RN-INT-20).
 */
import { definirTrabalho, type ContextoTrabalho, type TrabalhoSobDemanda } from '@macuxi/platform-sdk';
import { ErroCofre } from '@macuxi/platform-sdk/cofre-segredos';
import { LIMITES_COLETA_ERP } from '@macuxi/platform-sdk';
import {
  EVENTO_COLETA_SOLICITADA,
  LIMITE_LINHAS_INVALIDAS_PADRAO,
  ROTULO_ENTIDADE,
  type Entidade,
  type LinhaInvalidaConector,
  type LoteEnvelopeValido,
  type ModoCarga,
} from '../contracts';
import { adaptadorDoErp, camposAusentesEmTodas, conteudoCanonicoLote, esperaTentativaS, janelaIncremental, SOBREPOSICAO_PADRAO_MIN, sha256Hex, validarEnvelope, type AdaptadorErp, type ConfigAdaptador } from '../domain';
import { pararColetas } from './busca-erp-coleta-repo';
import { criarClienteErp, decifrarCredencial, ErroErp, falhaDeStatus, lerConectorApi, lerCredencialCifrada, type ClienteErp, type FalhaErp, type LinhaConectorApi } from './busca-erp-comum';
import { situacaoDaBusca, type Ambiente } from './busca-erp-ligacao';
import { gravarLote } from './rotas-lotes';
import type { ClienteHttpSaida } from '@macuxi/platform-sdk/http-saida';

export interface DepsBuscaErp {
  env(): Ambiente;
  http: ClienteHttpSaida;
}

/** Espera do backoff ainda não venceu: a plataforma tenta a fatia de novo (ver pedido de `adiar` ao engenheiro-software). */
export class ErroColetaAguardando extends Error {
  constructor() {
    super('coleta aguardando o backoff');
    this.name = 'ColetaAguardandoBackoff';
  }
}

interface LinhaColeta {
  id: string;
  conector_id: string;
  entidade: Entidade;
  modo: ModoCarga;
  estado: 'solicitada' | 'executando' | 'concluida' | 'falhou';
  tentativas: number;
  proxima_tentativa_em: Date | null;
}

interface Parte {
  registros: unknown[];
  invalidas: LinhaInvalidaConector[];
  omitidas: number;
}

interface Execucao {
  ficha: string | null;
  parte: number;
  paginas: number;
  linhas: number;
  lotes: number;
  fila: Parte[];
}

const numeroParametro = (p: Readonly<Record<string, unknown>>, chave: string, padrao: number, min: number, max: number): number => {
  const v = p[chave];
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.floor(v) : padrao;
};

const pedacos = <T>(l: readonly T[], n: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < l.length; i += n) r.push(l.slice(i, i + n));
  return r;
};

const nada = (): Promise<void> => new Promise((r) => setTimeout(r, 1000));

export function criarTrabalhoColetarErp(deps: DepsBuscaErp): TrabalhoSobDemanda {
  const emMemoria = new Map<string, Execucao>();

  const falharColeta = (ctx: ContextoTrabalho, id: string, f: Pick<FalhaErp, 'classe' | 'codigo' | 'status'>, c: { paginas: number; linhas: number; lotes: number }) =>
    ctx.emTransacao((t) =>
      t.db.query(
        `update integracao.coleta_execucao
            set estado = 'falhou', falha_classe = $3, http_status = $4, erro_codigo = $5, concluida_em = $6, iniciada_em = coalesce(iniciada_em, $6),
                proxima_tentativa_em = null, paginas = $7, linhas = $8, lotes = $9
          where tenant_id = $1 and id = $2 and estado in ('solicitada', 'executando')`,
        [ctx.tenantId, id, f.classe, f.status, f.codigo.slice(0, 100), ctx.agora().toISOString(), c.paginas, c.linhas, c.lotes],
      ),
    );

  async function executarFatia(alvoId: string, ctx: ContextoTrabalho) {
    const chaveMem = `${ctx.tenantId}:${alvoId}`;
    const agora = () => ctx.agora().toISOString();
    const zero = { paginas: 0, linhas: 0, lotes: 0 };

    // ---- 1. estado, configuração e credencial (transação curta; o segredo sai daqui só decifrado, em memória)
    const ini = await ctx.emTransacao(async (t) => {
      const { rows } = await t.db.query<LinhaColeta>(
        `select id, conector_id, entidade, modo, estado, tentativas, proxima_tentativa_em
           from integracao.coleta_execucao where tenant_id = $1 and id = $2 and deleted_at is null for update`,
        [ctx.tenantId, alvoId],
      );
      const coleta = rows[0];
      if (!coleta || coleta.estado === 'concluida' || coleta.estado === 'falhou') return { tipo: 'fim' as const };
      const cfg = await lerConectorApi(t.db, ctx.tenantId, coleta.conector_id);
      const gravada = cfg ? await lerCredencialCifrada(t.db, ctx.tenantId, coleta.conector_id) : null;
      return { tipo: 'coleta' as const, coleta, cfg, gravada };
    });
    if (ini.tipo === 'fim') {
      emMemoria.delete(chaveMem);
      return 'concluido' as const;
    }
    const { coleta, cfg, gravada } = ini;

    const falhar = async (f: Pick<FalhaErp, 'classe' | 'codigo' | 'status'>) => {
      await falharColeta(ctx, coleta.id, f, emMemoria.get(chaveMem) ?? zero);
      emMemoria.delete(chaveMem);
      return 'concluido' as const;
    };

    const sit = situacaoDaBusca(deps.env(), ctx.parametros());
    if (!sit.ligada) return falhar({ classe: 'transitoria', codigo: 'BUSCA_DESLIGADA', status: null });
    const adaptador = cfg ? adaptadorDoErp(cfg.erp) : null;
    if (!cfg || !adaptador || !cfg.ativo || cfg.tipo !== 'nuvem' || !cfg.entidades.includes(coleta.entidade) || !adaptador.entidadesSuportadas.includes(coleta.entidade)) {
      return falhar({ classe: 'formato_mudou', codigo: 'SEM_CONFIGURACAO', status: null });
    }
    if (cfg.coletas_paradas_em) return falhar({ classe: 'credencial_recusada', codigo: 'COLETAS_PARADAS', status: null });
    if (!gravada) return falhar({ classe: 'credencial_recusada', codigo: 'SEM_CREDENCIAL', status: null });
    if (coleta.proxima_tentativa_em && coleta.proxima_tentativa_em.getTime() > ctx.agora().getTime()) throw new ErroColetaAguardando();

    let cliente: ClienteErp;
    let cfgAd: ConfigAdaptador;
    try {
      const credencial = decifrarCredencial(sit.cofre, { tenantId: ctx.tenantId, conectorId: coleta.conector_id, usuario_erp: cfg.usuario_erp, gravada });
      cfgAd = { parametros: cfg.parametros, fuso: typeof cfg.parametros.fuso_erp === 'string' && cfg.parametros.fuso_erp ? cfg.parametros.fuso_erp : ctx.fuso(), agora: agora() };
      cliente = criarClienteErp({ http: deps.http, adaptador, urlBase: cfg.url_base, chaveLimite: coleta.conector_id, credencial, cfg: cfgAd, agora });
    } catch (e) {
      if (e instanceof ErroCofre) return falhar({ classe: 'formato_mudou', codigo: e.codigo, status: null });
      throw e;
    }

    // ---- 2. a coleta vira `executando` (uma por Conector: o índice único impede a segunda)
    if (coleta.estado === 'solicitada') {
      await liberarAbandonadas(ctx, coleta.conector_id);
      try {
        await ctx.emTransacao((t) =>
          t.db.query(`update integracao.coleta_execucao set estado = 'executando', iniciada_em = coalesce(iniciada_em, $3) where tenant_id = $1 and id = $2 and estado = 'solicitada'`, [ctx.tenantId, coleta.id, agora()]),
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          await nada(); // o Conector está coletando outra entidade: espera a vez
          return 'continua' as const;
        }
        throw e;
      }
    }

    // ---- 3. leitura página a página
    const parametros = ctx.parametros();
    const tamanho = numeroParametro(parametros, 'buscaErpPagina', 200, LIMITES_COLETA_ERP.paginaMinima, LIMITES_COLETA_ERP.paginaMaxima);
    const linhasPorLote = numeroParametro(parametros, 'buscaErpLinhasPorLote', LIMITES_COLETA_ERP.linhasPorLote, 1, LIMITES_COLETA_ERP.linhasPorLote);
    const sobreposicaoMin = numeroParametro(parametros, 'buscaErpSobreposicaoMin', SOBREPOSICAO_PADRAO_MIN, 0, 1440);
    const exec: Execucao = emMemoria.get(chaveMem) ?? { ficha: null, parte: 0, paginas: 0, linhas: 0, lotes: 0, fila: [] };
    emMemoria.set(chaveMem, exec);

    try {
      const desde = coleta.modo === 'delta' && adaptador.suportaDelta(coleta.entidade) ? await janelaDaColeta(ctx, coleta, sobreposicaoMin) : null;

      const enviar = async (p: Parte, ultimo: boolean) => {
        exec.parte += 1;
        const env: LoteEnvelopeValido = {
          versao_contrato: 'v1',
          entidade: coleta.entidade,
          modo: coleta.modo,
          ...(coleta.modo === 'completo' ? { sessao: { id: coleta.id, parte: exec.parte, ultimo } } : {}),
          enviado_em: agora(),
          conector_id: cfg.identificador,
          versao_conector: 'nuvem',
          registros: p.registros,
          ...(p.invalidas.length > 0 ? { linhas_invalidas: p.invalidas } : {}),
          ...(p.omitidas > 0 ? { linhas_invalidas_omitidas: p.omitidas } : {}),
        };
        const v = validarEnvelope(env, { limiteRegistros: linhasPorLote, entidadesDoConector: cfg.entidades });
        if (!v.ok) throw new ErroErp({ classe: 'formato_mudou', codigo: 'ENVELOPE_INVALIDO', status: null, retryAfterS: null, tenta: false, paraColetas: false, mensagem: v.erros[0]?.mensagem ?? 'Lote fora do contrato.' });
        const hash = sha256Hex(conteudoCanonicoLote(env));
        const recebidas = p.registros.length + p.invalidas.length + p.omitidas;
        await ctx.emTransacao(async (t) => {
          const r = await gravarLote(t.db, t, { tenantId: ctx.tenantId, conector: { id: cfg.conector_id, identificador: cfg.identificador }, env: v.envelope, chave: hash, hashConteudo: hash, recebidas, versaoConector: 'nuvem', bytes: Buffer.byteLength(JSON.stringify(env)), agora: ctx.agora(), log: ctx.log });
          if (r.tipo === 'conflito') throw new ErroErp({ classe: 'formato_mudou', codigo: r.codigo.slice(0, 100), status: null, retryAfterS: null, tenta: false, paraColetas: false, mensagem: r.mensagem });
        });
        exec.lotes += 1;
        exec.linhas += recebidas;
      };

      for (;;) {
        if (ctx.deveParar()) {
          await gravarProgresso(ctx, coleta.id, exec);
          return 'continua' as const;
        }
        const resp = await cliente.chamar(adaptador.requisicaoPagina(coleta.entidade, { desde, tamanho, ficha: exec.ficha }, cfgAd));
        const lida = adaptador.lerPagina(coleta.entidade, resp);
        if (!lida.ok) {
          const base = falhaDeStatus(lida.status >= 400 ? lida.status : 422, resp.cabecalhos, agora());
          throw new ErroErp({ ...base, classe: 'formato_mudou', tenta: false, paraColetas: false, mensagem: `${lida.mensagem}. Confira a URL da API e o modelo do ERP em Integração ERP > Conectores.` });
        }
        const ausentes = camposAusentesEmTodas(lida.pagina.linhas, adaptador.camposObrigatorios(coleta.entidade));
        if (ausentes.length > 0) {
          throw new ErroErp({ classe: 'formato_mudou', codigo: 'CAMPO_AUSENTE', status: null, retryAfterS: null, tenta: false, paraColetas: false, mensagem: `O ERP mudou o formato de ${ROTULO_ENTIDADE[coleta.entidade]}: o campo ${ausentes.join(', ')} não veio em nenhuma linha. Confira o modelo do ERP.` });
        }
        const partes = converterPagina(adaptador, coleta.entidade, lida.pagina.linhas, cfgAd, linhasPorLote);
        exec.paginas += 1;
        exec.ficha = lida.pagina.proxima;
        if (coleta.modo === 'completo') {
          // segura a última parte: só quem sabe que é a última marca `ultimo` (fecha a sessão e inativa)
          exec.fila.push(...partes);
          while (exec.fila.length > 1) await enviar(exec.fila.shift()!, false);
        } else {
          for (const p of partes) await enviar(p, false);
        }
        if (exec.ficha === null) break;
      }
      if (coleta.modo === 'completo' && exec.fila.length > 0) await enviar(exec.fila.shift()!, true);

      await ctx.emTransacao((t) =>
        t.db.query(
          `update integracao.coleta_execucao set estado = 'concluida', concluida_em = $3, paginas = $4, linhas = $5, lotes = $6, proxima_tentativa_em = null, falha_classe = null
            where tenant_id = $1 and id = $2 and estado = 'executando'`,
          [ctx.tenantId, coleta.id, agora(), exec.paginas, exec.linhas, exec.lotes],
        ),
      );
      ctx.log.info({ entidade: coleta.entidade, modo: coleta.modo, paginas: exec.paginas, linhas: exec.linhas, lotes: exec.lotes }, 'coleta concluída');
      emMemoria.delete(chaveMem);
      return 'concluido' as const;
    } catch (e) {
      if (!(e instanceof ErroErp)) throw e;
      const f = e.falha;
      ctx.log.warn({ entidade: coleta.entidade, classe: f.classe, codigo: f.codigo, http: f.status }, 'coleta falhou');
      if (f.paraColetas) {
        await ctx.emTransacao(async (t) => {
          await pararColetas(t.db, ctx.tenantId, coleta.conector_id, ctx.agora());
        });
        return falhar(f);
      }
      if (!f.tenta) return falhar(f);
      const tentativas = coleta.tentativas + 1;
      const espera = esperaTentativaS(tentativas, { retryAfterS: f.retryAfterS });
      if (espera === null) return falhar(f);
      // volta a `solicitada` (libera a vez do Conector) com a hora da próxima tentativa; a plataforma chama a fatia de novo
      await ctx.emTransacao((t) =>
        t.db.query(
          `update integracao.coleta_execucao set estado = 'solicitada', iniciada_em = null, tentativas = $3, proxima_tentativa_em = $4, http_status = $5, erro_codigo = $6
            where tenant_id = $1 and id = $2 and estado = 'executando'`,
          [ctx.tenantId, coleta.id, tentativas, new Date(ctx.agora().getTime() + espera * 1000).toISOString(), f.status, f.codigo.slice(0, 100)],
        ),
      );
      emMemoria.delete(chaveMem);
      throw new ErroColetaAguardando();
    }
  }

  return definirTrabalho({
    nome: 'coletar_erp',
    disparadoPor: EVENTO_COLETA_SOLICITADA,
    alvo: (p) => p.coleta_id,
    executarFatia,
    async aoFalhar(alvoId, ctx, erro) {
      emMemoria.delete(`${ctx.tenantId}:${alvoId}`);
      await ctx.emTransacao((t) =>
        t.db.query(
          `update integracao.coleta_execucao
              set estado = 'falhou', falha_classe = 'transitoria', erro_codigo = $3, concluida_em = $4, iniciada_em = coalesce(iniciada_em, $4), proxima_tentativa_em = null
            where tenant_id = $1 and id = $2 and estado in ('solicitada', 'executando')`,
          [ctx.tenantId, alvoId, erro.codigo.slice(0, 100) || 'ERRO', ctx.agora().toISOString()],
        ),
      );
    },
  });
}

async function liberarAbandonadas(ctx: ContextoTrabalho, conectorId: string): Promise<void> {
  await ctx.emTransacao((t) =>
    t.db.query(
      `update integracao.coleta_execucao set estado = 'falhou', falha_classe = 'transitoria', erro_codigo = 'ABANDONADA', concluida_em = $3
        where tenant_id = $1 and conector_id = $2 and estado = 'executando' and updated_at < $3::timestamptz - interval '10 minutes'`,
      [ctx.tenantId, conectorId, ctx.agora().toISOString()],
    ),
  );
}

async function gravarProgresso(ctx: ContextoTrabalho, id: string, e: Pick<Execucao, 'paginas' | 'linhas' | 'lotes'>): Promise<void> {
  await ctx.emTransacao((t) => t.db.query(`update integracao.coleta_execucao set paginas = $3, linhas = $4, lotes = $5 where tenant_id = $1 and id = $2 and estado = 'executando'`, [ctx.tenantId, id, e.paginas, e.linhas, e.lotes]));
}

async function janelaDaColeta(ctx: ContextoTrabalho, c: Pick<LinhaColeta, 'conector_id' | 'entidade'>, sobreposicaoMin: number): Promise<string | null> {
  const { rows } = await ctx.emTransacao((t) =>
    t.db.query<{ cursor_alterado_em: Date | null }>('select cursor_alterado_em from integracao.cursor_entidade where tenant_id = $1 and conector_id = $2 and entidade = $3 and deleted_at is null', [ctx.tenantId, c.conector_id, c.entidade]),
  );
  return janelaIncremental({ cursorAlteradoEm: rows[0]?.cursor_alterado_em ? rows[0].cursor_alterado_em.toISOString() : null, sobreposicaoMin });
}

/** Converte as linhas da página; a linha com erro vai para `linhas_invalidas` (RN-INT-03) sem o valor do dado. Parte = até `porLote` registros. */
export function converterPagina(adaptador: AdaptadorErp, entidade: Entidade, linhas: readonly unknown[], cfg: ConfigAdaptador, porLote: number): Parte[] {
  const registros: unknown[] = [];
  const invalidas: LinhaInvalidaConector[] = [];
  let omitidas = 0;
  for (const l of linhas) {
    const r = adaptador.converter(entidade, l, cfg);
    if (r.ok) registros.push(...r.registros);
    else if (invalidas.length < LIMITE_LINHAS_INVALIDAS_PADRAO) invalidas.push({ external_id: r.external_id?.slice(0, 200) ?? null, codigo: 'registro_invalido', campo: r.campo.slice(0, 100), mensagem: r.mensagem.slice(0, 300) });
    else omitidas += 1;
  }
  const grupos = pedacos(registros, porLote);
  if (grupos.length === 0) return invalidas.length > 0 || omitidas > 0 ? [{ registros: [], invalidas, omitidas }] : [];
  return grupos.map((g, i) => ({ registros: g, invalidas: i === 0 ? invalidas : [], omitidas: i === 0 ? omitidas : 0 }));
}
