/**
 * Carga por arquivo no BKO (RF-INT-03). O CSV passa pelo MESMO pipeline dos lotes do Hub: vira o envelope canônico, é gravado por
 * `gravarLote` (idempotência RN-INT-12, sessão da carga completa RN-INT-06, staging, `integracao.lote.recebido@1`) e aplicado pelo
 * consumidor A7 (`aplicar-lote.ts`: validação por linha, `concluido_com_erros`, inativação com confirmação). Rotas de usuário
 * (`/v1/integracao`, JWT; a plataforma confere licença do módulo e o perfil da ação):
 *  - `POST cargas-arquivo`   (`carga.arquivo`, admin/analista) → 202 `CargaArquivoAceita`;
 *  - `GET  cargas-arquivo/sessoes/:sessao_id` (`monitor.ver`) → `ProgressoSessaoArquivo` (arquivo enviado em partes da mesma sessão);
 *  - `GET  lotes/:id`        (`monitor.ver`) → `LoteResultado` (contagens, erros com "Linha N do arquivo", inativação);
 *  - `GET  lotes/:id/erros`  (`monitor.ver`) → `ErrosLoteResposta` paginado (a gaveta de erros do monitor já consome).
 * Nada do conteúdo do arquivo vai para log ou auditoria; o staging guarda só o que o lote do Conector guardaria.
 */
import { ErroHttpModulo, ErroNaoEncontrado, type ClienteBanco, type ContextoRota, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { CargaArquivoEntrada, ConferenciaArquivo, ConferirArquivoEntrada, Entidade, type OrdemCargaResposta, ErrosLoteQuery, ModoCarga, ParamsLote, ParamsSessaoArquivo, ProgressoSessaoArquivo, QueryConsultaLote, type CargaArquivoAceita, type ErrosLoteResposta, type EstadoLote, type LinhaErro, type LoteResultado } from '../contracts';
import {
  autorizarAcaoIntegracao,
  chaveDaParte,
  conferirParteDaSessao,
  conferirRegistrosDoArquivo,
  converterCsvParaLote,
  errosParaCsv,
  nomeArquivoErros,
  ordemDeCargaDoPortal,
  hashConteudoArquivo,
  lerChaveDaParte,
  progressoSessaoArquivo,
  resolverConectorDoArquivo,
  sessaoDoArquivo,
  validarChaveIdempotencia,
  validarEnvelope,
  validarParteArquivo,
  type ConectorDoArquivo,
  type ParteArquivo,
  type ParteLida,
} from '../domain';
import { lerParametrosHub } from './parametros';
import { gravarLote, inativacaoDoLote, lerResultadoLote } from './rotas-lotes';

const MSG_CHAVE =
  'A carga por arquivo exige uma chave de idempotência (campo "chave_idempotencia") de 16 a 128 caracteres (letras, números, ponto, hífen, sublinhado e dois-pontos). Use a mesma chave ao repetir o envio do MESMO arquivo e uma chave nova para cada arquivo novo.';

/** Status de negócio do módulo que cada recusa do arquivo usa (o SDK de módulo não emite 400/413; o limite vai em `detalhes.limite`). */
function recusar(codigo: string, mensagem: string, detalhes?: Record<string, unknown>): never {
  throw new ErroHttpModulo(422, codigo, mensagem, detalhes);
}

interface LinhaConectorArquivo {
  id: string;
  identificador: string;
  tipo: ConectorDoArquivo['tipo'];
  ativo: boolean;
  entidades: ConectorDoArquivo['entidades'];
}


const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/** Marcador devolvido pela transação que marcou a sessão como expirada: o erro só sai DEPOIS do commit (senão o `update` desfaria). */
interface SessaoExpirou {
  expirou: true;
  mensagem: string;
}
const ehExpirou = (v: unknown): v is SessaoExpirou => typeof v === 'object' && v !== null && (v as { expirou?: unknown }).expirou === true;

/**
 * Antes de gravar uma PARTE: se a chave da parte já existe, segue para `gravarLote` (repetição ou 409, mesmo com a sessão fechada).
 * Senão confere a parte com as já recebidas da sessão (mesma chave base, total, entidade e modo) e, na carga completa, com a
 * `sessao_carga` (fechada = 422 `sessao_fechada`; aberta mas passada do prazo = marca `expirada` e devolve o marcador).
 */
async function conferirSessaoDaParte(
  db: ClienteBanco,
  p: { tenantId: string; conectorId: string; parte: ParteArquivo; chaveParte: string; entidade: string; modo: string; baseHash: string; agora: Date; ttlMin: number },
): Promise<SessaoExpirou | null> {
  const { rows: ja } = await db.query<{ id: string }>('select id from integracao.lote where tenant_id = $1 and conector_id = $2 and chave_idempotencia = $3', [p.tenantId, p.conectorId, p.chaveParte]);
  if (ja.length > 0) return null;

  const { rows: doBanco } = await db.query<{ chave_idempotencia: string; entidade: string; modo: string }>(
    "select chave_idempotencia, entidade, modo from integracao.lote where tenant_id = $1 and conector_id = $2 and starts_with(chave_idempotencia, $3) and deleted_at is null",
    [p.tenantId, p.conectorId, `${p.parte.sessaoId}.`],
  );
  const existentes = doBanco.flatMap((l) => {
    const k = lerChaveDaParte(l.chave_idempotencia);
    return k ? [{ entidade: l.entidade, modo: l.modo, totalPartes: k.totalPartes, baseHash: k.baseHash, parte: k.parte }] : [];
  });
  const conf = conferirParteDaSessao({ nova: { entidade: p.entidade, modo: p.modo, totalPartes: p.parte.totalPartes, baseHash: p.baseHash }, existentes });
  if (!conf.ok) throw new ErroHttpModulo(conf.status, conf.codigo, conf.mensagem);
  if (p.modo !== 'completo') return null;

  const { rows: s } = await db.query<{ situacao: string; iniciada_em: Date }>(
    'select situacao, iniciada_em from integracao.sessao_carga where tenant_id = $1 and conector_id = $2 and sessao_uuid = $3',
    [p.tenantId, p.conectorId, p.parte.sessaoId],
  );
  const sessao = s[0];
  if (!sessao) return null;
  const faltou = (): string => {
    const recebidas = new Set(existentes.map((x) => x.parte));
    for (let n = 1; n <= p.parte.totalPartes; n++) if (!recebidas.has(n)) return `faltou a parte ${n}`;
    return 'a carga não terminou';
  };
  const mensagemExpirada = (): string => `A sessão desta carga expirou: ${faltou()} no prazo de ${Math.round((p.ttlMin / 60) * 10) / 10} h. Nada foi inativado. Envie o arquivo inteiro de novo com uma chave nova.`;
  if (sessao.situacao === 'expirada') throw new ErroHttpModulo(422, 'sessao_expirada', mensagemExpirada());
  if (sessao.situacao !== 'aberta') {
    throw new ErroHttpModulo(422, 'sessao_fechada', 'Esta sessão de carga já foi fechada: todas as partes anteriores foram aplicadas. Envie o arquivo inteiro de novo com uma chave nova.');
  }
  if (p.agora.getTime() - new Date(sessao.iniciada_em).getTime() > p.ttlMin * 60_000) {
    await db.query("update integracao.sessao_carga set situacao = 'expirada', fechada_em = now() where tenant_id = $1 and conector_id = $2 and sessao_uuid = $3 and situacao = 'aberta'", [p.tenantId, p.conectorId, p.parte.sessaoId]);
    return { expirou: true, mensagem: mensagemExpirada() };
  }
  return null;
}

export const rotaCargaArquivo: RotaModulo = {
  metodo: 'POST',
  caminho: 'cargas-arquivo',
  acao: 'carga.arquivo',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  corpo: CargaArquivoEntrada,
  status: 202,
  executar: async (ctx: ContextoRota<CargaArquivoEntrada>): Promise<CargaArquivoAceita> => {
    // defesa em profundidade: a plataforma já barrou o perfil pela ação do manifesto
    const perm = autorizarAcaoIntegracao('carga.arquivo', ctx.usuario.perfil);
    if (!perm.ok) throw new ErroHttpModulo(403, 'PERFIL_SEM_ACESSO', perm.mensagem);
    const c = ctx.corpo;
    const tenantId = ctx.usuario.tenant_id;

    // RN-INT-12: chave obrigatória
    const chave = validarChaveIdempotencia(c.chave_idempotencia);
    if (!chave.ok) recusar('chave_idempotencia_invalida', MSG_CHAVE);

    const entidade = Entidade.safeParse(c.entidade);
    if (!entidade.success) recusar('entidade_desconhecida', `Entidade desconhecida. Use uma de: ${Entidade.options.join(', ')}.`);
    const modo = ModoCarga.safeParse(c.modo ?? 'delta');
    if (!modo.success) recusar('modo_invalido', 'Modo inválido. Use "delta" (só o que mudou) ou "completo" (a lista inteira da entidade; o que sumiu do arquivo é inativado, com confirmação quando for muita coisa).');

    // arquivo grande em partes da mesma sessão: os três campos juntos ou nenhum (RN-INT-06)
    const pv = validarParteArquivo(c);
    if (!pv.ok) recusar(pv.codigo, pv.mensagem);
    const parte = pv.parte;
    const chaveGravada = parte ? chaveDaParte({ chaveBase: chave.chave, sessaoId: parte.sessaoId, parte: parte.parte, totalPartes: parte.totalPartes }) : chave.chave;

    // CSV -> envelope canônico do lote (mesmos limites de linhas e bytes do lote do Hub)
    const parametros = lerParametrosHub(ctx.parametros(), ctx.log);
    const conv = converterCsvParaLote({
      entidade: entidade.data,
      modo: modo.data,
      texto: c.conteudo,
      agora: ctx.agora().toISOString(),
      sessaoId: sessaoDoArquivo(chave.chave),
      ...(parte ? { parte } : {}),
      limiteLinhas: parametros.limiteRegistrosLote,
      limiteBytes: parametros.limiteCorpoLoteBytes,
    });
    if (!conv.ok) recusar(conv.codigo, conv.mensagem, conv.classe === 'limite' ? { limite: true } : undefined);
    // o MESMO validador do envelope do Hub (versão, sessão da carga completa); a topologia é resolvida abaixo, com mensagem do arquivo
    const env = validarEnvelope(conv.envelope, { limiteRegistros: parametros.limiteRegistrosLote, versoesSuportadas: parametros.versoesSuportadas });
    if (!env.ok) {
      const primeiro = env.erros[0] as (typeof env.erros)[number];
      return recusar(primeiro.codigo, primeiro.mensagem, { erros: env.erros });
    }
    const hashConteudo = hashConteudoArquivo({ entidade: entidade.data, modo: modo.data, texto: c.conteudo, ...(parte ? { parte } : {}) });
    const recebidas = conv.registros.length + conv.linhasInvalidas.length;

    const resultado = await ctx.comTenant(async (db, tx): Promise<CargaArquivoAceita | SessaoExpirou> => {
      // RN-INT-13: o lote do arquivo pertence a um Conector tipo arquivo do tenant que recebe a entidade
      const { rows } = await db.query<LinhaConectorArquivo>('select id, identificador, tipo, ativo, entidades from integracao.conector where tenant_id = $1 and deleted_at is null', [tenantId]);
      const r = resolverConectorDoArquivo(entidade.data, rows, c.conector_id ?? null);
      if (!r.ok) {
        if (r.codigo === 'conector_nao_encontrado') throw new ErroNaoEncontrado('CONECTOR_NAO_ENCONTRADO', r.mensagem);
        return recusar(r.codigo, r.mensagem);
      }
      const conector = r.conector;

      if (parte) {
        const expirou = await conferirSessaoDaParte(db, {
          tenantId,
          conectorId: conector.id,
          parte,
          chaveParte: chaveGravada,
          entidade: entidade.data,
          modo: modo.data,
          baseHash: lerChaveDaParte(chaveGravada)?.baseHash ?? '',
          agora: ctx.agora(),
          ttlMin: parametros.ttlSessaoMin,
        });
        if (expirou) return expirou;
      }

      const g = await gravarLote(db, tx, {
        tenantId,
        conector: { id: conector.id, identificador: conector.identificador },
        env: env.envelope,
        chave: chaveGravada,
        hashConteudo,
        recebidas,
        versaoConector: null,
        bytes: Buffer.byteLength(c.conteudo, 'utf8'),
        agora: ctx.agora(),
        stagingExtra: { origem: 'arquivo', linhas_arquivo: conv.linhasArquivo },
        log: ctx.log,
      });
      if (g.tipo === 'conflito') {
        throw new ErroHttpModulo(409, g.codigo, 'Esta chave de idempotência já foi usada por outro arquivo com conteúdo diferente. Use uma chave nova para este arquivo, ou reenvie exatamente o mesmo arquivo com a mesma chave.');
      }
      if (!g.repetido) {
        // sem nome de arquivo, linhas nem valores: só ids, entidade, modo e contagens
        await tx.auditar({ acao: 'carga.arquivo', entidade: 'lote', entidade_id: g.lote.lote_id, depois: { entidade: entidade.data, modo: modo.data, linhas: conv.totalLinhas, invalidas_leitura: conv.linhasInvalidas.length, conector: conector.identificador, ...(parte ? { sessao_id: parte.sessaoId, parte: parte.parte, total_partes: parte.totalPartes } : {}) } });
      }
      ctx.log.info({ lote_id: g.lote.lote_id, entidade: entidade.data, modo: modo.data, linhas: conv.totalLinhas, repetido: g.repetido, ...(parte ? { sessao_id: parte.sessaoId, parte: parte.parte, total_partes: parte.totalPartes } : {}) }, 'carga por arquivo recebida');
      return {
        lote_id: g.lote.lote_id,
        status: 'recebido',
        entidade: entidade.data,
        modo: modo.data,
        recebidos: g.lote.recebidas,
        ...(g.repetido ? { repetido: true } : {}),
        consulta: `/v1/integracao/lotes/${g.lote.lote_id}`,
        conector_id: conector.identificador,
        linhas_lidas: conv.totalLinhas,
        linhas_invalidas_leitura: conv.linhasInvalidas.length,
        ...(parte ? { sessao: { id: parte.sessaoId, parte: parte.parte, total_partes: parte.totalPartes, consulta: `/v1/integracao/cargas-arquivo/sessoes/${parte.sessaoId}` } } : {}),
      };
    });
    if (ehExpirou(resultado)) throw new ErroHttpModulo(422, 'sessao_expirada', resultado.mensagem);
    return resultado;
  },
};

// ---------------------------------------------------------------------------------------------------------------- progresso das partes

interface LinhaParteSessao {
  id: string;
  conector_id: string;
  entidade: Entidade;
  modo: 'completo' | 'delta';
  status: EstadoLote;
  recebidas: number;
  com_erro: number;
  novas: number;
  atualizadas: number;
  inalteradas: number;
  obsoletas: number;
  chave_idempotencia: string;
  recebido_em: Date;
  sessao_id: string | null;
  erros: string;
}

export const rotaProgressoSessaoArquivo: RotaModulo = {
  metodo: 'GET',
  caminho: 'cargas-arquivo/sessoes/:sessao_id',
  acao: 'monitor.ver',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  params: ParamsSessaoArquivo,
  executar: async (ctx: ContextoRota<unknown, unknown, z.infer<typeof ParamsSessaoArquivo>>): Promise<ProgressoSessaoArquivo> => {
    const tenantId = ctx.usuario.tenant_id;
    const sessaoId = ctx.params.sessao_id.toLowerCase();
    const parametros = lerParametrosHub(ctx.parametros(), ctx.log);
    return ctx.comTenant(async (db) => {
      const { rows } = await db.query<LinhaParteSessao>(
        `select l.id, l.conector_id, l.entidade, l.modo, l.status, l.recebidas, l.com_erro, l.novas, l.atualizadas, l.inalteradas, l.obsoletas,
                l.chave_idempotencia, l.recebido_em, l.sessao_id,
                (select count(*)::text from integracao.lote_linha_erro e where e.tenant_id = l.tenant_id and e.lote_id = l.id) as erros
           from integracao.lote l
          where l.tenant_id = $1 and starts_with(l.chave_idempotencia, $2) and l.deleted_at is null
          order by l.recebido_em`,
        [tenantId, `${sessaoId}.`],
      );
      const lidas = rows.flatMap((l) => {
        const k = lerChaveDaParte(l.chave_idempotencia);
        return k ? [{ l, k }] : [];
      });
      const primeiro = lidas[0];
      if (!primeiro) throw new ErroNaoEncontrado('SESSAO_NAO_ENCONTRADA', 'Sessão de carga não encontrada. Confira o link ou envie o arquivo de novo em Integração ERP > Carga por arquivo.');
      const { entidade, modo } = primeiro.l;

      let sessaoCarga: { situacao: 'aberta' | 'completa' | 'expirada'; iniciada_em: string } | null = null;
      const sessaoDbId = lidas.find((x) => x.l.sessao_id)?.l.sessao_id ?? null;
      if (modo === 'completo' && sessaoDbId) {
        const { rows: s } = await db.query<{ situacao: 'aberta' | 'completa' | 'expirada'; iniciada_em: Date }>('select situacao, iniciada_em from integracao.sessao_carga where tenant_id = $1 and id = $2', [tenantId, sessaoDbId]);
        if (s[0]) sessaoCarga = { situacao: s[0].situacao, iniciada_em: iso(s[0].iniciada_em) };
      }
      const partes: ParteLida[] = lidas.map(({ l, k }) => ({
        parte: k.parte,
        totalPartes: k.totalPartes,
        lote_id: l.id,
        status: l.status,
        recebidas: l.recebidas,
        com_erro: l.com_erro,
        novas: l.novas,
        atualizadas: l.atualizadas,
        inalteradas: l.inalteradas,
        obsoletas: l.obsoletas,
        recebido_em: iso(l.recebido_em),
      }));
      const total = Math.max(...partes.map((p) => p.totalPartes));
      const agora = ctx.agora().toISOString();
      const calculo = (inativacao?: Awaited<ReturnType<typeof inativacaoDoLote>>) =>
        progressoSessaoArquivo({ sessaoId, entidade, modo, partes, sessaoCarga, errosTotal: lidas.reduce((a, x) => a + Number(x.l.erros), 0), inativacao, agora, ttlMin: parametros.ttlSessaoMin });
      let progresso = calculo();
      // inativação: situação da sessão no resultado da última parte (RN-INT-06); só com a sessão completa
      if (modo === 'completo' && progresso.situacao === 'completa') {
        const ultima = lidas.find((x) => x.k.parte === total)?.l;
        if (ultima?.sessao_id) progresso = calculo(await inativacaoDoLote(db, tenantId, { sessao_id: ultima.sessao_id }));
      }
      return progresso;
    });
  },
};

// ---------------------------------------------------------------------------------------------------------------- leitura no BKO

export const rotaLote: RotaModulo = {
  metodo: 'GET',
  caminho: 'lotes/:id',
  acao: 'monitor.ver',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  params: ParamsLote,
  query: QueryConsultaLote,
  executar: async (ctx: ContextoRota<unknown, z.infer<typeof QueryConsultaLote>, z.infer<typeof ParamsLote>>): Promise<LoteResultado> =>
    ctx.comTenant(async (db) => {
      const r = await lerResultadoLote(db, ctx.usuario.tenant_id, ctx.params.id, { limiteErros: ctx.query.limite_erros });
      if (!r) throw new ErroNaoEncontrado('LOTE_NAO_ENCONTRADO', 'Lote não encontrado. Atualize a lista em Integração ERP > Lotes.');
      return r;
    }),
};

async function loteExiste(db: ClienteBanco, tenantId: string, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>('select id from integracao.lote where tenant_id = $1 and id = $2', [tenantId, id]);
  return rows.length > 0;
}

export const rotaErrosLote: RotaModulo = {
  metodo: 'GET',
  caminho: 'lotes/:id/erros',
  acao: 'monitor.ver',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  params: ParamsLote,
  query: ErrosLoteQuery,
  executar: async (ctx: ContextoRota<unknown, z.infer<typeof ErrosLoteQuery>, z.infer<typeof ParamsLote>>): Promise<ErrosLoteResposta> => {
    const tenantId = ctx.usuario.tenant_id;
    const q = ctx.query;
    return ctx.comTenant(async (db) => {
      if (!(await loteExiste(db, tenantId, ctx.params.id))) throw new ErroNaoEncontrado('LOTE_NAO_ENCONTRADO', 'Lote não encontrado. Atualize a lista em Integração ERP > Lotes.');
      const filtros = [q.codigo ?? null, q.reprocessavel ?? null];
      const { rows: total } = await db.query<{ n: string }>(
        `select count(*)::text as n from integracao.lote_linha_erro
          where tenant_id = $1 and lote_id = $2 and ($3::text is null or codigo = $3) and ($4::boolean is null or reprocessavel = $4)`,
        [tenantId, ctx.params.id, ...filtros],
      );
      const { rows } = await db.query<LinhaErro>(
        `select indice, external_id, codigo, campo, mensagem, reprocessavel, origem from integracao.lote_linha_erro
          where tenant_id = $1 and lote_id = $2 and ($3::text is null or codigo = $3) and ($4::boolean is null or reprocessavel = $4)
          order by indice, origem limit $5 offset $6`,
        [tenantId, ctx.params.id, ...filtros, q.por_pagina, (q.pagina - 1) * q.por_pagina],
      );
      return { itens: rows, total: Number(total[0]?.n ?? 0) };
    });
  },
};

// ---------------------------------------------------------------------------------------------------------------- portal de implantação (T-0087)

const MSG_LOTE_NAO_ENCONTRADO = 'Lote não encontrado. Atualize a lista em Integração ERP > Lotes.';
/** Teto de linhas do erros.csv: o lote aceita até `limiteRegistrosLote` linhas, e cada uma gera no máximo um erro. */
const LIMITE_LINHAS_ERROS_CSV = 100_000;

/** `GET lotes/:id/erros.csv`: todos os erros do lote para corrigir na planilha. O CSV é montado na hora e não fica guardado. */
export const rotaErrosLoteCsv: RotaModulo = {
  metodo: 'GET',
  caminho: 'lotes/:id/erros.csv',
  acao: 'monitor.ver',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  params: ParamsLote,
  tipoConteudo: 'text/csv; charset=utf-8',
  nomeArquivo: (e) => nomeArquivoErros((e.params as { id: string }).id),
  executar: async (ctx: ContextoRota<unknown, unknown, z.infer<typeof ParamsLote>>): Promise<string> => {
    const tenantId = ctx.usuario.tenant_id;
    return ctx.comTenant(async (db) => {
      if (!(await loteExiste(db, tenantId, ctx.params.id))) throw new ErroNaoEncontrado('LOTE_NAO_ENCONTRADO', MSG_LOTE_NAO_ENCONTRADO);
      const { rows } = await db.query<LinhaErro>(
        `select indice, external_id, codigo, campo, mensagem, reprocessavel, origem from integracao.lote_linha_erro
          where tenant_id = $1 and lote_id = $2 order by indice, origem limit $3`,
        [tenantId, ctx.params.id, LIMITE_LINHAS_ERROS_CSV],
      );
      ctx.log.info({ lote_id: ctx.params.id, erros: rows.length }, 'erros do lote exportados em csv');
      return errosParaCsv(rows);
    });
  },
};

/** `GET ordem-carga`: os cartões do portal na ordem de dependência do Hub (RN-INT-04), sem lista própria no front. */
export const rotaOrdemCarga: RotaModulo = {
  metodo: 'GET',
  caminho: 'ordem-carga',
  acao: 'monitor.ver',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  executar: async (): Promise<OrdemCargaResposta> => ({ itens: ordemDeCargaDoPortal() }),
};

/**
 * `POST cargas-arquivo/conferir` ("Conferir sem gravar"): lê o CSV e valida cada linha com o mesmo schema do lote, sem criar lote,
 * staging, evento nem auditoria de conteúdo. Não confere referências entre entidades (isso é ao gravar). O log só leva contagens.
 */
export const rotaConferirArquivo: RotaModulo = {
  metodo: 'POST',
  caminho: 'cargas-arquivo/conferir',
  acao: 'carga.arquivo',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  corpo: ConferirArquivoEntrada,
  status: 200,
  limiteCorpoBytes: 8 * 1024 * 1024,
  executar: async (ctx: ContextoRota<ConferirArquivoEntrada>): Promise<ConferenciaArquivo> => {
    const perm = autorizarAcaoIntegracao('carga.arquivo', ctx.usuario.perfil);
    if (!perm.ok) throw new ErroHttpModulo(403, 'PERFIL_SEM_ACESSO', perm.mensagem);
    const c = ctx.corpo;
    const entidade = Entidade.safeParse(c.entidade);
    if (!entidade.success) recusar('entidade_desconhecida', `Entidade desconhecida. Use uma de: ${Entidade.options.join(', ')}.`);
    const modo = ModoCarga.safeParse(c.modo ?? 'delta');
    if (!modo.success) recusar('modo_invalido', 'Modo inválido. Use "delta" (só o que mudou) ou "completo" (a lista inteira da entidade).');
    const parametros = lerParametrosHub(ctx.parametros(), ctx.log);
    const conv = converterCsvParaLote({
      entidade: entidade.data,
      modo: modo.data,
      texto: c.conteudo,
      agora: ctx.agora().toISOString(),
      sessaoId: sessaoDoArquivo('conferencia'),
      ...(c.linha_inicial ? { parte: { sessaoId: sessaoDoArquivo('conferencia'), parte: 1, totalPartes: 1, linhaInicial: c.linha_inicial } } : {}),
      limiteLinhas: parametros.limiteRegistrosLote,
      limiteBytes: parametros.limiteCorpoLoteBytes,
    });
    if (!conv.ok) return recusar(conv.codigo, conv.mensagem, conv.classe === 'limite' ? { limite: true } : undefined);
    const r = conferirRegistrosDoArquivo({
      entidade: entidade.data,
      registros: conv.registros,
      linhasArquivo: conv.linhasArquivo,
      linhasInvalidasLeitura: conv.linhasInvalidas,
      totalLinhas: conv.totalLinhas,
      limite: c.limite_erros ?? 200,
    });
    ctx.log.info({ entidade: entidade.data, modo: modo.data, linhas: r.linhas_lidas, com_erro: r.linhas_com_erro }, 'arquivo conferido sem gravar');
    return { entidade: entidade.data, modo: modo.data, ...r };
  },
};
