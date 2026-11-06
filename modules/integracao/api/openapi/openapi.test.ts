/**
 * T-0087: o OpenAPI 3.1 do Hub gerado dos contratos Zod é (a) válido pelo schema oficial do OpenAPI 3.1, (b) fiel aos contratos
 * (todo exemplo passa no Zod E no JSON Schema gerado), (c) igual ao arquivo publicado em `docs/openapi-hub-v1.json`.
 *
 * Schema oficial: https://spec.openapis.org/oas/3.1/schema/2022-10-07 (vendorizado em `oas-3.1-schema.json`, sem alteração).
 * `ajv` e `ajv-formats` NÃO estão no package.json do módulo: são dependência transitiva do fastify, içada para a raiz do
 * workspace. Declarar como devDependency é proposta ao engenheiro-software (muda o pnpm-lock.yaml).
 * Regerar o arquivo publicado: `pnpm --filter @macuxi/integracao openapi` (ou `ATUALIZAR_OPENAPI=1 pnpm test`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  CABECALHO_CONECTOR_ID,
  CABECALHO_CONECTOR_VERSAO,
  CABECALHO_IDEMPOTENCIA,
  CODIGOS_ERRO_ENVELOPE,
  CODIGOS_RECUSA_RETORNO,
  ENTIDADES,
  ROTAS_HUB,
  SCHEMA_REGISTRO,
  STATUS_HTTP_ERRO_HUB,
  type Entidade,
} from '../../contracts';
import { validarEnvelope } from '../../domain';
import { EXEMPLO_REGISTRO, EXEMPLOS_ERRO_COMUM, EXEMPLOS_ERRO_ROTA, EXEMPLOS_LOTE, type Exemplo } from './exemplos';
import { EXEMPLOS_CORPO, EXEMPLOS_SUCESSO, STATUS_ERRO_COMUM, gerarOpenApiHub, schemaDeErro, type DocumentoOpenApi } from './gerar';

const ARQUIVO_PUBLICADO = fileURLToPath(new URL('../../docs/openapi-hub-v1.json', import.meta.url));
const ARQUIVO_SCHEMA_OFICIAL = fileURLToPath(new URL('./oas-3.1-schema.json', import.meta.url));

const doc: DocumentoOpenApi = gerarOpenApiHub();

const novoAjv = () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true, formats: { 'media-range': true } });
  addFormats(ajv);
  return ajv;
};

type Json = Record<string, unknown>;
const URN = 'urn:macuxi:openapi-hub';

/** Reescreve `#/components/...` para o `$id` do documento adicionado ao Ajv. */
function reescreverRefs(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reescreverRefs);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, k === '$ref' && typeof x === 'string' && x.startsWith('#/') ? `${URN}${x}` : reescreverRefs(x)]),
    );
  }
  return v;
}

const ajvDoc = novoAjv();
ajvDoc.addSchema({ $id: URN, components: doc.components });
const validadorDe = (schema: unknown) => ajvDoc.compile(reescreverRefs(schema) as Json);

function seguirRef<T = Json>(ref: string): T {
  expect(ref.startsWith('#/')).toBe(true);
  let atual: unknown = doc;
  for (const parte of ref.slice(2).split('/')) atual = (atual as Json)?.[parte];
  expect(atual, `$ref sem destino: ${ref}`).toBeDefined();
  return atual as T;
}

/** Toda chave do exemplo tem de existir no resultado do Zod: o Zod descarta chave desconhecida em silêncio (RN-INT-09). */
function chavesPerdidas(entrada: unknown, saida: unknown, caminho = '$'): string[] {
  if (Array.isArray(entrada)) {
    return entrada.flatMap((e, i) => chavesPerdidas(e, (saida as unknown[] | undefined)?.[i], `${caminho}[${i}]`));
  }
  if (entrada && typeof entrada === 'object') {
    const s = (saida ?? {}) as Json;
    return Object.entries(entrada).flatMap(([k, v]) => (k in s ? chavesPerdidas(v, s[k], `${caminho}.${k}`) : [`${caminho}.${k}`]));
  }
  return [];
}

function conferirNoZod(nome: string, schema: z.ZodTypeAny, valor: unknown): void {
  const r = schema.safeParse(valor);
  expect(r.success, `${nome}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
  if (r.success) expect(chavesPerdidas(valor, r.data), `${nome}: chave que o contrato não conhece`).toEqual([]);
}

describe('OpenAPI do Hub: validade (schema oficial do OpenAPI 3.1)', () => {
  it('o documento gerado é válido pelo schema oficial do OpenAPI 3.1.x', () => {
    const oficial = JSON.parse(readFileSync(ARQUIVO_SCHEMA_OFICIAL, 'utf8')) as Json;
    expect(oficial.$id).toBe('https://spec.openapis.org/oas/3.1/schema/2022-10-07');
    // Duas adaptações só no TESTE (o arquivo vendorizado fica intacto):
    // 1) o Ajv não resolve `$dynamicRef: "#meta"` quando a âncora está em `$defs` (cai na raiz e valida o Schema Object como se fosse o
    //    documento OpenAPI). O schema oficial "sem validação de schema" só exige que o Schema Object seja objeto ou booleano; trocamos o
    //    `$dynamicRef` por `$ref: #/$defs/schema` (o mesmo efeito) e validamos cada Schema Object contra o meta-schema 2020-12 no teste seguinte.
    // 2) `servers[].url` é `uri-reference` (RFC 3986), que não admite as chaves de template que a própria especificação (OAS 3.1 §4.8.5)
    //    define para variáveis de servidor: aceitamos `{variavel}` nesse formato.
    const adaptado = JSON.parse(JSON.stringify(oficial).replaceAll('{"$dynamicRef":"#meta"}', '{"$ref":"#/$defs/schema"}')) as Json;
    expect(JSON.stringify(adaptado)).not.toContain('$dynamicRef');
    const ajv = novoAjv();
    ajv.addFormat('uri-reference', /^[^\s]*$/);
    const validar = ajv.compile(adaptado);
    const ok = validar(JSON.parse(JSON.stringify(doc)));
    expect(ok, JSON.stringify(validar.errors?.slice(0, 5), null, 2)).toBe(true);
  });

  it('cada components.schemas é um JSON Schema 2020-12 válido (meta-schema) e compila', () => {
    const nomes = Object.keys(doc.components.schemas);
    expect(nomes.length).toBeGreaterThan(40);
    for (const nome of nomes) {
      expect(() => validadorDe({ $ref: `#/components/schemas/${nome}` }), nome).not.toThrow();
    }
    const ajv = novoAjv();
    for (const [nome, schema] of Object.entries(doc.components.schemas)) {
      // os $ref `#/components/...` resolvem contra a raiz deste wrapper
      expect(() => ajv.compile({ ...schema, $id: `https://exemplo.invalid/isolado/${nome}`, components: doc.components }), nome).not.toThrow();
    }
  });

  it('todo $ref do documento aponta para um destino que existe', () => {
    const refs: string[] = [];
    const varrer = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(varrer);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === '$ref') refs.push(x as string);
          else varrer(x);
        }
      }
    };
    varrer(doc);
    expect(refs.length).toBeGreaterThan(100);
    for (const r of refs) seguirRef(r);
    expect(refs.some((r) => r.includes('__macuxi__'))).toBe(false);
  });
});

describe('OpenAPI do Hub: cobertura das rotas do contrato', () => {
  it('as 7 rotas de ROTAS_HUB viram operações com operationId, resumo, status de sucesso e de erro', () => {
    expect(ROTAS_HUB).toHaveLength(7);
    for (const rota of ROTAS_HUB) {
      const op = doc.paths[rota.caminho]?.[rota.metodo.toLowerCase()] as Json | undefined;
      expect(op, `${rota.metodo} ${rota.caminho}`).toBeDefined();
      expect(op?.operationId).toBe(rota.id);
      expect(op?.summary).toBe(rota.resumo);
      const status = Object.keys(op?.responses as Json).map(Number);
      expect(status).toContain(rota.sucesso.status);
      for (const s of [...rota.erros, ...STATUS_ERRO_COMUM]) expect(status, `${rota.id}: ${s}`).toContain(s);
      expect(Boolean(op?.requestBody)).toBe(Boolean(rota.corpo));
    }
    expect(Object.values(doc.paths).flatMap((p) => Object.keys(p))).toHaveLength(7);
  });

  it('autenticação: Bearer em securityScheme global; Authorization não vira parâmetro; os outros cabeçalhos usam o nome canônico', () => {
    expect(doc.security).toEqual([{ chaveConector: [] }]);
    expect(doc.components.securitySchemes.chaveConector).toMatchObject({ type: 'http', scheme: 'bearer' });
    const nomes = Object.values(doc.components.parameters as Record<string, Json>).map((p) => p.name);
    expect(nomes.sort()).toEqual([CABECALHO_IDEMPOTENCIA, CABECALHO_CONECTOR_ID, CABECALHO_CONECTOR_VERSAO].sort());
    expect(nomes.map((n) => String(n).toLowerCase())).not.toContain('authorization');
    const lote = doc.paths['/lotes']?.post as { parameters: Json[] };
    expect(lote.parameters.map((p) => p.$ref)).toEqual([
      '#/components/parameters/ConectorId',
      '#/components/parameters/ConectorVersao',
      '#/components/parameters/IdempotencyKey',
    ]);
    const consulta = doc.paths['/lotes/{id}']?.get as { parameters: Json[] };
    expect(consulta.parameters.map((p) => p.$ref ?? p.name)).toEqual(['#/components/parameters/ConectorId', '#/components/parameters/ConectorVersao', 'id', 'limite_erros']);
    expect(seguirRef<Json>('#/components/parameters/ConectorId').required).toBe(true);
    expect(seguirRef<Json>('#/components/parameters/ConectorVersao').required).toBe(false);
    expect(seguirRef<Json>('#/components/parameters/IdempotencyKey').required).toBe(true);
  });

  it('RN-INT-12: Idempotency-Key aceita 16 a 128 caracteres seguros (mesmo padrão do contrato)', () => {
    const p = seguirRef<{ schema: { pattern: string } }>('#/components/parameters/IdempotencyKey');
    expect(new RegExp(p.schema.pattern).test('a'.repeat(15))).toBe(false);
    expect(new RegExp(p.schema.pattern).test('a'.repeat(16))).toBe(true);
    expect(new RegExp(p.schema.pattern).test('a'.repeat(129))).toBe(false);
  });

  it('o 202 do lote documenta Idempotent-Replay e X-Request-Id; 429 e 503 documentam Retry-After', () => {
    const lote = doc.paths['/lotes']?.post as { responses: Record<string, Json> };
    expect(Object.keys((lote.responses['202'] as { headers: Json }).headers)).toEqual(['X-Request-Id', 'Idempotent-Replay']);
    for (const nome of ['LimiteDeTaxa', 'ServicoIndisponivel']) {
      expect(Object.keys((doc.components.responses[nome] as { headers: Json }).headers)).toContain('Retry-After');
    }
  });

  it('o registro de cada entidade tem componente próprio e o envelope aponta para os 12', () => {
    expect(ENTIDADES).toHaveLength(12);
    const env = doc.components.schemas.LoteEnvelope as Json;
    const mapa = env['x-macuxi-registro-por-entidade'] as Record<string, { $ref: string }>;
    expect(Object.keys(mapa).sort()).toEqual([...ENTIDADES].sort());
    for (const e of ENTIDADES) seguirRef(mapa[e]?.$ref as string);
    const itens = ((env.properties as Json).registros as { items: { anyOf: { $ref: string }[] } }).items.anyOf;
    expect(itens.map((i) => i.$ref).sort()).toEqual(Object.values(mapa).map((m) => m.$ref).sort());
  });

  it('servidor com variável e produção reservada; info aponta o guia', () => {
    expect(doc.servers[0]).toMatchObject({ url: 'https://{servidor}/integracao/v1', variables: { servidor: { default: 'api-demo.macuxifdv.com.br' } } });
    expect(String(doc.info.description)).toContain('guia-api-hub.md');
    expect(doc.info.version).toBe('v1');
  });
});

describe('OpenAPI do Hub: fidelidade dos exemplos (Zod do contrato E JSON Schema gerado)', () => {
  it('cada registro de exemplo passa em SCHEMA_REGISTRO[entidade] e no componente da entidade', () => {
    for (const e of ENTIDADES) {
      conferirNoZod(`registro ${e}`, SCHEMA_REGISTRO[e], EXEMPLO_REGISTRO[e]);
      const nome = ((doc.components.schemas.LoteEnvelope as Json)['x-macuxi-registro-por-entidade'] as Record<string, { $ref: string }>)[e]?.$ref as string;
      const v = validadorDe({ $ref: nome });
      expect(v(EXEMPLO_REGISTRO[e]), `${e}: ${JSON.stringify(v.errors)}`).toBe(true);
    }
  });

  it('POST /lotes: há um exemplo por entidade, carga completa em partes e lote só com linhas inválidas; cada um passa no envelope e nos registros', () => {
    const chaves = EXEMPLOS_LOTE.map((e) => e.chave);
    for (const e of ENTIDADES) expect(chaves).toContain(e);
    expect(chaves).toEqual(expect.arrayContaining(['carga_completa_parte_1', 'carga_completa_ultima_parte', 'so_linhas_invalidas']));
    const rota = ROTAS_HUB.find((r) => r.id === 'enviar_lote');
    for (const ex of EXEMPLOS_LOTE) {
      conferirNoZod(`lote ${ex.chave}`, rota?.corpo as z.ZodTypeAny, ex.valor);
      const env = validarEnvelope(ex.valor);
      expect(env.ok, `${ex.chave}: ${JSON.stringify(env)}`).toBe(true);
      if (!env.ok) continue;
      if (ENTIDADES.includes(ex.chave as Entidade)) expect(env.envelope.entidade).toBe(ex.chave);
      for (const reg of env.envelope.registros) conferirNoZod(`registro de ${ex.chave}`, SCHEMA_REGISTRO[env.envelope.entidade], reg);
    }
    const completo = EXEMPLOS_LOTE.filter((e) => e.valor.modo === 'completo').map((e) => e.valor.sessao);
    expect(completo.map((s) => [s?.parte, s?.ultimo])).toEqual([[1, false], [2, true]]);
    expect(new Set(completo.map((s) => s?.id)).size).toBe(1);
  });

  it('corpos e sucessos de exemplo passam no Zod da rota (rota.corpo e rota.sucesso.schema)', () => {
    for (const rota of ROTAS_HUB) {
      const corpos = EXEMPLOS_CORPO[rota.id] ?? [];
      expect(corpos.length > 0, `${rota.id}: corpo`).toBe(Boolean(rota.corpo));
      for (const ex of corpos) conferirNoZod(`${rota.id} corpo ${ex.chave}`, rota.corpo as z.ZodTypeAny, ex.valor);
      const sucessos = EXEMPLOS_SUCESSO[rota.id] ?? [];
      expect(sucessos.length, `${rota.id}: sucesso`).toBeGreaterThan(0);
      for (const ex of sucessos) conferirNoZod(`${rota.id} sucesso ${ex.chave}`, rota.sucesso.schema, ex.valor);
    }
  });

  it('erros de exemplo passam em ErroHub / RecusaLote / RecusaRetorno, levam requisicao_id e usam o HTTP do contrato', () => {
    const httpPorCodigo: Record<string, number[]> = {};
    const add = (codigo: string, ...status: number[]) => ((httpPorCodigo[codigo] ??= []).push(...status));
    for (const [c, s] of Object.entries(STATUS_HTTP_ERRO_HUB)) add(c, s);
    add('envelope_invalido', 400);
    add('chave_idempotencia_invalida', 400);
    for (const c of CODIGOS_ERRO_ENVELOPE) if (!['envelope_invalido', 'chave_idempotencia_invalida', 'chave_idempotencia_reutilizada', 'corpo_grande', 'versao_conector_nao_suportada'].includes(c)) add(c, 422);
    add('chave_idempotencia_reutilizada', 409);
    for (const c of CODIGOS_RECUSA_RETORNO) add(c, 422);
    add('erro_interno', 500);

    const conferir = (nome: string, status: number, schema: z.ZodTypeAny, ex: Exemplo) => {
      conferirNoZod(`${nome} ${ex.chave}`, schema, ex.valor);
      const v = ex.valor as { codigo: string; requisicao_id?: string };
      expect(v.requisicao_id, `${nome} ${ex.chave}: requisicao_id`).toBeTruthy();
      expect(httpPorCodigo[v.codigo], `${nome} ${ex.chave}: código ${v.codigo} desconhecido`).toBeDefined();
      expect(httpPorCodigo[v.codigo], `${nome} ${ex.chave}: HTTP ${status} para ${v.codigo}`).toContain(status);
    };
    for (const rota of ROTAS_HUB) {
      for (const s of rota.erros) {
        const lista = EXEMPLOS_ERRO_ROTA[rota.id]?.[s] ?? [];
        expect(lista.length, `${rota.id} ${s}`).toBeGreaterThan(0);
        for (const ex of lista) conferir(`${rota.id} ${s}`, s, schemaDeErro(rota.id, s), ex);
      }
    }
    for (const s of STATUS_ERRO_COMUM) for (const ex of EXEMPLOS_ERRO_COMUM[s]) conferir(`comum ${s}`, s, schemaDeErro('sinal', s), ex);
    // RecusaRetorno: o código do topo é um dos códigos de recusa do retorno
    const retorno = EXEMPLOS_ERRO_ROTA.retorno_pedido?.[422] ?? [];
    for (const ex of retorno) expect(CODIGOS_RECUSA_RETORNO).toContain((ex.valor as { codigo: never }).codigo);
  });

  it('todo exemplo publicado no documento passa no JSON Schema gerado (Ajv 2020-12): corpos, respostas, erros e parâmetros', () => {
    let total = 0;
    const conferirMidia = (onde: string, midia: Json): void => {
      const schema = midia.schema;
      const v = validadorDe(schema);
      const exemplos = (midia.examples ?? {}) as Record<string, { value: unknown }>;
      expect(Object.keys(exemplos).length, `${onde}: sem exemplos`).toBeGreaterThan(0);
      for (const [chave, e] of Object.entries(exemplos)) {
        total++;
        expect(v(e.value), `${onde} / ${chave}: ${JSON.stringify(v.errors?.slice(0, 3))}`).toBe(true);
      }
    };
    for (const [caminho, item] of Object.entries(doc.paths)) {
      for (const [metodo, op] of Object.entries(item) as [string, Json][]) {
        const onde = `${metodo.toUpperCase()} ${caminho}`;
        if (op.requestBody) conferirMidia(`${onde} corpo`, (op.requestBody as { content: Record<string, Json> }).content['application/json'] as Json);
        for (const [status, r] of Object.entries(op.responses as Record<string, Json>)) {
          const resp = (r.$ref ? seguirRef(r.$ref as string) : r) as { content: Record<string, Json> };
          conferirMidia(`${onde} ${status}`, resp.content['application/json'] as Json);
        }
        for (const p of op.parameters as Json[]) {
          const param = (p.$ref ? seguirRef(p.$ref as string) : p) as { example?: unknown; schema: unknown; name: string };
          if (param.example !== undefined) {
            total++;
            const v = validadorDe(param.schema);
            expect(v(param.example), `${onde} parâmetro ${param.name}`).toBe(true);
          }
        }
      }
    }
    expect(total).toBeGreaterThan(60);
  });

  it('o conversor é fiel nos dois sentidos: valores inválidos são recusados pelo Zod E pelo JSON Schema', () => {
    const ok = EXEMPLOS_LOTE[0]?.valor as Json;
    const reg = EXEMPLO_REGISTRO;
    const casos: { schema: string; zod: z.ZodTypeAny; valor: unknown; valido: boolean }[] = [
      { schema: 'LoteEnvelope', zod: ROTAS_HUB[0]?.corpo as z.ZodTypeAny, valor: ok, valido: true },
      { schema: 'LoteEnvelope', zod: ROTAS_HUB[0]?.corpo as z.ZodTypeAny, valor: { ...ok, registros: undefined }, valido: false },
      { schema: 'LoteEnvelope', zod: ROTAS_HUB[0]?.corpo as z.ZodTypeAny, valor: { ...ok, modo: 'parcial' }, valido: false },
      { schema: 'LoteEnvelope', zod: ROTAS_HUB[0]?.corpo as z.ZodTypeAny, valor: { ...ok, versao_contrato: '' }, valido: false },
      { schema: 'LoteEnvelope', zod: ROTAS_HUB[0]?.corpo as z.ZodTypeAny, valor: { ...ok, sessao: { id: 'x', parte: 0, ultimo: true } }, valido: false },
      { schema: 'LoteEnvelope', zod: ROTAS_HUB[0]?.corpo as z.ZodTypeAny, valor: { ...ok, campo_novo_do_futuro: 1 }, valido: true },
      { schema: 'VendedorPayload', zod: SCHEMA_REGISTRO.vendedor, valor: { ...reg.vendedor, external_id: '' }, valido: false },
      { schema: 'VendedorPayload', zod: SCHEMA_REGISTRO.vendedor, valor: { ...reg.vendedor, external_id: 'x'.repeat(201) }, valido: false },
      { schema: 'VendedorPayload', zod: SCHEMA_REGISTRO.vendedor, valor: { ...reg.vendedor, alterado_em: '2026-11-05T13:45:10-03:00' }, valido: false },
      { schema: 'VendedorPayload', zod: SCHEMA_REGISTRO.vendedor, valor: { ...reg.vendedor, alterado_em: '2026-11-05' }, valido: false },
      { schema: 'VendedorPayload', zod: SCHEMA_REGISTRO.vendedor, valor: { ...reg.vendedor, ativo: 'sim' }, valido: false },
      { schema: 'ClientePayload', zod: SCHEMA_REGISTRO.cliente, valor: { ...reg.cliente, limite_credito_cents: 10.5 }, valido: false },
      { schema: 'ClientePayload', zod: SCHEMA_REGISTRO.cliente, valor: { ...reg.cliente, limite_credito_cents: -1 }, valido: false },
      { schema: 'ClientePayload', zod: SCHEMA_REGISTRO.cliente, valor: { ...reg.cliente, latitude: 91 }, valido: false },
      { schema: 'ClientePayload', zod: SCHEMA_REGISTRO.cliente, valor: { ...reg.cliente, vendedor_external_id: null, endereco: null, contatos: [] }, valido: true },
      { schema: 'ProdutoPayload', zod: SCHEMA_REGISTRO.produto, valor: { ...reg.produto, ean: '123' }, valido: false },
      { schema: 'ProdutoPayload', zod: SCHEMA_REGISTRO.produto, valor: { ...reg.produto, embalagem_quantidade: 1 }, valido: false },
      { schema: 'ProdutoUnidadePayload', zod: SCHEMA_REGISTRO.produto_unidade, valor: { ...reg.produto_unidade, fator: 0 }, valido: false },
      { schema: 'ProdutoUnidadePayload', zod: SCHEMA_REGISTRO.produto_unidade, valor: { ...reg.produto_unidade, unidade: 'CAIXA1' }, valido: false },
      { schema: 'TituloPayload', zod: SCHEMA_REGISTRO.titulo, valor: { ...reg.titulo, situacao: 'pago' }, valido: false },
      { schema: 'RotaPayload', zod: SCHEMA_REGISTRO.rota, valor: { ...reg.rota, dia_semana: 7 }, valido: false },
      { schema: 'RotaPayload', zod: SCHEMA_REGISTRO.rota, valor: { ...reg.rota, paradas: [{ ordem: 0, cliente_external_id: 'C1' }] }, valido: false },
      { schema: 'ClienteEnderecoPayload', zod: SCHEMA_REGISTRO.cliente_endereco, valor: { ...reg.cliente_endereco, uf: 'RRR' }, valido: false },
    ];
    for (const c of casos) {
      const zod = c.zod.safeParse(c.valor).success;
      const ajv = validadorDe({ $ref: `#/components/schemas/${c.schema}` })(c.valor);
      expect({ caso: `${c.schema} ${JSON.stringify(c.valor).slice(0, 80)}`, zod }).toEqual({ caso: `${c.schema} ${JSON.stringify(c.valor).slice(0, 80)}`, zod: c.valido });
      expect({ caso: `${c.schema} ${JSON.stringify(c.valor).slice(0, 80)}`, ajv }).toEqual({ caso: `${c.schema} ${JSON.stringify(c.valor).slice(0, 80)}`, ajv: c.valido });
    }
  });

  it('retorno do ERP: o JSON Schema aceita o que o Zod aceita nos campos individuais; a regra cruzada (numero_erp, motivo, nota) fica só no Zod e na descrição', () => {
    const rota = ROTAS_HUB.find((r) => r.id === 'retorno_pedido');
    const base = { versao_contrato: 'v1', pedido_uuid: '3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c', ocorrido_em: '2026-11-05T14:02:00Z' };
    const v = validadorDe({ $ref: '#/components/schemas/RetornoErp' });
    expect(v({ ...base, status: 'foo' })).toBe(false);
    expect(rota?.corpo?.safeParse({ ...base, status: 'foo' }).success).toBe(false);
    const semNumero = { ...base, status: 'integrado' };
    expect(rota?.corpo?.safeParse(semNumero).success).toBe(false);
    expect(v(semNumero)).toBe(true); // JSON Schema não expressa a regra cruzada
    expect(String((doc.components.schemas.RetornoErp as Json).description)).toContain('`numero_erp` obrigatório');
    const itens = { ...base, status: 'faturado_parcial', numero_erp: 'PV-1', itens_faturados: [] };
    expect(rota?.corpo?.safeParse(itens).success).toBe(false);
    expect(v(itens)).toBe(false); // minItems: 1
  });

  it('saída: campos com default aparecem como obrigatórios nas respostas (obsoletas, inativadas, tentativa, desconto)', () => {
    const s = doc.components.schemas as Record<string, Json>;
    expect(s.ContagensLote?.required).toContain('obsoletas');
    expect(s.LoteResultado?.required).toContain('inativadas');
    expect(s.PedidoParaErp?.required).toEqual(expect.arrayContaining(['tentativa', 'desconto_total_cents']));
    expect(s.ItemPedidoErp?.required).toContain('desconto_cents');
    // e opcionais na entrada
    expect(s.ClientePayload?.required).not.toContain('bloqueado');
    expect(s.VendedorPayload?.required).not.toContain('ativo');
  });
});

describe('OpenAPI do Hub: arquivo publicado', () => {
  it('docs/openapi-hub-v1.json é igual ao documento gerado (regerar: pnpm --filter @macuxi/integracao openapi)', () => {
    if (process.env.ATUALIZAR_OPENAPI === '1') writeFileSync(ARQUIVO_PUBLICADO, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    const publicado = JSON.parse(readFileSync(ARQUIVO_PUBLICADO, 'utf8')) as unknown;
    expect(publicado, 'o OpenAPI publicado está desatualizado: rode "pnpm --filter @macuxi/integracao openapi"').toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it('a geração é determinística (duas execuções, mesmo documento)', () => {
    expect(JSON.stringify(gerarOpenApiHub())).toBe(JSON.stringify(doc));
  });
});
