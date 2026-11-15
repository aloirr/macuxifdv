/**
 * OpenAPI 3.1 do Hub `/integracao/v1`, gerado dos contratos Zod (T-0087): nada de schema escrito à mão.
 * Fontes: `ROTAS_HUB` (rotas, cabeçalhos, params, query, corpo, sucesso e status de erro), os schemas dos contratos
 * (convertidos por `zod-json-schema.ts`) e os exemplos testados de `exemplos.ts`.
 * O documento é publicado em `docs/openapi-hub-v1.json` (regerar: `pnpm --filter @macuxi/integracao openapi`) e em
 * `GET /integracao/v1/openapi.json` (`api/openapi/publico.ts`). Mudou `ROTAS_HUB` ou um exemplo: o teste de deriva avisa.
 */
import { z } from 'zod';
import * as base from '../../contracts/base';
import * as conector from '../../contracts/conector';
import * as entidades from '../../contracts/entidades';
import * as hub from '../../contracts/hub';
import * as lote from '../../contracts/lote';
import * as pedido from '../../contracts/pedido';
import {
  CABECALHO_CONECTOR_ID,
  CABECALHO_CONECTOR_VERSAO,
  CABECALHO_IDEMPOTENCIA,
  CABECALHO_REPLAY,
  ENTIDADES,
  ErroHub,
  LoteEnvelope,
  RecusaLote,
  RecusaRetorno,
  ROTAS_HUB,
  SCHEMA_REGISTRO,
  VERSAO_CONTRATO,
  type RotaHub,
} from '../../contracts';
import { ConversorZod, campoObrigatorio, type JsonSchema } from './zod-json-schema';
import {
  CHAVE_IDEMPOTENCIA_EXEMPLO,
  CONECTOR_ID_EXEMPLO,
  EXEMPLOS_CURSOR,
  EXEMPLOS_ERRO_COMUM,
  EXEMPLOS_ERRO_ROTA,
  EXEMPLOS_LOTE,
  EXEMPLOS_LOTE_ACEITO,
  EXEMPLOS_LOTE_RESULTADO,
  EXEMPLOS_PEDIDOS_PENDENTES,
  EXEMPLOS_RECONCILIACAO,
  EXEMPLOS_RECONCILIACAO_RESPOSTA,
  EXEMPLOS_RESPOSTA_SINAL,
  EXEMPLOS_RETORNO,
  EXEMPLOS_RETORNO_ACEITO,
  EXEMPLOS_SINAL,
  LOTE_ID_EXEMPLO,
  PEDIDO_UUID_EXEMPLO,
  VERSAO_CONECTOR_EXEMPLO,
  type Exemplo,
} from './exemplos';

export interface DocumentoOpenApi {
  openapi: '3.1.0';
  info: Record<string, unknown>;
  servers: Record<string, unknown>[];
  tags: Record<string, unknown>[];
  security: Record<string, string[]>[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
    parameters: Record<string, unknown>;
    headers: Record<string, unknown>;
    responses: Record<string, unknown>;
    schemas: Record<string, JsonSchema>;
  };
}

/** Exemplos de corpo por rota (`POST`). */
const EXEMPLOS_CORPO: Record<string, readonly Exemplo[]> = {
  enviar_lote: EXEMPLOS_LOTE,
  enviar_reconciliacao: EXEMPLOS_RECONCILIACAO,
  retorno_pedido: EXEMPLOS_RETORNO,
  sinal: EXEMPLOS_SINAL,
};

/** Exemplos do sucesso por rota. */
const EXEMPLOS_SUCESSO: Record<string, readonly Exemplo[]> = {
  enviar_lote: EXEMPLOS_LOTE_ACEITO,
  consultar_lote: EXEMPLOS_LOTE_RESULTADO,
  consultar_cursor: EXEMPLOS_CURSOR,
  enviar_reconciliacao: EXEMPLOS_RECONCILIACAO_RESPOSTA,
  pedidos_pendentes: EXEMPLOS_PEDIDOS_PENDENTES,
  retorno_pedido: EXEMPLOS_RETORNO_ACEITO,
  sinal: EXEMPLOS_RESPOSTA_SINAL,
};

export { EXEMPLOS_CORPO, EXEMPLOS_SUCESSO };

/** Schema Zod do corpo de erro de cada status de cada rota (o teste valida os exemplos contra ele). */
export function schemaDeErro(rotaId: string, status: number): z.ZodTypeAny {
  // o 426 sai da autenticação comum (`antes`): sempre com `erros[]` e `detalhes.versao_minima`
  if (status === 426) return RecusaLote;
  if (rotaId === 'enviar_lote') return status === 400 || status === 413 ? z.union([RecusaLote, ErroHub]) : RecusaLote;
  if (rotaId === 'enviar_reconciliacao' && status === 422) return RecusaLote;
  if (rotaId === 'retorno_pedido' && status === 422) return RecusaRetorno;
  return ErroHub;
}

export const STATUS_ERRO_COMUM = [401, 403, 429, 500, 503] as const;

const TAG_DA_ROTA: Record<string, string> = {
  enviar_lote: 'Lotes',
  consultar_lote: 'Lotes',
  consultar_cursor: 'Lotes',
  enviar_reconciliacao: 'Lotes',
  pedidos_pendentes: 'Pedidos',
  retorno_pedido: 'Pedidos',
  sinal: 'Conector',
};

const DESCRICAO_ROTA: Record<string, string> = {
  enviar_lote:
    'Envia um lote de UMA entidade, completo (`modo: completo`, em partes de uma `sessao`) ou delta (`modo: delta`, sem `sessao`). ' +
    'Resposta imediata `202`; a validação por linha e a aplicação rodam em segundo plano: consulte `GET /lotes/{id}` até o status final. ' +
    'Idempotente pela `Idempotency-Key` (16 a 128 caracteres): mesma chave e mesmo conteúdo repete o `202` com `Idempotent-Replay: true`; ' +
    'mesma chave e conteúdo diferente é `409`. Limites: 5.000 registros e 8 MiB por lote. Ordem de carga: vendedor, catalogo_no, transportadora, ' +
    'cliente, produto, rota, titulo, nota, cliente_endereco, produto_unidade, preco, estoque (ver o guia).',
  consultar_lote: 'Resultado do lote: status, contagens, erros por linha (as `falha_processamento` primeiro), avisos, cursor e, no último lote de uma carga completa, a situação da inativação.',
  consultar_cursor: 'De onde o Conector continua o delta. `cursor: null` significa que o Hub nunca recebeu a entidade deste Conector: faça a carga inicial completa.',
  enviar_reconciliacao: 'Contagem e soma de controle do dia por entidade. Reenviar o mesmo dia substitui o anterior. `data_referencia` aceita de D-7 a D+1.',
  pedidos_pendentes: 'Pedidos aprovados no Macuxi para gravar no ERP. O Hub marca como `enviado` o que entrega; sem retorno em 10 minutos o pedido volta a `pendente` e sai de novo com `tentativa + 1`. Grave no ERP de forma idempotente pelo `pedido_uuid`. Só o Conector que recebe pedidos usa esta rota (os demais recebem 403).',
  retorno_pedido:
    'Retorno do ERP para um pedido entregue. `numero_erp` é obrigatório em `integrado` e `faturado_*`; `motivo`, em `rejeitado_erp`; `nota`, em `faturado_*`; `itens_faturados` só vale em `faturado_*`. ' +
    'Idempotente: o mesmo retorno de novo devolve `repetido: true`. Item faturado que não bate com o pedido enviado é descartado e listado em `itens_descartados` (o retorno vale). O Macuxi nunca escreve cancelamento no ERP; `cancelado` só vem do ERP.',
  sinal: 'Sinal de vida (1 por minuto). Responde com a política de versão vigente. É a única rota liberada para o Conector abaixo da versão mínima.',
};

const DESCRICAO_SUCESSO: Record<string, string> = {
  enviar_lote: 'Lote aceito para processamento (ou repetição de um lote já aceito com a mesma Idempotency-Key).',
  consultar_lote: 'Resultado do lote (use `status` para saber se terminou).',
  consultar_cursor: 'Cursor da entidade para este Conector.',
  enviar_reconciliacao: 'Reconciliação recebida (`situacao: pendente` = ainda há lote da entidade em aberto; a comparação definitiva sai quando ele terminar).',
  pedidos_pendentes: 'Pedidos para gravar no ERP (a lista vazia é normal).',
  retorno_pedido: 'Retorno aplicado (ou repetido).',
  sinal: 'Sinal recebido; traz a política de versão.',
};

const DESCRICAO_ERRO_PADRAO: Record<number, string> = {
  400: 'Requisição fora do contrato. Recusa definitiva: corrija e envie de novo (repetir igual dá o mesmo erro).',
  404: 'Não encontrado.',
  409: 'Conflito.',
  413: 'Corpo acima do limite da rota (8 MiB no lote, 1 MiB nas demais).',
  422: 'Recusa por regra de negócio. Definitiva: corrija a causa antes de reenviar.',
  426: 'Conector abaixo da versão mínima exigida. Atualize o Conector; `detalhes.versao_minima` traz a mínima. Só `POST /sinal` continua liberado.',
};

const DESCRICAO_ERRO_ROTA: Record<string, Record<number, string>> = {
  enviar_lote: {
    400: 'Envelope ilegível ou fora do contrato (`envelope_invalido`) ou `Idempotency-Key` ausente/fora do formato (`chave_idempotencia_invalida`). Todos os problemas do envelope voltam juntos em `erros[]`. Nenhum lote é criado.',
    409: '`chave_idempotencia_reutilizada`: a `Idempotency-Key` já foi usada com conteúdo diferente. Gere uma chave nova para o conteúdo novo.',
    422: 'Recusa do envelope por regra (versão, entidade, lote vazio, acima do limite, sessão, entidade de outro Conector). Nenhum lote é criado.',
  },
  consultar_lote: { 404: '`lote_nao_encontrado`: lote inexistente, de outro Conector ou de outra empresa (não se distingue). Reenvie o lote com a mesma `Idempotency-Key`.' },
  consultar_cursor: { 404: '`entidade_desconhecida`: use uma das entidades do contrato.' },
  enviar_reconciliacao: { 422: '`entidade_de_outro_conector`: a entidade é alimentada por outro Conector da empresa.' },
  retorno_pedido: {
    400: 'Corpo fora do contrato, ou `pedido_uuid` do caminho diferente do corpo.',
    422: 'Retorno recusado: `pedido_desconhecido`, `pedido_nao_entregue`, `transicao_invalida` ou `numero_erp_divergente`. Definitivo: o retorno não deve ser reenviado igual.',
  },
};

const DESCRICAO_PARAMETRO: Record<string, string> = {
  [CABECALHO_CONECTOR_ID.toLowerCase()]: 'Identificador do Conector cadastrado no BKO (letras, números, ponto, hífen e sublinhado). A chave de API só vale com o identificador do Conector dono dela.',
  [CABECALHO_CONECTOR_VERSAO.toLowerCase()]: 'Versão do Conector (semver, ex.: 1.2.1). Informativa: ausente ou ilegível nunca bloqueia; só versão legível abaixo da mínima é recusada com 426.',
  [CABECALHO_IDEMPOTENCIA.toLowerCase()]: 'Chave de idempotência do lote (16 a 128 caracteres). O Conector envia o SHA-256 hexadecimal do conteúdo; reenvie a MESMA chave após queda ou resposta perdida.',
  id: 'Identificador do lote (`lote_id` devolvido pelo `POST /lotes`).',
  entidade: 'Entidade do contrato.',
  pedido_uuid: 'UUID do pedido (`pedido_uuid` de `GET /pedidos/pendentes`).',
  limite_erros: 'Quantos erros por linha devolver (as `falha_processamento` vêm primeiro). Padrão 1.000, máximo 5.500.',
  limite: 'Quantos pedidos devolver por consulta. Padrão 50, máximo 100.',
};

const EXEMPLO_PARAMETRO: Record<string, unknown> = {
  [CABECALHO_CONECTOR_ID.toLowerCase()]: CONECTOR_ID_EXEMPLO,
  [CABECALHO_CONECTOR_VERSAO.toLowerCase()]: VERSAO_CONECTOR_EXEMPLO,
  [CABECALHO_IDEMPOTENCIA.toLowerCase()]: CHAVE_IDEMPOTENCIA_EXEMPLO,
  id: LOTE_ID_EXEMPLO,
  entidade: 'produto',
  pedido_uuid: PEDIDO_UUID_EXEMPLO,
};

/** Nome do cabeçalho -> chave em `components.parameters`. */
const COMPONENTE_CABECALHO: Record<string, string> = {
  [CABECALHO_CONECTOR_ID]: 'ConectorId',
  [CABECALHO_CONECTOR_VERSAO]: 'ConectorVersao',
  [CABECALHO_IDEMPOTENCIA]: 'IdempotencyKey',
};

const DESCRICOES_SCHEMA: Record<string, string> = {
  LoteEnvelope:
    'Envelope do lote. Uma entidade por lote; o formato de cada item de `registros` depende de `entidade` (ver `x-macuxi-registro-por-entidade`). ' +
    'Campos desconhecidos são ignorados (compatibilidade para frente).',
  'LoteEnvelope.versao_contrato': 'Versão do contrato: `v1`.',
  'LoteEnvelope.entidade': `Entidade do lote: ${ENTIDADES.join(', ')}.`,
  'LoteEnvelope.modo': '`completo` = carga completa (exige `sessao`); `delta` = só o que mudou (não leva `sessao`).',
  'LoteEnvelope.sessao': 'Obrigatória no modo completo: `id` (UUID da sessão), `parte` (1, 2, ...) e `ultimo: true` na última parte, que fecha a sessão.',
  'LoteEnvelope.cursor': 'Maior par (`alterado_em`, `external_id`) do lote. Informativo: o Hub recalcula.',
  'LoteEnvelope.linhas_invalidas': 'Linhas que o Conector recusou localmente (até 500 detalhadas por lote), sem o valor da linha. Protegem o registro da inativação na carga completa.',
  'LoteEnvelope.linhas_invalidas_omitidas': 'Quantas linhas inválidas passaram do limite e foram só contadas.',
  'LoteEnvelope.registros': 'Registros da entidade (até 5.000). Pode ser vazio quando o lote traz `linhas_invalidas`.',
  RetornoErp:
    'Retorno do ERP para um pedido. Regras: `numero_erp` obrigatório em `integrado`, `faturado_parcial` e `faturado_total`; `motivo` obrigatório em `rejeitado_erp`; ' +
    '`nota` obrigatória em `faturado_*`; `itens_faturados` só em `faturado_*` e nunca vazio.',
  'RetornoErp.itens_faturados': 'Itens faturados NESTA nota (o que foi faturado antes não se repete). `sequencia` é a de `PedidoParaErp.itens`.',
  ProdutoPayload: '`embalagem_medida` e `embalagem_quantidade` devem ser informadas juntas.',
  PrecoPayload: 'Um registro por item de tabela. `vigencia_fim` não pode ser anterior a `vigencia_inicio`.',
  EstoquePayload: 'Um registro por depósito e produto. `saldo` em unidades base.',
  ClientePayload: '`documento` (CNPJ/CPF) é dado pessoal quando CPF: nunca aparece em log nem em mensagem de erro.',
  'ItemPedidoErp.quantidade': 'SEMPRE na unidade base: `quantidade = quantidade_venda x fator` quando a venda é por embalagem.',
  PedidoParaErp: 'Pedido aprovado para gravar no ERP. Idempotente pelo `pedido_uuid`; `tentativa` > 1 = reenvio por timeout.',
};

const REGISTROS_POR_ENTIDADE = ENTIDADES;

function ehObjetoZod(s: z.ZodTypeAny): s is z.AnyZodObject {
  return (s._def as { typeName?: string }).typeName === 'ZodObject';
}

const mapaExemplos = (lista: readonly Exemplo[]): Record<string, unknown> =>
  Object.fromEntries(lista.map((e) => [e.chave, { summary: e.resumo, value: e.valor }]));

const conteudoJson = (schema: JsonSchema, exemplos?: readonly Exemplo[]) => ({
  'application/json': { schema, ...(exemplos && exemplos.length > 0 ? { examples: mapaExemplos(exemplos) } : {}) },
});

const refResposta = (nome: string) => ({ $ref: `#/components/responses/${nome}` });
const refCabecalho = (nome: string) => ({ $ref: `#/components/headers/${nome}` });

const CABECALHOS_RESPOSTA = { 'X-Request-Id': refCabecalho('XRequestId') };

const RESPOSTAS_COMUNS: Record<(typeof STATUS_ERRO_COMUM)[number], { nome: string; descricao: string; retryAfter: boolean }> = {
  401: { nome: 'NaoAutenticado', descricao: 'Credencial inválida (chave desconhecida, revogada, expirada, fora da convivência ou de outro Conector). A mensagem é genérica de propósito. O Conector pausa e nada se perde: confira a chave.', retryAfter: false },
  403: { nome: 'AcessoNegado', descricao: 'Acesso negado: Conector desativado, IP fora da lista, escopo errado, Conector sem permissão para a rota (`acesso_negado`) ou módulo Integração desligado na empresa (`modulo_inativo`).', retryAfter: false },
  429: { nome: 'LimiteDeTaxa', descricao: 'Muitas chamadas do Conector (balde de taxa) ou muitas falhas de autenticação do mesmo IP (20 por minuto). Espere `Retry-After` segundos e repita.', retryAfter: true },
  500: { nome: 'ErroInterno', descricao: 'Erro inesperado no Hub. Repita com backoff; se continuar, informe o `requisicao_id` ao suporte.', retryAfter: false },
  503: { nome: 'ServicoIndisponivel', descricao: 'Hub ou banco indisponível (falha fechada). Espere `Retry-After` segundos e repita com backoff.', retryAfter: true },
};

function montarParametros(conversor: ConversorZod, rota: RotaHub, componentes: Record<string, unknown>): Record<string, unknown>[] {
  const lista: Record<string, unknown>[] = [];
  const forma = (s: z.ZodTypeAny, onde: string): Record<string, z.ZodTypeAny> => {
    if (!ehObjetoZod(s)) throw new Error(`gerarOpenApiHub: ${rota.id}: ${onde} precisa ser um objeto Zod`);
    return s.shape as Record<string, z.ZodTypeAny>;
  };
  const parametro = (nome: string, em: 'header' | 'path' | 'query', campo: z.ZodTypeAny) => {
    const chave = nome.toLowerCase();
    const p: Record<string, unknown> = {
      name: nome,
      in: em,
      required: em === 'path' ? true : campoObrigatorio(campo, 'entrada'),
      description: DESCRICAO_PARAMETRO[chave] ?? (() => { throw new Error(`gerarOpenApiHub: falta descrição do parâmetro ${nome}`); })(),
      schema: conversor.converter(campo, 'entrada'),
    };
    if (chave in EXEMPLO_PARAMETRO) p.example = EXEMPLO_PARAMETRO[chave];
    return p;
  };

  for (const [chave, campo] of Object.entries(forma(rota.cabecalhos, 'cabecalhos'))) {
    if (chave === 'authorization') continue; // vira securityScheme: o OpenAPI ignora parâmetro de header "Authorization"
    const canonico = Object.keys(COMPONENTE_CABECALHO).find((c) => c.toLowerCase() === chave);
    if (!canonico) throw new Error(`gerarOpenApiHub: cabeçalho ${chave} sem nome canônico`);
    const comp = COMPONENTE_CABECALHO[canonico] as string;
    const p = parametro(canonico, 'header', campo);
    const existente = componentes[comp];
    if (existente && JSON.stringify(existente) !== JSON.stringify(p)) throw new Error(`gerarOpenApiHub: o cabeçalho ${canonico} difere entre rotas`);
    componentes[comp] = p;
    lista.push({ $ref: `#/components/parameters/${comp}` });
  }
  const chavesCaminho = [...rota.caminho.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1] as string);
  const params = rota.params ? Object.entries(forma(rota.params, 'params')) : [];
  if (JSON.stringify(params.map(([k]) => k)) !== JSON.stringify(chavesCaminho)) throw new Error(`gerarOpenApiHub: ${rota.id}: params não bate com o caminho ${rota.caminho}`);
  for (const [nome, campo] of params) lista.push(parametro(nome, 'path', campo));
  if (rota.query) for (const [nome, campo] of Object.entries(forma(rota.query, 'query'))) lista.push(parametro(nome, 'query', campo));
  return lista;
}

function montarOperacao(conversor: ConversorZod, rota: RotaHub, parametrosComponentes: Record<string, unknown>): Record<string, unknown> {
  const tag = TAG_DA_ROTA[rota.id];
  const descricao = DESCRICAO_ROTA[rota.id];
  const sucessoDescricao = DESCRICAO_SUCESSO[rota.id];
  if (!tag || !descricao || !sucessoDescricao) throw new Error(`gerarOpenApiHub: rota ${rota.id} sem tag/descrição (atualize gerar.ts)`);

  const respostas: Record<string, unknown> = {};
  const cabecalhosSucesso: Record<string, unknown> = { ...CABECALHOS_RESPOSTA };
  if (rota.id === 'enviar_lote') cabecalhosSucesso[CABECALHO_REPLAY] = refCabecalho('IdempotentReplay');
  respostas[String(rota.sucesso.status)] = {
    description: sucessoDescricao,
    headers: cabecalhosSucesso,
    content: conteudoJson(conversor.converter(rota.sucesso.schema, 'saida'), EXEMPLOS_SUCESSO[rota.id]),
  };

  const status = [...new Set<number>([...rota.erros, ...STATUS_ERRO_COMUM])].sort((a, b) => a - b);
  for (const s of status) {
    if ((STATUS_ERRO_COMUM as readonly number[]).includes(s)) {
      respostas[String(s)] = refResposta(RESPOSTAS_COMUNS[s as (typeof STATUS_ERRO_COMUM)[number]].nome);
      continue;
    }
    const exemplos = EXEMPLOS_ERRO_ROTA[rota.id]?.[s];
    if (!exemplos?.length) throw new Error(`gerarOpenApiHub: ${rota.id} declara o status ${s} sem exemplo de erro`);
    const descricaoErro = DESCRICAO_ERRO_ROTA[rota.id]?.[s] ?? DESCRICAO_ERRO_PADRAO[s];
    if (!descricaoErro) throw new Error(`gerarOpenApiHub: ${rota.id}: status ${s} sem descrição`);
    respostas[String(s)] = {
      description: descricaoErro,
      headers: CABECALHOS_RESPOSTA,
      content: conteudoJson(conversor.converter(schemaDeErro(rota.id, s), 'saida'), exemplos),
    };
  }
  // exemplos de erro de status que a rota não declara = erro de manutenção
  for (const s of Object.keys(EXEMPLOS_ERRO_ROTA[rota.id] ?? {})) {
    if (!rota.erros.includes(Number(s))) throw new Error(`gerarOpenApiHub: ${rota.id} tem exemplo de erro para o status ${s}, que não está em ROTAS_HUB`);
  }

  const op: Record<string, unknown> = {
    operationId: rota.id,
    summary: rota.resumo,
    description: descricao,
    tags: [tag],
    parameters: montarParametros(conversor, rota, parametrosComponentes),
  };
  if (rota.corpo) {
    const exemplos = EXEMPLOS_CORPO[rota.id];
    if (!exemplos?.length) throw new Error(`gerarOpenApiHub: ${rota.id} tem corpo sem exemplo`);
    op.requestBody = { required: true, content: conteudoJson(conversor.converter(rota.corpo, 'entrada'), exemplos) };
  }
  op.responses = respostas;
  if (rota.liberadaAbaixoDaMinima) op['x-macuxi-liberada-abaixo-da-versao-minima'] = true;
  return op;
}

export function gerarOpenApiHub(): DocumentoOpenApi {
  const conversor = new ConversorZod();
  for (const modulo of [base, entidades, lote, pedido, conector, hub]) conversor.registrar(modulo, DESCRICOES_SCHEMA);

  const parametrosComponentes: Record<string, unknown> = {};
  const paths: Record<string, Record<string, unknown>> = {};
  for (const rota of ROTAS_HUB) {
    const item = (paths[rota.caminho] ??= {});
    const metodo = rota.metodo.toLowerCase();
    if (item[metodo]) throw new Error(`gerarOpenApiHub: ${rota.metodo} ${rota.caminho} duplicado`);
    item[metodo] = montarOperacao(conversor, rota, parametrosComponentes);
  }

  // respostas de erro comuns (reutilizadas por todas as rotas)
  const respostas: Record<string, unknown> = {};
  for (const s of STATUS_ERRO_COMUM) {
    const { nome, descricao, retryAfter } = RESPOSTAS_COMUNS[s];
    respostas[nome] = {
      description: descricao,
      headers: { ...CABECALHOS_RESPOSTA, ...(retryAfter ? { 'Retry-After': refCabecalho('RetryAfter') } : {}) },
      content: conteudoJson(conversor.converter(ErroHub, 'saida'), EXEMPLOS_ERRO_COMUM[s]),
    };
  }

  // `registros` do envelope: o contrato guarda `unknown[]` e valida linha a linha com SCHEMA_REGISTRO[entidade]
  const porEntidade: Record<string, JsonSchema> = {};
  for (const e of REGISTROS_POR_ENTIDADE) porEntidade[e] = conversor.ref(SCHEMA_REGISTRO[e], 'entrada');
  conversor.ajustarComponente('LoteEnvelope', 'entrada', (s) => {
    const props = s.properties as Record<string, JsonSchema>;
    if (!props.registros) throw new Error('gerarOpenApiHub: LoteEnvelope sem registros');
    return {
      ...s,
      properties: { ...props, registros: { ...props.registros, items: { anyOf: REGISTROS_POR_ENTIDADE.map((e) => porEntidade[e]) } } },
      'x-macuxi-registro-por-entidade': porEntidade,
    };
  });
  if (!conversor.nomeDe(LoteEnvelope)) throw new Error('gerarOpenApiHub: LoteEnvelope não registrado');

  const { documento, schemas } = conversor.finalizar({ paths, respostas, parametros: parametrosComponentes });

  return {
    openapi: '3.1.0',
    info: {
      title: 'Macuxi FDV — Hub de Integração (API do Conector)',
      version: VERSAO_CONTRATO,
      summary: 'API do Hub de Integração com o ERP: lotes, cursores, reconciliação, pedidos e sinal de vida.',
      description:
        'Contrato `v1` do Hub `/integracao/v1`, usado pelo Conector Macuxi e por integradores que enviam os dados do ERP direto à API. ' +
        'Autenticação por chave de API emitida por Conector no BKO (a empresa vem da chave, nunca do corpo). ' +
        'Dinheiro em centavos inteiros; datas-hora em UTC com `Z`; datas civis `AAAA-MM-DD`. Campo novo opcional é compatível com `v1`. ' +
        'O guia para o TI do cliente (ordem de carga, delta × completo, idempotência, limites, erros, devolução de pedidos e exemplos curl) ' +
        'está em `modules/integracao/docs/guia-api-hub.md`.',
    },
    servers: [
      {
        url: 'https://{servidor}/integracao/v1',
        description: 'Hub de Integração (HTTPS obrigatório). Produção: `api.macuxifdv.com.br`.',
        variables: { servidor: { default: 'api.macuxifdv.com.br', description: 'Servidor da API do Macuxi.' } },
      },
    ],
    tags: [
      { name: 'Lotes', description: 'Envio de dados do ERP (lotes completos e delta), consulta do resultado, cursor e reconciliação diária.' },
      { name: 'Pedidos', description: 'Devolução de pedidos aprovados ao ERP e retorno do ERP (número, rejeição, faturamento, cancelamento).' },
      { name: 'Conector', description: 'Sinal de vida e política de versão.' },
    ],
    security: [{ chaveConector: [] }],
    paths: documento.paths,
    components: {
      securitySchemes: {
        chaveConector: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Chave de API do Conector (mxc_ + 43 caracteres base64url)',
          description:
            'Uma chave de API por Conector, emitida pelo administrador da empresa no BKO (mostrada uma única vez; rotacionável sem parar o Conector). ' +
            'Envie `Authorization: Bearer <chave>` e `X-Macuxi-Conector-Id` em TODA chamada. A chave só abre `/integracao/v1`. ' +
            'A empresa (tenant) vem da chave, nunca do corpo, da query nem de cabeçalho.',
        },
      },
      parameters: documento.parametros,
      headers: {
        XRequestId: { description: 'Identificador da requisição nos logs do Hub (também em `requisicao_id` no erro). Informe-o ao suporte.', schema: { type: 'string' }, example: 'req-7f3a9c2e41d8' },
        RetryAfter: { description: 'Segundos para esperar antes de repetir.', schema: { type: 'integer', minimum: 1 }, example: 30 },
        IdempotentReplay: { description: '`true` quando a `Idempotency-Key` já tinha um lote: é a mesma resposta de antes, sem reprocessar.', schema: { type: 'string', enum: ['true'] } },
      },
      responses: documento.respostas,
      schemas,
    },
  };
}

let memo: DocumentoOpenApi | undefined;
/** Documento gerado uma vez por processo (a rota pública serve este). */
export function openApiHub(): DocumentoOpenApi {
  memo ??= gerarOpenApiHub();
  return memo;
}
