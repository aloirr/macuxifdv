#!/usr/bin/env node
/**
 * T-0108 — Hub de Integração SIMULADO (`/integracao/v1`), em Node puro (node:http), para o TI do cliente testar o próprio
 * cliente da API sem tocar no servidor de demonstração. Segue o guia (`../../guia-api-hub.md`) e o OpenAPI
 * (`../../openapi-hub-v1.json`): autenticação, Idempotency-Key, recusas de envelope, processamento do lote em etapas, erros por
 * linha, cursor por entidade, fila de pedidos e retorno do ERP.
 *
 * É uma SIMULAÇÃO: não persiste nada em disco, não valida todos os campos de cada entidade (só os que geram os erros de exemplo)
 * e a chave abaixo é fictícia. Nunca use este arquivo em produção.
 *
 *   node hub-simulado.mjs [porta]        sobe em 127.0.0.1 (porta padrão 8787) e imprime a URL e a chave de teste
 *
 * Como módulo: `const hub = criarHubSimulado({ chave, conectorId, falhasTransitorias }); const url = await hub.iniciar();`
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ARQUIVO_OPENAPI = fileURLToPath(new URL('../../openapi-hub-v1.json', import.meta.url));
const PREFIXO = '/integracao/v1';

const ENTIDADES = [
  'vendedor',
  'cliente',
  'produto',
  'preco',
  'estoque',
  'titulo',
  'nota',
  'rota',
  'catalogo_no',
  'produto_unidade',
  'cliente_endereco',
  'transportadora',
  'forma_pagamento',
  'prazo_pagamento',
  'tabela_escalonada',
];

/** Campo de referência (obrigatória) de cada entidade dependente e a entidade-alvo. */
const REFERENCIAS = {
  preco: [['produto_external_id', 'produto']],
  estoque: [['produto_external_id', 'produto']],
  produto_unidade: [['produto_external_id', 'produto']],
  tabela_escalonada: [['produto_external_id', 'produto']],
  cliente_endereco: [['cliente_external_id', 'cliente']],
  titulo: [['cliente_external_id', 'cliente']],
  nota: [
    ['cliente_external_id', 'cliente'],
    ['vendedor_external_id', 'vendedor'],
  ],
};

const LIMITE_REGISTROS = 5000;
const LIMITE_CORPO_LOTE = 8 * 1024 * 1024;
const LIMITE_CORPO_OUTRAS = 1024 * 1024;
const LIMITE_LINHAS_INVALIDAS = 500;
const RE_CHAVE_IDEMPOTENCIA = /^[A-Za-z0-9._:-]{16,128}$/;
const RE_CHAVE_API = /^mxc_[A-Za-z0-9_-]{43}$/;
const RE_INSTANTE_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_RETORNO = ['integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado'];

/** Chave de API FICTÍCIA no formato real (`mxc_` + 43 caracteres base64url). */
export const gerarChaveFicticia = () => `mxc_${randomBytes(32).toString('base64url')}`;
export const chaveTemFormatoValido = (chave) => RE_CHAVE_API.test(chave);

/** Compara (alterado_em, external_id): instante primeiro, depois bytes do external_id. Negativo/zero/positivo. */
function compararPar(a, b) {
  const t = Date.parse(a.alterado_em) - Date.parse(b.alterado_em);
  if (t !== 0) return t < 0 ? -1 : 1;
  return Buffer.compare(Buffer.from(a.external_id, 'utf8'), Buffer.from(b.external_id, 'utf8'));
}

/** JSON canônico (chaves ordenadas) para o hash de conteúdo. */
function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
const sha256 = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex');
const agora = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Pedido de exemplo do OpenAPI (a fila nasce com ele, estado `pendente`). */
function pedidoDeExemplo() {
  const doc = JSON.parse(readFileSync(ARQUIVO_OPENAPI, 'utf8'));
  const exemplos = doc.paths['/pedidos/pendentes'].get.responses['200'].content['application/json'].examples;
  return structuredClone(exemplos.com_pedido.value.pedidos[0]);
}

/**
 * Cria o Hub simulado.
 * @param {{ chave?: string, conectorId?: string, falhasTransitorias?: number }} [opcoes]
 *   `falhasTransitorias`: quantas das próximas chamadas autenticadas respondem 503 + `Retry-After: 1` antes de normalizar.
 */
export function criarHubSimulado({ chave = gerarChaveFicticia(), conectorId = 'erp-matriz', falhasTransitorias = 0 } = {}) {
  const requisicoes = [];
  const lotes = new Map(); // lote_id -> lote
  const idempotencia = new Map(); // Idempotency-Key -> { hash, lote_id }
  const cursores = new Map(); // entidade -> { cursor, atualizado_em }
  const registros = new Map(); // entidade -> Map(external_id -> { alterado_em, hash })
  const pedidos = new Map(); // pedido_uuid -> { pedido, estado, tentativa, numero_erp, retornos[], faturado{sequencia:qtd} }
  const reconciliacoes = [];
  const sinais = [];
  const estadoInterno = { falhasPendentes: falhasTransitorias };

  const enfileirarPedido = (pedido) => {
    pedidos.set(pedido.pedido_uuid, { pedido: structuredClone(pedido), estado: 'pendente', tentativa: 0, numero_erp: null, retornos: [], faturado: {} });
  };
  enfileirarPedido(pedidoDeExemplo());

  const registrosDe = (entidade) => {
    if (!registros.has(entidade)) registros.set(entidade, new Map());
    return registros.get(entidade);
  };

  /* ------------------------------------------------------------------ respostas ------------------------------------------------------------------ */

  function responder(ctx, status, corpo, extras = {}) {
    const texto = corpo === undefined ? '' : JSON.stringify(corpo);
    ctx.res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': ctx.requisicaoId,
      ...extras,
    });
    ctx.res.end(texto);
    ctx.registro.status = status;
    ctx.registro.resposta = corpo;
    ctx.registro.cabecalhosResposta = { 'x-request-id': ctx.requisicaoId, ...Object.fromEntries(Object.entries(extras).map(([k, v]) => [k.toLowerCase(), v])) };
  }

  const erro = (ctx, status, codigo, mensagem, extra = {}, cabecalhos = {}) =>
    responder(ctx, status, { codigo, mensagem, ...extra, requisicao_id: ctx.requisicaoId }, cabecalhos);

  /** Formato RecusaLote / RecusaRetorno: acrescenta `erros[]` (codigo, campo, mensagem). */
  const recusa = (ctx, status, codigo, mensagem, campo = null, extra = {}) =>
    erro(ctx, status, codigo, mensagem, { erros: [{ codigo, campo, mensagem }], ...extra });

  /* ------------------------------------------------------------------ lotes ------------------------------------------------------------------ */

  /** Valida o envelope; devolve `null` se ok ou { status, codigo, mensagem, campo }. */
  function validarEnvelope(corpo) {
    const e = (status, codigo, mensagem, campo = null) => ({ status, codigo, mensagem, campo });
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return e(400, 'envelope_invalido', 'O corpo precisa ser um objeto JSON com o envelope do lote.');
    if (typeof corpo.versao_contrato !== 'string' || !corpo.versao_contrato) return e(400, 'envelope_invalido', 'Informe "versao_contrato" (v1).', 'versao_contrato');
    if (typeof corpo.entidade !== 'string' || !corpo.entidade) return e(400, 'envelope_invalido', 'Informe "entidade".', 'entidade');
    if (corpo.modo !== 'delta' && corpo.modo !== 'completo') return e(400, 'envelope_invalido', 'O campo "modo" aceita "delta" ou "completo".', 'modo');
    if (!Array.isArray(corpo.registros)) return e(400, 'envelope_invalido', 'O campo "registros" precisa ser uma lista (pode estar vazia se houver "linhas_invalidas").', 'registros');
    if (corpo.linhas_invalidas != null && !Array.isArray(corpo.linhas_invalidas)) return e(400, 'envelope_invalido', 'O campo "linhas_invalidas" precisa ser uma lista.', 'linhas_invalidas');
    const s = corpo.sessao;
    if (s != null) {
      const ok = typeof s === 'object' && RE_UUID.test(String(s.id)) && Number.isInteger(s.parte) && s.parte >= 1 && typeof s.ultimo === 'boolean';
      if (!ok) return e(400, 'envelope_invalido', 'A "sessao" precisa de id (UUID), parte (1, 2, ...) e ultimo (true/false).', 'sessao');
    }
    if (corpo.versao_contrato !== 'v1') return e(422, 'versao_nao_suportada', 'Versão de contrato não suportada. Use "v1".', 'versao_contrato');
    if (!ENTIDADES.includes(corpo.entidade)) return e(422, 'entidade_desconhecida', 'Entidade desconhecida. Consulte a lista de entidades do contrato.', 'entidade');
    if (corpo.modo === 'completo' && s == null) return e(422, 'sessao_ausente', 'A carga completa exige "sessao" (id, parte e ultimo).', 'sessao');
    if (corpo.modo === 'delta' && s != null) return e(422, 'sessao_nao_se_aplica', 'O lote delta não leva "sessao". Remova o campo ou use o modo "completo".', 'sessao');
    const invalidas = corpo.linhas_invalidas?.length ?? 0;
    if (corpo.registros.length === 0 && invalidas === 0 && !(corpo.linhas_invalidas_omitidas > 0)) {
      return e(422, 'lote_vazio', 'O lote não tem registros nem linhas inválidas. Não envie lote vazio.', 'registros');
    }
    if (corpo.registros.length > LIMITE_REGISTROS) {
      return e(422, 'acima_do_limite', `O lote tem mais de ${LIMITE_REGISTROS} registros. Divida em lotes menores (na carga completa, em partes da mesma sessão).`, 'registros');
    }
    return null;
  }

  /** Conteúdo estável do lote para a idempotência (fora: enviado_em, cursor, conector_id, versao_conector). */
  const hashDoLote = (c) =>
    sha256(
      canonico({
        versao_contrato: c.versao_contrato,
        entidade: c.entidade,
        modo: c.modo,
        sessao: c.sessao ?? null,
        registros: c.registros,
        linhas_invalidas: c.linhas_invalidas ?? [],
        linhas_invalidas_omitidas: c.linhas_invalidas_omitidas ?? 0,
      }),
    );

  /** Valida UMA linha; devolve o erro por linha ou null. Nunca cita o valor do dado. */
  function validarLinha(entidade, reg, indice) {
    const base = { indice, external_id: typeof reg?.external_id === 'string' ? reg.external_id : null, origem: 'hub' };
    const linha = (codigo, campo, mensagem, reprocessavel = false) => ({ ...base, codigo, campo, mensagem, reprocessavel });
    if (!reg || typeof reg !== 'object' || Array.isArray(reg)) return linha('registro_invalido', null, 'A linha precisa ser um objeto JSON.');
    if (typeof reg.external_id !== 'string' || reg.external_id.length < 1 || reg.external_id.length > 200) {
      return linha('external_id_invalido', 'external_id', 'O "external_id" é obrigatório e tem de 1 a 200 caracteres.');
    }
    if (reg.alterado_em == null) return linha('campo_obrigatorio', 'alterado_em', 'O campo "alterado_em" é obrigatório.');
    if (typeof reg.alterado_em !== 'string' || !RE_INSTANTE_UTC.test(reg.alterado_em) || Number.isNaN(Date.parse(reg.alterado_em))) {
      return linha('formato_invalido', 'alterado_em', 'O campo "alterado_em" precisa ser data-hora em UTC com "Z" (ex.: 2026-11-05T13:45:10Z).');
    }
    for (const [campo, valor] of Object.entries(reg)) {
      if (campo.endsWith('_cents') && typeof valor === 'number' && valor < 0) {
        return linha('valor_fora_da_faixa', campo, `O campo "${campo}" não pode ser negativo. Corrija no ERP; o registro volta no próximo delta.`);
      }
    }
    for (const [campo, alvo] of REFERENCIAS[entidade] ?? []) {
      const ref = reg[campo];
      if (typeof ref !== 'string' || !ref) return linha('campo_obrigatorio', campo, `O campo "${campo}" é obrigatório.`);
      if (!registrosDe(alvo).has(ref)) {
        return linha('referencia_ausente', campo, `O campo "${campo}" aponta para ${alvo === 'produto' ? 'um produto' : `um(a) ${alvo}`} que ainda não foi carregado. Envie o(a) ${alvo}; o Hub reprocessa a linha.`, true);
      }
    }
    return null;
  }

  /** Aplica o lote (na 2ª consulta): contagens, erros por linha, avisos, registros e cursor. O cursor só avança aqui. */
  function processar(lote) {
    const c = lote.envelope;
    const contagens = { recebidas: c.registros.length, duplicadas_no_lote: 0, com_erro: 0, novas: 0, atualizadas: 0, inalteradas: 0, obsoletas: 0 };
    const erros = [];
    const avisos = [];
    const ultimaOcorrencia = new Map();
    c.registros.forEach((r, i) => {
      if (r && typeof r.external_id === 'string') ultimaOcorrencia.set(r.external_id, i);
    });
    const aceitos = [];
    c.registros.forEach((reg, i) => {
      const id = reg && typeof reg.external_id === 'string' ? reg.external_id : null;
      if (id !== null && ultimaOcorrencia.get(id) !== i) {
        contagens.duplicadas_no_lote += 1;
        avisos.push({ indice: i, external_id: id, codigo: 'duplicado_no_lote', mensagem: 'O external_id aparece mais de uma vez no lote; valeu a última ocorrência.' });
        return;
      }
      const falha = validarLinha(c.entidade, reg, i);
      if (falha) {
        erros.push(falha);
        contagens.com_erro += 1;
        return;
      }
      const atual = registrosDe(c.entidade).get(reg.external_id);
      const conteudo = { ...reg };
      delete conteudo.alterado_em;
      const hash = sha256(canonico(conteudo));
      if (atual && Date.parse(atual.alterado_em) > Date.parse(reg.alterado_em)) {
        contagens.obsoletas += 1;
        return;
      }
      if (atual && atual.hash === hash) {
        contagens.inalteradas += 1;
      } else {
        contagens[atual ? 'atualizadas' : 'novas'] += 1;
        registrosDe(c.entidade).set(reg.external_id, { alterado_em: reg.alterado_em, hash, ativo: reg.ativo !== false });
      }
      aceitos.push({ alterado_em: reg.alterado_em, external_id: reg.external_id });
    });
    (c.linhas_invalidas ?? []).slice(0, LIMITE_LINHAS_INVALIDAS).forEach((l, j) => {
      contagens.com_erro += 1;
      erros.push({
        indice: c.registros.length + j,
        external_id: l.external_id ?? null,
        codigo: l.codigo,
        campo: l.campo ?? null,
        mensagem: l.mensagem,
        reprocessavel: false,
        origem: 'conector',
      });
    });
    // As linhas `falha_processamento`/reprocessáveis vêm antes das que pedem correção na origem (como no Hub).
    erros.sort((x, y) => Number(y.reprocessavel) - Number(x.reprocessavel) || x.indice - y.indice);

    let maior = null;
    for (const par of aceitos) if (!maior || compararPar(par, maior) > 0) maior = par;
    const entrada = cursores.get(c.entidade);
    if (maior && (!entrada?.cursor || compararPar(maior, entrada.cursor) > 0)) {
      cursores.set(c.entidade, { cursor: maior, atualizado_em: agora() });
    }
    lote.resultado = {
      lote_id: lote.id,
      entidade: c.entidade,
      modo: c.modo,
      status: erros.length > 0 ? 'concluido_com_erros' : 'concluido',
      contagens,
      erros,
      avisos,
      cursor: maior,
      erros_total: erros.length,
      erros_omitidos: 0,
      inativadas: 0,
      recebido_em: lote.recebido_em,
      concluido_em: agora(),
    };
    lote.status = lote.resultado.status;
  }

  function enviarLote(ctx) {
    const chaveIdem = ctx.req.headers['idempotency-key'];
    if (typeof chaveIdem !== 'string' || !RE_CHAVE_IDEMPOTENCIA.test(chaveIdem)) {
      return recusa(ctx, 400, 'chave_idempotencia_invalida', 'O cabeçalho "Idempotency-Key" é obrigatório e tem de 16 a 128 caracteres entre letras, números, ".", "-", "_" e ":". Use o SHA-256 do conteúdo do lote.', 'Idempotency-Key');
    }
    const falha = validarEnvelope(ctx.corpo);
    if (falha) return recusa(ctx, falha.status, falha.codigo, falha.mensagem, falha.campo);
    const hash = hashDoLote(ctx.corpo);
    const existente = idempotencia.get(chaveIdem);
    if (existente) {
      if (existente.hash !== hash) {
        return recusa(ctx, 409, 'chave_idempotencia_reutilizada', 'Esta Idempotency-Key já foi usada com outro conteúdo. Gere uma chave nova para o conteúdo novo.', 'Idempotency-Key');
      }
      const antigo = lotes.get(existente.lote_id);
      return responder(ctx, 202, respostaAceito(antigo, true), { 'Idempotent-Replay': 'true' });
    }
    const lote = { id: randomUUID(), envelope: structuredClone(ctx.corpo), status: 'recebido', consultas: 0, recebido_em: agora(), resultado: null, chave: chaveIdem };
    lotes.set(lote.id, lote);
    idempotencia.set(chaveIdem, { hash, lote_id: lote.id });
    return responder(ctx, 202, respostaAceito(lote, false));
  }

  function respostaAceito(lote, repetido) {
    return {
      lote_id: lote.id,
      status: 'recebido',
      entidade: lote.envelope.entidade,
      modo: lote.envelope.modo,
      recebidos: Math.max(1, lote.envelope.registros.length),
      ...(repetido ? { repetido: true } : {}),
      consulta: `${PREFIXO}/lotes/${lote.id}`,
    };
  }

  function consultarLote(ctx, id) {
    if (!RE_UUID.test(id)) return erro(ctx, 400, 'requisicao_invalida', 'O identificador do lote precisa ser um UUID.', { detalhes: { problemas: [{ campo: 'id', mensagem: 'UUID inválido.' }] } });
    const lote = lotes.get(id);
    if (!lote) return erro(ctx, 404, 'lote_nao_encontrado', 'Lote não encontrado. Reenvie o lote com a mesma Idempotency-Key.');
    const limiteTexto = ctx.url.searchParams.get('limite_erros');
    const limite = limiteTexto === null ? 1000 : Number(limiteTexto);
    if (!Number.isInteger(limite) || limite < 0 || limite > 5500) {
      return erro(ctx, 400, 'requisicao_invalida', 'O parâmetro "limite_erros" aceita de 0 a 5500.', { detalhes: { problemas: [{ campo: 'limite_erros', mensagem: 'Fora da faixa 0..5500.' }] } });
    }
    lote.consultas += 1;
    if (lote.status === 'recebido') {
      lote.status = 'processando';
    } else if (lote.status === 'processando') {
      processar(lote);
    }
    if (lote.resultado) {
      const r = lote.resultado;
      const erros = r.erros.slice(0, limite);
      return responder(ctx, 200, { ...r, erros, erros_omitidos: r.erros.length - erros.length });
    }
    return responder(ctx, 200, {
      lote_id: lote.id,
      entidade: lote.envelope.entidade,
      modo: lote.envelope.modo,
      status: lote.status,
      contagens: { recebidas: lote.envelope.registros.length, duplicadas_no_lote: 0, com_erro: 0, novas: 0, atualizadas: 0, inalteradas: 0, obsoletas: 0 },
      erros: [],
      avisos: [],
      cursor: null,
      inativadas: 0,
      recebido_em: lote.recebido_em,
      concluido_em: null,
    });
  }

  function consultarCursor(ctx, entidade) {
    if (!ENTIDADES.includes(entidade)) return erro(ctx, 404, 'entidade_desconhecida', 'Entidade desconhecida. Use uma das 15 entidades do contrato.');
    const c = cursores.get(entidade);
    return responder(ctx, 200, { entidade, cursor: c?.cursor ?? null, atualizado_em: c?.atualizado_em ?? null });
  }

  function reconciliar(ctx) {
    const c = ctx.corpo;
    const problemas = [];
    if (!c || typeof c !== 'object' || c.versao_contrato !== 'v1') problemas.push({ campo: 'versao_contrato', mensagem: 'Informe "v1".' });
    if (!c || !ENTIDADES.includes(c.entidade)) problemas.push({ campo: 'entidade', mensagem: 'Entidade desconhecida.' });
    if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.data_referencia))) problemas.push({ campo: 'data_referencia', mensagem: 'Use AAAA-MM-DD.' });
    if (!c || !Number.isInteger(c.contagem) || c.contagem < 0) problemas.push({ campo: 'contagem', mensagem: 'Informe a contagem de ativos (inteiro, 0 ou mais).' });
    if (problemas.length) return erro(ctx, 400, 'requisicao_invalida', 'Reconciliação fora do contrato. Corrija os campos indicados.', { detalhes: { problemas } });
    const ativos = [...registrosDe(c.entidade).values()].filter((r) => r.ativo).length;
    const divergente = ativos !== c.contagem;
    reconciliacoes.push({ entidade: c.entidade, data_referencia: c.data_referencia, contagem: c.contagem });
    return responder(ctx, 200, {
      situacao: 'comparada',
      entidade: c.entidade,
      data_referencia: c.data_referencia,
      divergente,
      motivos: divergente ? ['contagem'] : [],
      contagem: { erp: c.contagem, macuxi: ativos, diferenca: c.contagem - ativos, dentro: !divergente },
    });
  }

  function sinal(ctx) {
    const c = ctx.corpo;
    if (!c || typeof c !== 'object' || typeof c.conector_id !== 'string') {
      return erro(ctx, 400, 'requisicao_invalida', 'O sinal precisa de "conector_id", "versao_conector" e "versao_contrato".', { detalhes: { problemas: [{ campo: 'conector_id', mensagem: 'Obrigatório.' }] } });
    }
    sinais.push({ conector_id: c.conector_id, em: c.em ?? null });
    return responder(ctx, 200, {
      politica_versao: { versao_minima: '1.2.1', versao_recomendada: '1.2.1', mensagem: null, pacote: null },
      conector_id: c.conector_id,
      recebido_em: agora(),
    });
  }

  /* ------------------------------------------------------------------ pedidos ------------------------------------------------------------------ */

  function pedidosPendentes(ctx) {
    const texto = ctx.url.searchParams.get('limite');
    const limite = texto === null ? 50 : Number(texto);
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) {
      return erro(ctx, 400, 'requisicao_invalida', 'O parâmetro "limite" aceita de 1 a 100.', { detalhes: { problemas: [{ campo: 'limite', mensagem: 'Fora da faixa 1..100.' }] } });
    }
    const saida = [];
    for (const p of pedidos.values()) {
      if (saida.length >= limite) break;
      if (p.estado !== 'pendente') continue;
      p.estado = 'enviado';
      p.tentativa += 1;
      saida.push({ ...structuredClone(p.pedido), tentativa: p.tentativa });
    }
    return responder(ctx, 200, { pedidos: saida });
  }

  function validarRetorno(c) {
    const problemas = [];
    const p = (campo, mensagem) => problemas.push({ campo, mensagem });
    if (!c || typeof c !== 'object' || Array.isArray(c)) return [{ campo: '(corpo)', mensagem: 'O corpo precisa ser um objeto JSON.' }];
    if (c.versao_contrato !== 'v1') p('versao_contrato', 'Use "v1".');
    if (!RE_UUID.test(String(c.pedido_uuid))) p('pedido_uuid', 'UUID inválido.');
    if (!STATUS_RETORNO.includes(c.status)) p('status', `Use um de: ${STATUS_RETORNO.join(', ')}.`);
    if (typeof c.ocorrido_em !== 'string' || !RE_INSTANTE_UTC.test(c.ocorrido_em)) p('ocorrido_em', 'Data-hora UTC com "Z".');
    if (['integrado', 'faturado_parcial', 'faturado_total'].includes(c.status) && !c.numero_erp) p('numero_erp', 'Obrigatório neste status.');
    if (c.status === 'rejeitado_erp' && !c.motivo) p('motivo', 'Obrigatório em rejeitado_erp.');
    if (c.status?.startsWith('faturado_')) {
      if (!c.nota?.numero) p('nota', 'Obrigatória em faturado_parcial e faturado_total.');
      if (c.itens_faturados != null && (!Array.isArray(c.itens_faturados) || c.itens_faturados.length === 0)) p('itens_faturados', 'Não pode ser vazio.');
    } else if (c.itens_faturados != null) {
      p('itens_faturados', 'Só vale em faturado_parcial e faturado_total.');
    }
    return problemas;
  }

  function retornoPedido(ctx, uuidCaminho) {
    const c = ctx.corpo;
    const problemas = RE_UUID.test(uuidCaminho) ? validarRetorno(c) : [{ campo: 'pedido_uuid', mensagem: 'UUID do caminho inválido.' }];
    if (problemas.length) return erro(ctx, 400, 'requisicao_invalida', 'Retorno fora do contrato. Corrija os campos indicados em detalhes.problemas.', { detalhes: { problemas } });
    if (c.pedido_uuid.toLowerCase() !== uuidCaminho.toLowerCase()) {
      return erro(ctx, 400, 'requisicao_invalida', 'O "pedido_uuid" do corpo precisa ser o mesmo do caminho.', { detalhes: { problemas: [{ campo: 'pedido_uuid', mensagem: 'Diferente do caminho.' }] } });
    }
    const p = pedidos.get(uuidCaminho.toLowerCase());
    if (!p) return recusa(ctx, 422, 'pedido_desconhecido', 'O Hub não conhece este pedido. Confira o pedido_uuid; não reenvie igual.', 'pedido_uuid');
    if (p.estado === 'pendente') return recusa(ctx, 422, 'pedido_nao_entregue', 'Este pedido ainda não saiu em /pedidos/pendentes. Busque-o antes de devolver o retorno.', 'pedido_uuid');
    if (c.numero_erp && p.numero_erp && c.numero_erp !== p.numero_erp) {
      return recusa(ctx, 422, 'numero_erp_divergente', 'O mesmo pedido não pode ter dois números no ERP. Provável gravação duplicada: confira no ERP.', 'numero_erp');
    }
    const assinatura = canonico({ status: c.status, numero_erp: c.numero_erp ?? null, motivo: c.motivo ?? null, nota: c.nota ? { numero: c.nota.numero, serie: c.nota.serie ?? null } : null });
    const repetido = p.retornos.some((r) => r.assinatura === assinatura);
    if (repetido) return responder(ctx, 200, { pedido_uuid: p.pedido.pedido_uuid, status: p.estado, repetido: true });
    const permitidos = {
      enviado: STATUS_RETORNO,
      integrado: ['faturado_parcial', 'faturado_total', 'cancelado'],
      faturado_parcial: ['faturado_parcial', 'faturado_total', 'cancelado'],
    }[p.estado];
    if (!permitidos || !permitidos.includes(c.status)) {
      const possiveis = permitidos?.length ? ` Possíveis a partir daqui: ${permitidos.join(', ')}.` : ` ${p.estado} é um estado final.`;
      return recusa(ctx, 422, 'transicao_invalida', `Transição inválida do pedido: ${p.estado} → ${c.status}.${possiveis}`, 'status');
    }
    const descartados = [];
    if (c.itens_faturados) {
      const vistas = new Set();
      c.itens_faturados.forEach((it, indice) => {
        const item = p.pedido.itens.find((x) => x.sequencia === it.sequencia);
        const saldo = item ? item.quantidade - (p.faturado[it.sequencia] ?? 0) : 0;
        let codigo = null;
        let motivo = '';
        if (vistas.has(it.sequencia)) [codigo, motivo] = ['sequencia_repetida', `A sequência ${it.sequencia} aparece mais de uma vez neste retorno. O item repetido foi ignorado.`];
        else if (!item) [codigo, motivo] = ['sequencia_inexistente', `O pedido enviado não tem o item de sequência ${it.sequencia}. O item foi ignorado; o status do retorno valeu.`];
        else if (item.produto_external_id !== it.produto_external_id) [codigo, motivo] = ['produto_divergente', `O produto informado não é o do item ${it.sequencia} do pedido. O item foi ignorado.`];
        else if (it.quantidade > saldo) [codigo, motivo] = ['quantidade_acima_do_saldo', `A quantidade passa do saldo a faturar do item ${it.sequencia}. O item foi ignorado.`];
        vistas.add(it.sequencia);
        if (codigo) {
          descartados.push({ indice, sequencia: it.sequencia, produto_external_id: it.produto_external_id, quantidade: it.quantidade, codigo, codigos: [codigo], campo: `itens_faturados[${indice}].sequencia`, motivo });
        } else {
          p.faturado[it.sequencia] = (p.faturado[it.sequencia] ?? 0) + it.quantidade;
        }
      });
    }
    p.estado = c.status;
    if (c.numero_erp) p.numero_erp = c.numero_erp;
    p.retornos.push({ assinatura, retorno: structuredClone(c) });
    return responder(ctx, 200, { pedido_uuid: p.pedido.pedido_uuid, status: p.estado, repetido: false, ...(descartados.length ? { itens_descartados: descartados } : {}) });
  }

  /* ------------------------------------------------------------------ servidor ------------------------------------------------------------------ */

  function rotear(ctx) {
    const { req } = ctx;
    // 1) credencial (mensagem genérica de propósito)
    const auth = req.headers.authorization ?? '';
    const idCabecalho = req.headers['x-macuxi-conector-id'];
    if (auth !== `Bearer ${chave}` || idCabecalho !== conectorId) {
      return erro(ctx, 401, 'credencial_invalida', 'Credencial inválida. Confira a chave de API e o identificador do Conector.');
    }
    // 2) falha transitória simulada (503 + Retry-After)
    if (estadoInterno.falhasPendentes > 0) {
      estadoInterno.falhasPendentes -= 1;
      return erro(ctx, 503, 'servico_indisponivel', 'Serviço temporariamente indisponível. Aguarde o tempo de Retry-After e repita.', {}, { 'Retry-After': '1' });
    }
    if (ctx.corpoGrande) return erro(ctx, 413, 'corpo_grande', 'O corpo passa do limite da rota. Divida em lotes menores.');
    if (ctx.corpoInvalido && req.method === 'POST') {
      const ehLote = ctx.caminho === '/lotes';
      return ehLote
        ? recusa(ctx, 400, 'envelope_invalido', 'O corpo não é um JSON válido.')
        : erro(ctx, 400, 'requisicao_invalida', 'O corpo não é um JSON válido.');
    }
    const m = req.method;
    const caminho = ctx.caminho;
    let achou;
    if (m === 'POST' && caminho === '/lotes') return enviarLote(ctx);
    if (m === 'GET' && (achou = caminho.match(/^\/lotes\/([^/]+)$/))) return consultarLote(ctx, achou[1]);
    if (m === 'GET' && (achou = caminho.match(/^\/cursores\/([^/]+)$/))) return consultarCursor(ctx, achou[1]);
    if (m === 'POST' && caminho === '/reconciliacoes') return reconciliar(ctx);
    if (m === 'GET' && caminho === '/pedidos/pendentes') return pedidosPendentes(ctx);
    if (m === 'POST' && (achou = caminho.match(/^\/pedidos\/([^/]+)\/retorno$/))) return retornoPedido(ctx, achou[1]);
    if (m === 'POST' && caminho === '/sinal') return sinal(ctx);
    return erro(ctx, 404, 'rota_nao_encontrada', 'Rota não encontrada neste Hub simulado. Veja as 7 rotas do OpenAPI.');
  }

  const servidor = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const caminho = url.pathname.startsWith(PREFIXO) ? url.pathname.slice(PREFIXO.length) || '/' : null;
    const ctx = { req, res, url, caminho, requisicaoId: `req-${randomBytes(6).toString('hex')}`, corpo: undefined, corpoInvalido: false, corpoGrande: false, registro: null };
    const limite = req.method === 'POST' && caminho === '/lotes' ? LIMITE_CORPO_LOTE : LIMITE_CORPO_OUTRAS;
    const partes = [];
    let total = 0;
    req.on('data', (p) => {
      total += p.length;
      if (total > limite) ctx.corpoGrande = true;
      else partes.push(p);
    });
    req.on('end', () => {
      const cabecalhos = { ...req.headers };
      if (cabecalhos.authorization) cabecalhos.authorization = '[omitido]'; // a chave nunca fica no registro
      const texto = Buffer.concat(partes).toString('utf8');
      ctx.registro = { metodo: req.method, caminho: caminho ?? url.pathname, consulta: url.search, cabecalhos, corpo: undefined, corpoTexto: texto, status: 0, resposta: undefined, cabecalhosResposta: {} };
      if (texto.length > 0 && !ctx.corpoGrande) {
        try {
          ctx.corpo = JSON.parse(texto);
          ctx.registro.corpo = ctx.corpo;
        } catch {
          ctx.corpoInvalido = true;
        }
      }
      requisicoes.push(ctx.registro);
      try {
        if (caminho === null) erro(ctx, 404, 'rota_nao_encontrada', `Use o prefixo ${PREFIXO}.`);
        else rotear(ctx);
      } catch {
        if (!res.headersSent) erro(ctx, 500, 'erro_interno', 'Erro inesperado no Hub simulado. Informe o requisicao_id.');
      }
    });
  });

  let urlBase = null;
  return {
    chave,
    conectorId,
    get url() {
      return urlBase;
    },
    /** Sobe o servidor em 127.0.0.1 (porta 0 = livre) e devolve a URL base `http://127.0.0.1:<porta>/integracao/v1`. */
    iniciar(porta = 0) {
      return new Promise((resolve, rejeitar) => {
        servidor.once('error', rejeitar);
        servidor.listen(porta, '127.0.0.1', () => {
          urlBase = `http://127.0.0.1:${servidor.address().port}${PREFIXO}`;
          resolve(urlBase);
        });
      });
    },
    parar() {
      return new Promise((resolve) => {
        servidor.closeAllConnections?.();
        servidor.close(() => resolve());
      });
    },
    /** Passa a responder 503 + Retry-After nas próximas `n` chamadas autenticadas. */
    definirFalhasTransitorias(n) {
      estadoInterno.falhasPendentes = n;
    },
    /** Coloca outro pedido aprovado na fila (estado `pendente`). */
    enfileirarPedido,
    /** Estado vivo para conferência: requisições registradas (sem a chave), lotes, cursores, pedidos. */
    estado: { requisicoes, lotes, cursores, registros, pedidos, idempotencia, reconciliacoes, sinais },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const porta = Number(process.argv[2] ?? 8787);
  const hub = criarHubSimulado();
  const url = await hub.iniciar(porta);
  console.log('Hub de Integração SIMULADO no ar (só para testes; nada é gravado em disco).');
  console.log(`  MACUXI_HUB_URL=${url}`);
  console.log(`  MACUXI_CHAVE=${hub.chave}   (chave FICTÍCIA, vale só para este processo)`);
  console.log(`  MACUXI_CONECTOR=${hub.conectorId}`);
  console.log('Pressione Ctrl+C para encerrar. A fila de pedidos nasce com o pedido de exemplo do OpenAPI.');
  const encerrar = () => hub.parar().then(() => process.exit(0));
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}
