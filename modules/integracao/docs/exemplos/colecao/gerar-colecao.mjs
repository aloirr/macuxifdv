#!/usr/bin/env node
/**
 * T-0108 — Gera a coleção Postman (v2.1), o ambiente Postman e o export Insomnia (v4) do Hub `/integracao/v1` a partir do
 * OpenAPI publicado (`../../openapi-hub-v1.json`). Node puro, sem dependência: o TI do cliente pode rodar no próprio PC.
 *
 *   node gerar-colecao.mjs              regrava os 3 arquivos ao lado deste script
 *   node gerar-colecao.mjs --verificar  só confere (saída 1 se algum arquivo divergir do OpenAPI)
 *
 * Saída determinística (sem data, sem id aleatório): o teste `colecao.test.ts` regenera e compara com os arquivos gravados.
 * Uma requisição por exemplo de corpo do OpenAPI (POST) ou uma por rota (GET), com as respostas de exemplo anexadas à
 * primeira requisição de cada rota (Postman). Sem dado real nem chave: a chave entra pela variável `chave_conector`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ARQUIVO_OPENAPI = fileURLToPath(new URL('../../openapi-hub-v1.json', import.meta.url));

export const ARQUIVOS = {
  postman: 'macuxi-hub-v1.postman_collection.json',
  ambientePostman: 'macuxi-hub-v1.postman_environment.json',
  insomnia: 'macuxi-hub-v1.insomnia.json',
};

/** Variáveis de ambiente da coleção (as mesmas no Postman e no Insomnia). */
export const VARIAVEIS_AMBIENTE = [
  { chave: 'servidor', descricao: 'Servidor da API do Macuxi (sem https:// e sem caminho).', segredo: false },
  {
    chave: 'chave_conector',
    descricao: 'Chave de API do Conector (mxc_ + 43 caracteres), mostrada uma única vez no BKO. Trate como senha.',
    segredo: true,
  },
  { chave: 'conector_id', descricao: 'Identificador do Conector cadastrado no BKO (cabeçalho X-Macuxi-Conector-Id).', segredo: false },
  {
    chave: 'conector_versao',
    descricao: 'Versão do seu software (X-Macuxi-Conector-Versao). Opcional: o cabeçalho vem desligado; ligue só com versão ≥ a mínima da empresa.',
    segredo: false,
  },
];

const CHAVE_PLACEHOLDER = 'mxc_COLE_AQUI_A_CHAVE_DO_CONECTOR';
const NOME = 'Macuxi FDV — Hub de Integração v1';

/** Valores padrão do ambiente, tirados do próprio OpenAPI (servidor e exemplos dos parâmetros). */
export function valoresPadrao(doc) {
  const p = doc.components.parameters;
  return {
    servidor: doc.servers[0].variables.servidor.default,
    chave_conector: CHAVE_PLACEHOLDER,
    conector_id: p.ConectorId.example,
    conector_versao: p.ConectorVersao.example,
  };
}

const sha256 = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex');
const json = (v) => JSON.stringify(v, null, 2);

function resolver(doc, obj) {
  let atual = obj;
  while (atual && typeof atual.$ref === 'string') {
    atual = atual.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((o, k) => o[k], doc);
  }
  return atual;
}

/**
 * Lista normalizada das operações do OpenAPI, na ordem do documento. Cada operação traz parâmetros resolvidos, os exemplos de
 * corpo (`exemplosCorpo`, vazio nos GET) e as respostas de exemplo (`respostas`).
 */
export function operacoes(doc) {
  const lista = [];
  for (const [caminho, metodos] of Object.entries(doc.paths)) {
    for (const [metodo, op] of Object.entries(metodos)) {
      const parametros = (op.parameters ?? []).map((x) => resolver(doc, x));
      const exemplosCorpo = Object.entries(op.requestBody?.content?.['application/json']?.examples ?? {}).map(([nome, ex]) => ({
        nome,
        resumo: ex.summary ?? nome,
        valor: ex.value,
      }));
      const respostas = [];
      for (const [status, r] of Object.entries(op.responses)) {
        const resposta = resolver(doc, r);
        const exemplos = resposta.content?.['application/json']?.examples ?? {};
        for (const [nome, ex] of Object.entries(exemplos)) {
          respostas.push({ status: Number(status), nome, resumo: ex.summary ?? nome, valor: ex.value, cabecalhos: Object.keys(resposta.headers ?? {}) });
        }
      }
      lista.push({
        id: op.operationId,
        metodo: metodo.toUpperCase(),
        caminho,
        tag: op.tags?.[0] ?? 'Hub',
        resumo: op.summary,
        descricao: op.description ?? '',
        parametros,
        exemplosCorpo,
        respostas,
      });
    }
  }
  return lista;
}

/** Valor de variável para cada parâmetro de caminho (o primeiro exemplo do OpenAPI é o padrão). */
const VARIAVEL_DO_PARAMETRO = { id: 'lote_id', entidade: 'entidade', pedido_uuid: 'pedido_uuid' };

function variaveisDeColecao(doc, ops) {
  const vars = [{ key: 'base_url', value: 'https://{{servidor}}/integracao/v1', description: 'Base do Hub (montada a partir de {{servidor}}).' }];
  for (const op of ops) {
    for (const p of op.parametros.filter((x) => x.in === 'path')) {
      const nome = VARIAVEL_DO_PARAMETRO[p.name] ?? p.name;
      if (vars.some((v) => v.key === nome)) continue;
      vars.push({ key: nome, value: String(p.example ?? ''), description: p.description });
    }
  }
  return vars;
}

function descricaoDaRequisicao(op, exemplo) {
  const partes = [`**${op.metodo} ${op.caminho}** — ${op.resumo}`, '', op.descricao];
  if (exemplo) partes.push('', `Exemplo do OpenAPI: \`${exemplo.nome}\` (${exemplo.resumo}).`);
  if (op.id === 'enviar_lote') {
    partes.push(
      '',
      'A `Idempotency-Key` desta requisição é o SHA-256 do corpo: calculada no gerador e recalculada pelo script de pré-requisição do Postman se você mudar o corpo. Reenviar o MESMO corpo repete a chave e devolve o mesmo `lote_id` (`Idempotent-Replay: true`).',
    );
  }
  const consulta = op.parametros.filter((p) => p.in === 'query');
  if (consulta.length) partes.push('', ...consulta.map((p) => `- \`?${p.name}=\`: ${p.description}`));
  return partes.join('\n');
}

function nomeDaRequisicao(op, exemplo) {
  return exemplo ? `${op.resumo.split('.')[0]} — ${exemplo.nome}` : op.resumo.split('.')[0];
}

/* ------------------------------------------------------------------ Postman ------------------------------------------------------------------ */

const SCRIPT_IDEMPOTENCIA = [
  '// Idempotency-Key = SHA-256 do corpo (mesmo corpo, mesma chave; corpo novo, chave nova).',
  "const corpo = pm.variables.replaceIn(pm.request.body ? pm.request.body.raw : '');",
  "pm.request.headers.upsert({ key: 'Idempotency-Key', value: CryptoJS.SHA256(corpo).toString(CryptoJS.enc.Hex) });",
];

const TESTES_POR_OPERACAO = {
  enviar_lote: [
    "if (pm.response.code === 202) { pm.collectionVariables.set('lote_id', pm.response.json().lote_id); }",
    "pm.test('lote aceito (202) ou repetido', () => pm.expect(pm.response.code).to.eql(202));",
  ],
  pedidos_pendentes: [
    'if (pm.response.code === 200) {',
    '  const p = pm.response.json().pedidos;',
    "  if (p.length) { pm.collectionVariables.set('pedido_uuid', p[0].pedido_uuid); }",
    '}',
  ],
};

function urlPostman(op) {
  const caminho = op.caminho.replace(/\{([^}]+)\}/g, (_, n) => `{{${VARIAVEL_DO_PARAMETRO[n] ?? n}}}`);
  const query = op.parametros
    .filter((p) => p.in === 'query')
    .map((p) => ({ key: p.name, value: String(p.schema?.default ?? ''), description: p.description, disabled: true }));
  return {
    raw: `{{base_url}}${caminho}`,
    host: ['{{base_url}}'],
    path: caminho.split('/').filter(Boolean),
    ...(query.length ? { query } : {}),
  };
}

function cabecalhosPostman(op, corpoTexto) {
  const h = [
    { key: 'X-Macuxi-Conector-Id', value: '{{conector_id}}' },
    { key: 'X-Macuxi-Conector-Versao', value: '{{conector_versao}}', disabled: true, description: 'Opcional (ligue só com versão ≥ a mínima da empresa).' },
  ];
  if (corpoTexto !== undefined) h.push({ key: 'Content-Type', value: 'application/json' });
  if (op.parametros.some((p) => p.name === 'Idempotency-Key')) h.push({ key: 'Idempotency-Key', value: sha256(corpoTexto ?? '') });
  return h;
}

function respostaPostman(op, r) {
  return {
    name: `${r.status} — ${r.nome}: ${r.resumo}`,
    status: r.status < 300 ? 'OK' : 'Erro',
    code: r.status,
    _postman_previewlanguage: 'json',
    header: [{ key: 'Content-Type', value: 'application/json' }, ...(r.cabecalhos.includes('Retry-After') ? [{ key: 'Retry-After', value: '30' }] : [])],
    body: json(r.valor),
  };
}

function requisicaoPostman(op, exemplo, comRespostas) {
  const corpoTexto = exemplo ? json(exemplo.valor) : undefined;
  const eventos = [];
  if (op.parametros.some((p) => p.name === 'Idempotency-Key')) eventos.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: SCRIPT_IDEMPOTENCIA } });
  if (TESTES_POR_OPERACAO[op.id]) eventos.push({ listen: 'test', script: { type: 'text/javascript', exec: TESTES_POR_OPERACAO[op.id] } });
  return {
    name: nomeDaRequisicao(op, exemplo),
    ...(eventos.length ? { event: eventos } : {}),
    request: {
      method: op.metodo,
      header: cabecalhosPostman(op, corpoTexto),
      ...(corpoTexto !== undefined ? { body: { mode: 'raw', raw: corpoTexto, options: { raw: { language: 'json' } } } } : {}),
      url: urlPostman(op),
      description: descricaoDaRequisicao(op, exemplo),
    },
    response: comRespostas ? op.respostas.map((r) => respostaPostman(op, r)) : [],
  };
}

export function gerarPostman(doc) {
  const ops = operacoes(doc);
  const tags = doc.tags.map((t) => t.name);
  const pastas = tags.map((tag) => ({
    name: tag,
    description: doc.tags.find((t) => t.name === tag)?.description ?? '',
    item: ops
      .filter((op) => op.tag === tag)
      .map((op) => {
        const exemplos = op.exemplosCorpo.length ? op.exemplosCorpo : [undefined];
        return {
          name: `${op.metodo} ${op.caminho}`,
          description: `${op.resumo}\n\n${op.descricao}`,
          item: exemplos.map((ex, i) => requisicaoPostman(op, ex, i === 0)),
        };
      }),
  }));
  return {
    info: {
      name: NOME,
      description: [
        doc.info.description,
        '',
        `Gerada de \`openapi-hub-v1.json\` (OpenAPI ${doc.openapi}, contrato ${doc.info.version}) por \`docs/exemplos/colecao/gerar-colecao.mjs\`. Não edite à mão.`,
        '',
        'Como usar: importe também o ambiente `macuxi-hub-v1.postman_environment.json`, preencha `chave_conector` e `conector_id` e selecione o ambiente.',
      ].join('\n'),
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{chave_conector}}', type: 'string' }] },
    variable: variaveisDeColecao(doc, ops),
    item: pastas,
  };
}

export function gerarAmbientePostman(doc) {
  const padrao = valoresPadrao(doc);
  return {
    name: `${NOME} — demonstração`,
    values: VARIAVEIS_AMBIENTE.map((v) => ({ key: v.chave, value: padrao[v.chave], type: v.segredo ? 'secret' : 'default', enabled: true })),
    _postman_variable_scope: 'environment',
  };
}

/* ------------------------------------------------------------------ Insomnia ------------------------------------------------------------------ */

const insomniaVar = (nome) => `{{ _.${nome} }}`;

export function gerarInsomnia(doc) {
  const ops = operacoes(doc);
  const padrao = valoresPadrao(doc);
  const varsColecao = Object.fromEntries(variaveisDeColecao(doc, ops).map((v) => [v.key, v.value]));
  varsColecao.base_url = `https://${insomniaVar('servidor')}/integracao/v1`;
  const wrk = 'wrk_macuxi_hub_v1';
  const recursos = [
    {
      _id: wrk,
      _type: 'workspace',
      parentId: null,
      name: NOME,
      description: `${doc.info.description}\n\nGerado de openapi-hub-v1.json por docs/exemplos/colecao/gerar-colecao.mjs. Não edite à mão.`,
      scope: 'collection',
    },
    { _id: 'env_macuxi_hub_v1_base', _type: 'environment', parentId: wrk, name: 'Base Environment', data: varsColecao, dataPropertyOrder: null, isPrivate: false },
    {
      _id: 'env_macuxi_hub_v1_demo',
      _type: 'environment',
      parentId: 'env_macuxi_hub_v1_base',
      name: 'Demonstração',
      data: Object.fromEntries(VARIAVEIS_AMBIENTE.map((v) => [v.chave, padrao[v.chave]])),
      dataPropertyOrder: null,
      isPrivate: false,
    },
  ];
  for (const tag of doc.tags) {
    const fld = `fld_${tag.name.toLowerCase()}`;
    recursos.push({ _id: fld, _type: 'request_group', parentId: wrk, name: tag.name, description: tag.description ?? '' });
    for (const op of ops.filter((o) => o.tag === tag.name)) {
      const exemplos = op.exemplosCorpo.length ? op.exemplosCorpo : [undefined];
      for (const ex of exemplos) {
        const corpoTexto = ex ? json(ex.valor) : undefined;
        const caminho = op.caminho.replace(/\{([^}]+)\}/g, (_, n) => insomniaVar(VARIAVEL_DO_PARAMETRO[n] ?? n));
        const cabecalhos = [
          { name: 'X-Macuxi-Conector-Id', value: insomniaVar('conector_id') },
          { name: 'X-Macuxi-Conector-Versao', value: insomniaVar('conector_versao'), disabled: true },
        ];
        if (corpoTexto !== undefined) cabecalhos.push({ name: 'Content-Type', value: 'application/json' });
        if (op.parametros.some((p) => p.name === 'Idempotency-Key')) cabecalhos.push({ name: 'Idempotency-Key', value: sha256(corpoTexto ?? '') });
        recursos.push({
          _id: `req_${op.id}${ex ? `_${ex.nome}` : ''}`,
          _type: 'request',
          parentId: fld,
          name: nomeDaRequisicao(op, ex),
          description:
            descricaoDaRequisicao(op, ex) +
            (op.id === 'enviar_lote' ? '\n\nNo Insomnia a chave é fixa (SHA-256 do corpo gerado): se mudar o corpo, troque também a Idempotency-Key.' : ''),
          method: op.metodo,
          url: `${insomniaVar('base_url')}${caminho}`,
          parameters: op.parametros
            .filter((p) => p.in === 'query')
            .map((p) => ({ name: p.name, value: String(p.schema?.default ?? ''), disabled: true, description: p.description })),
          headers: cabecalhos,
          authentication: { type: 'bearer', token: insomniaVar('chave_conector') },
          body: corpoTexto !== undefined ? { mimeType: 'application/json', text: corpoTexto } : {},
        });
      }
    }
  }
  return {
    _type: 'export',
    __export_format: 4,
    __export_date: '2026-01-01T00:00:00.000Z',
    __export_source: 'macuxi.gerar-colecao',
    resources: recursos,
  };
}

/* ------------------------------------------------------------------ CLI ------------------------------------------------------------------ */

/** Conteúdo (texto, com quebra final) de cada arquivo gerado, pelo nome do arquivo. */
export function gerarArquivos(doc) {
  return {
    [ARQUIVOS.postman]: `${json(gerarPostman(doc))}\n`,
    [ARQUIVOS.ambientePostman]: `${json(gerarAmbientePostman(doc))}\n`,
    [ARQUIVOS.insomnia]: `${json(gerarInsomnia(doc))}\n`,
  };
}

export const lerOpenApi = (arquivo = ARQUIVO_OPENAPI) => JSON.parse(readFileSync(arquivo, 'utf8'));

function principal(argv) {
  const verificar = argv.includes('--verificar');
  const arquivos = gerarArquivos(lerOpenApi());
  let divergentes = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const destino = fileURLToPath(new URL(`./${nome}`, import.meta.url));
    if (verificar) {
      let atual = '';
      try {
        atual = readFileSync(destino, 'utf8').replaceAll('\r\n', '\n');
      } catch {
        atual = '';
      }
      if (atual !== conteudo) {
        divergentes += 1;
        console.error(`divergente: ${nome} (regere com: node modules/integracao/docs/exemplos/colecao/gerar-colecao.mjs)`);
      }
    } else {
      writeFileSync(destino, conteudo, 'utf8');
      console.log(`gravado: ${nome}`);
    }
  }
  if (verificar && divergentes === 0) console.log('coleção em dia com o openapi-hub-v1.json');
  return divergentes ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = principal(process.argv.slice(2));
}
