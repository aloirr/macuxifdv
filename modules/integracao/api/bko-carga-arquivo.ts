/**
 * Carga por arquivo no BKO (RF-INT-03). O CSV passa pelo MESMO pipeline dos lotes do Hub: vira o envelope canônico, é gravado por
 * `gravarLote` (idempotência RN-INT-12, sessão da carga completa RN-INT-06, staging, `integracao.lote.recebido@1`) e aplicado pelo
 * consumidor A7 (`aplicar-lote.ts`: validação por linha, `concluido_com_erros`, inativação com confirmação). Rotas de usuário
 * (`/v1/integracao`, JWT; a plataforma confere licença do módulo e o perfil da ação):
 *  - `POST cargas-arquivo`   (`carga.arquivo`, admin/analista) → 202 `CargaArquivoAceita`;
 *  - `GET  lotes/:id`        (`monitor.ver`) → `LoteResultado` (contagens, erros com "Linha N do arquivo", inativação);
 *  - `GET  lotes/:id/erros`  (`monitor.ver`) → `ErrosLoteResposta` paginado (a gaveta de erros do monitor já consome).
 * Nada do conteúdo do arquivo vai para log ou auditoria; o staging guarda só o que o lote do Conector guardaria.
 */
import { ErroHttpModulo, ErroNaoEncontrado, type ClienteBanco, type ContextoRota, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { CargaArquivoEntrada, Entidade, ErrosLoteQuery, ModoCarga, ParamsLote, QueryConsultaLote, type CargaArquivoAceita, type ErrosLoteResposta, type LinhaErro, type LoteResultado } from '../contracts';
import { autorizarAcaoIntegracao, converterCsvParaLote, hashConteudoArquivo, resolverConectorDoArquivo, sessaoDoArquivo, validarChaveIdempotencia, validarEnvelope, type ConectorDoArquivo } from '../domain';
import { lerParametrosHub } from './parametros';
import { gravarLote, lerResultadoLote } from './rotas-lotes';

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

export const rotaCargaArquivo: RotaModulo = {
  metodo: 'POST',
  caminho: 'cargas-arquivo',
  acao: 'carga.arquivo',
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

    // CSV -> envelope canônico do lote (mesmos limites de linhas e bytes do lote do Hub)
    const parametros = lerParametrosHub(ctx.parametros(), ctx.log);
    const conv = converterCsvParaLote({
      entidade: entidade.data,
      modo: modo.data,
      texto: c.conteudo,
      agora: ctx.agora().toISOString(),
      sessaoId: sessaoDoArquivo(chave.chave),
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
    const hashConteudo = hashConteudoArquivo({ entidade: entidade.data, modo: modo.data, texto: c.conteudo });
    const recebidas = conv.registros.length + conv.linhasInvalidas.length;

    return ctx.comTenant(async (db, tx) => {
      // RN-INT-13: o lote do arquivo pertence a um Conector tipo arquivo do tenant que recebe a entidade
      const { rows } = await db.query<LinhaConectorArquivo>('select id, identificador, tipo, ativo, entidades from integracao.conector where tenant_id = $1 and deleted_at is null', [tenantId]);
      const r = resolverConectorDoArquivo(entidade.data, rows, c.conector_id ?? null);
      if (!r.ok) {
        if (r.codigo === 'conector_nao_encontrado') throw new ErroNaoEncontrado('CONECTOR_NAO_ENCONTRADO', r.mensagem);
        return recusar(r.codigo, r.mensagem);
      }
      const conector = r.conector;

      const g = await gravarLote(db, tx, {
        tenantId,
        conector: { id: conector.id, identificador: conector.identificador },
        env: env.envelope,
        chave: chave.chave,
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
        await tx.auditar({ acao: 'carga.arquivo', entidade: 'lote', entidade_id: g.lote.lote_id, depois: { entidade: entidade.data, modo: modo.data, linhas: conv.totalLinhas, invalidas_leitura: conv.linhasInvalidas.length, conector: conector.identificador } });
      }
      ctx.log.info({ lote_id: g.lote.lote_id, entidade: entidade.data, modo: modo.data, linhas: conv.totalLinhas, repetido: g.repetido }, 'carga por arquivo recebida');
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
      };
    });
  },
};

// ---------------------------------------------------------------------------------------------------------------- leitura no BKO

export const rotaLote: RotaModulo = {
  metodo: 'GET',
  caminho: 'lotes/:id',
  acao: 'monitor.ver',
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
