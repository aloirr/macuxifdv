/**
 * T-0108: o cliente de exemplo em Node (`cliente-hub.mjs`) contra o Hub simulado (`../simulador/hub-simulado.mjs`).
 * Cada corpo enviado e cada resposta do simulador são validados contra os schemas do OpenAPI publicado (Ajv 2020-12, mesmo padrão
 * de `api/openapi/openapi.test.ts`), então o kit do TI não deriva do contrato.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos (kit do TI em Node puro)
import { criarHubSimulado } from '../simulador/hub-simulado.mjs';
// @ts-expect-error módulo .mjs sem tipos (kit do TI em Node puro)
import { ClienteHub, ErroHub, RecusaLoteErro, chaveIdempotencia, compararCursor, lerConfig } from './cliente-hub.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Json = Record<string, any>;
type Registro = { metodo: string; caminho: string; consulta: string; cabecalhos: Record<string, string>; corpo?: any; status: number; resposta?: any; cabecalhosResposta: Record<string, string> };

const executar = promisify(execFile);
const CLIENTE = fileURLToPath(new URL('./cliente-hub.mjs', import.meta.url));
const doc = JSON.parse(readFileSync(fileURLToPath(new URL('../../openapi-hub-v1.json', import.meta.url)), 'utf8')) as Json;

const URN = 'urn:macuxi:openapi-hub';
function reescreverRefs(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reescreverRefs);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === '$ref' && typeof x === 'string' && x.startsWith('#/') ? `${URN}${x}` : reescreverRefs(x)]));
  }
  return v;
}
const ajv = new Ajv2020({ strict: false, allErrors: true, formats: { 'media-range': true } });
addFormats(ajv);
ajv.addSchema({ $id: URN, components: doc.components });
const validadores = new Map<string, ReturnType<typeof ajv.compile>>();
function validar(schema: string, valor: unknown, onde: string): void {
  let v = validadores.get(schema);
  if (!v) {
    v = ajv.compile(reescreverRefs({ $ref: `#/components/schemas/${schema}` }) as Json);
    validadores.set(schema, v);
  }
  expect(v(valor), `${onde} deve obedecer ${schema}: ${JSON.stringify(v.errors?.slice(0, 3))}`).toBe(true);
}

const envBase = (hub: { url: string; chave: string }, extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? '',
  MACUXI_HUB_URL: hub.url,
  MACUXI_CHAVE: hub.chave,
  MACUXI_INTERVALO_MS: '5',
  ...extra,
});
const rodarCli = async (hub: { url: string; chave: string }) => {
  const r = await executar(process.execPath, [CLIENTE], { env: envBase(hub), timeout: 20_000 });
  return r.stdout;
};
const novoCliente = (hub: { url: string; chave: string }, extra: Json = {}) =>
  new ClienteHub({ url: hub.url, chave: hub.chave, conectorId: 'erp-matriz', intervaloMs: 1, ...extra });
const postLotes = (hub: { estado: { requisicoes: Registro[] } }) => hub.estado.requisicoes.filter((r) => r.metodo === 'POST' && r.caminho === '/lotes');

describe('cliente-hub.mjs contra o Hub simulado: execução completa da demonstração', () => {
  const hub = criarHubSimulado();
  let saida1 = '';
  let requisicoesDaPrimeira: Registro[] = [];

  beforeAll(async () => {
    await hub.iniciar(0);
    saida1 = await rodarCli(hub); // lança se a saída não for 0
    requisicoesDaPrimeira = [...hub.estado.requisicoes];
  });
  afterAll(async () => {
    await hub.parar();
  });

  it('sai com 0, consulta o cursor antes de enviar e nunca imprime a chave', () => {
    expect(saida1).toContain('Concluído.');
    expect(saida1).not.toContain(hub.chave);
    const primeira = requisicoesDaPrimeira[0];
    expect(`${primeira.metodo} ${primeira.caminho}`).toBe('GET /cursores/produto');
    expect(primeira.resposta).toEqual({ entidade: 'produto', cursor: null, atualizado_em: null });
  });

  it('cursor nulo: carga completa em partes da mesma sessão (parte 1..n, ultimo só na última), cursor do Hub no maior par', () => {
    const produtos = postLotes(hub).filter((r) => r.corpo.entidade === 'produto');
    expect(produtos).toHaveLength(3);
    const sessoes = produtos.map((r) => r.corpo.sessao);
    expect(new Set(sessoes.map((s) => s.id)).size).toBe(1);
    expect(sessoes.map((s) => s.parte)).toEqual([1, 2, 3]);
    expect(sessoes.map((s) => s.ultimo)).toEqual([false, false, true]);
    for (const r of produtos) expect(r.corpo.modo).toBe('completo');
    expect(hub.estado.cursores.get('produto').cursor).toEqual({ alterado_em: '2026-11-05T13:43:10Z', external_id: 'P000007' });
  });

  it('Idempotency-Key no formato do contrato e igual ao SHA-256 das partes estáveis do corpo', () => {
    for (const r of postLotes(hub)) {
      const chave = r.cabecalhos['idempotency-key'];
      expect(chave).toMatch(/^[A-Za-z0-9._:-]{16,128}$/);
      expect(chave).toBe(chaveIdempotencia(r.corpo));
    }
    // enviado_em/cursor/conector_id/versao_conector não entram: remontar o lote não muda a chave
    const base = postLotes(hub)[0].corpo;
    expect(chaveIdempotencia({ ...base, enviado_em: '2030-01-01T00:00:00Z', cursor: null, conector_id: 'outro', versao_conector: '9.9.9' })).toBe(chaveIdempotencia(base));
    expect(chaveIdempotencia({ ...base, registros: [] })).not.toBe(chaveIdempotencia(base));
  });

  it('delta de preços: um lote com erros por linha (referência ausente reprocessável × valor negativo que o cliente não envia)', () => {
    const lote = postLotes(hub).find((r) => r.corpo.entidade === 'preco');
    expect(lote?.corpo.modo).toBe('delta');
    expect(lote?.corpo.sessao).toBeUndefined();
    expect(lote?.corpo.registros.map((r: Json) => r.external_id)).toEqual(['TAB01:P000099', 'TAB01:P000001', 'TAB01:P000002', 'TAB01:P000003']);
    expect(lote?.corpo.linhas_invalidas).toEqual([{ external_id: 'TAB01:P000098', codigo: 'valor_fora_da_faixa', campo: 'preco_cents', mensagem: expect.any(String) }]);
    const idLote = lote?.resposta.lote_id as string;
    const resultado = hub.estado.lotes.get(idLote).resultado;
    expect(resultado.status).toBe('concluido_com_erros');
    expect(resultado.erros.map((e: Json) => [e.external_id, e.codigo, e.reprocessavel, e.origem])).toEqual([
      ['TAB01:P000099', 'referencia_ausente', true, 'hub'],
      ['TAB01:P000098', 'valor_fora_da_faixa', false, 'conector'],
    ]);
    expect(saida1).toContain('reprocessável  TAB01:P000099 referencia_ausente');
    expect(saida1).toContain('corrigir no ERP TAB01:P000098 valor_fora_da_faixa');
    // o cursor do preço não passou pela linha com erro: é o maior par aceito
    expect(hub.estado.cursores.get('preco').cursor).toEqual({ alterado_em: '2026-11-05T13:43:10Z', external_id: 'TAB01:P000003' });
  });

  it('reenvio do mesmo lote: 202 com repetido=true, Idempotent-Replay e o mesmo lote_id; e a recusa de lote vazio (422) não cria lote', () => {
    const preco = postLotes(hub).filter((r) => r.corpo.entidade === 'preco');
    expect(preco).toHaveLength(2);
    const [original, reenvio] = preco;
    expect(reenvio.cabecalhos['idempotency-key']).toBe(original.cabecalhos['idempotency-key']);
    expect(reenvio.status).toBe(202);
    expect(reenvio.resposta).toMatchObject({ repetido: true, lote_id: original.resposta.lote_id });
    expect(reenvio.cabecalhosResposta['idempotent-replay']).toBe('true');
    expect(original.resposta.repetido).toBeUndefined();

    const vazio = postLotes(hub).at(-1) as Registro;
    expect(vazio.status).toBe(422);
    expect(vazio.resposta.codigo).toBe('lote_vazio');
    expect(saida1).toContain('RecusaLote 422 lote_vazio');
    expect(hub.estado.lotes.size).toBe(4); // 3 partes de produto + 1 de preço; o replay e o vazio não criaram lote
  });

  it('devolução de pedido: retorno integrado com numero_erp, uma vez só, e a fila fica vazia', () => {
    const retornos = hub.estado.requisicoes.filter((r: Registro) => r.caminho.endsWith('/retorno'));
    expect(retornos).toHaveLength(1);
    expect(retornos[0].corpo).toMatchObject({ versao_contrato: 'v1', pedido_uuid: '3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c', status: 'integrado', numero_erp: 'PV-004512' });
    expect(retornos[0].resposta).toEqual({ pedido_uuid: '3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c', status: 'integrado', repetido: false });
    expect(hub.estado.pedidos.get('3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c')).toMatchObject({ estado: 'integrado', tentativa: 1 });
    const buscas = hub.estado.requisicoes.filter((r: Registro) => r.caminho === '/pedidos/pendentes');
    expect(buscas).toHaveLength(2); // uma rodada com pedido e a que veio vazia
    expect(buscas[1].resposta).toEqual({ pedidos: [] });
  });

  it('todo corpo enviado e toda resposta do simulador obedecem aos schemas do OpenAPI', () => {
    const lotes = hub.estado.requisicoes as Registro[];
    let conferidos = 0;
    for (const r of lotes) {
      const onde = `${r.metodo} ${r.caminho}${r.consulta}`;
      if (r.metodo === 'POST' && r.caminho === '/lotes') {
        validar('LoteEnvelope', r.corpo, `${onde} corpo`);
        validar(r.status === 202 ? 'LoteAceito' : 'RecusaLote', r.resposta, `${onde} resposta ${r.status}`);
      } else if (r.caminho.startsWith('/lotes/')) {
        validar('LoteResultado', r.resposta, `${onde} resposta`);
      } else if (r.caminho.startsWith('/cursores/')) {
        validar('CursorEntidade', r.resposta, `${onde} resposta`);
      } else if (r.caminho === '/pedidos/pendentes') {
        validar('PedidosPendentes', r.resposta, `${onde} resposta`);
      } else if (r.caminho.endsWith('/retorno')) {
        validar('RetornoErp', r.corpo, `${onde} corpo`);
        validar('RetornoAceito', r.resposta, `${onde} resposta`);
      } else {
        throw new Error(`rota inesperada na demonstração: ${onde}`);
      }
      expect(r.cabecalhosResposta['x-request-id'], `${onde}: X-Request-Id`).toMatch(/^req-/);
      conferidos += 1;
    }
    expect(conferidos).toBeGreaterThanOrEqual(15);
  });

  it('segunda execução contra o mesmo Hub usa delta (cursor existente) e não reenvia o que já foi', async () => {
    const lotesAntes = hub.estado.lotes.size;
    const postsAntes = postLotes(hub).length;
    const saida2 = await rodarCli(hub);
    expect(saida2).toContain('só o delta');
    expect(saida2).toContain('nada novo desde o cursor: nenhum lote enviado');
    expect(saida2).toContain('nenhum pedido pendente');
    expect(hub.estado.lotes.size).toBe(lotesAntes);
    // a única chamada a POST /lotes é a recusa inofensiva de lote vazio (422), que não cria lote
    const novos = postLotes(hub).slice(postsAntes);
    expect(novos.map((r) => r.status)).toEqual([422]);
    expect(novos[0].resposta.codigo).toBe('lote_vazio');
  });
});

describe('cliente-hub.mjs: repetição, recusa e configuração', () => {
  const hub = criarHubSimulado();
  beforeAll(() => hub.iniciar(0));
  afterAll(() => hub.parar());

  const envelopeVendedor = (extra: Json = {}) => ({
    versao_contrato: 'v1',
    entidade: 'vendedor',
    modo: 'delta',
    registros: [{ external_id: 'V001', alterado_em: '2026-11-05T13:45:10Z', ativo: true, nome: 'Vendedor Exemplo' }],
    ...extra,
  });

  it('503 transitório: repete com a MESMA Idempotency-Key esperando o Retry-After, e o lote é criado uma única vez', async () => {
    const esperas: number[] = [];
    const cliente = novoCliente(hub, { esperar: async (ms: number) => void esperas.push(ms) });
    const antes = hub.estado.requisicoes.length;
    hub.definirFalhasTransitorias(2);
    const envio = await cliente.enviarLote(envelopeVendedor());
    const posts = hub.estado.requisicoes.slice(antes).filter((r: Registro) => r.caminho === '/lotes');
    expect(posts.map((r: Registro) => r.status)).toEqual([503, 503, 202]);
    expect(new Set(posts.map((r: Registro) => r.cabecalhos['idempotency-key'])).size).toBe(1);
    expect(posts[0].cabecalhos['idempotency-key']).toBe(envio.chave);
    expect(posts[0].cabecalhosResposta['retry-after']).toBe('1');
    expect(esperas).toEqual([1000, 1000]);
    expect(envio.repetido).toBe(false);
    expect([...hub.estado.lotes.values()].filter((l: Json) => l.chave === envio.chave)).toHaveLength(1);
  });

  it('desiste depois de maxTentativas e devolve o ErroHub do último 503', async () => {
    const cliente = novoCliente(hub, { maxTentativas: 3, esperar: async () => {} });
    hub.definirFalhasTransitorias(10);
    await expect(cliente.consultarCursor('produto')).rejects.toMatchObject({ status: 503, codigo: 'servico_indisponivel' });
    hub.definirFalhasTransitorias(0);
  });

  it('carga completa sem sessao: RecusaLoteErro com erros[0].codigo sessao_ausente e uma única requisição (não repete)', async () => {
    const cliente = novoCliente(hub, { esperar: async () => {} });
    const antes = hub.estado.requisicoes.length;
    const erro = await cliente.enviarLote(envelopeVendedor({ modo: 'completo' })).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(RecusaLoteErro);
    expect(erro).toBeInstanceOf(ErroHub);
    expect(erro.status).toBe(422);
    expect(erro.codigo).toBe('sessao_ausente');
    expect(erro.erros[0].codigo).toBe('sessao_ausente');
    expect(erro.requisicao_id).toMatch(/^req-/);
    expect(hub.estado.requisicoes.length - antes).toBe(1);
  });

  it('mesma chave com conteúdo diferente: 409 chave_idempotencia_reutilizada, sem repetição', async () => {
    const cliente = novoCliente(hub, { esperar: async () => {} });
    const a = envelopeVendedor({ registros: [{ external_id: 'V777', alterado_em: '2026-11-05T13:45:10Z', nome: 'A' }] });
    const { chave } = await cliente.enviarLote(a);
    // força a reutilização da chave com outro conteúdo, chamando a rota por baixo do enviarLote
    const r = await cliente.requisitar('POST', '/lotes', {
      corpo: envelopeVendedor({ registros: [{ external_id: 'V778', alterado_em: '2026-11-05T13:45:10Z', nome: 'B' }] }),
      cabecalhos: { 'Idempotency-Key': chave },
    });
    expect(r.status).toBe(409);
    expect(r.corpo.codigo).toBe('chave_idempotencia_reutilizada');
  });

  it('compararCursor: instante primeiro, depois external_id em ordem de bytes', () => {
    const c = (alterado_em: string, external_id: string) => ({ alterado_em, external_id });
    expect(compararCursor(c('2026-11-05T13:00:00Z', 'Z'), c('2026-11-05T14:00:00Z', 'A'))).toBeLessThan(0);
    expect(compararCursor(c('2026-11-05T10:00:00-03:00', 'A'), c('2026-11-05T13:00:00Z', 'A'))).toBe(0); // mesmo instante
    expect(compararCursor(c('2026-11-05T13:00:00Z', 'B'), c('2026-11-05T13:00:00Z', 'a'))).toBeLessThan(0); // 'B' (0x42) < 'a' (0x61) em bytes
    expect(compararCursor(c('2026-11-05T13:00:00Z', 'P2'), c('2026-11-05T13:00:00Z', 'P10'))).toBeGreaterThan(0);
  });

  it('configuração: HTTPS obrigatório (exceto localhost), formato da chave validado e a chave nunca aparece na mensagem', () => {
    const chaveOk = `mxc_${'a'.repeat(43)}`;
    expect(() => lerConfig({ MACUXI_HUB_URL: 'http://api.exemplo.com.br/integracao/v1', MACUXI_CHAVE: chaveOk })).toThrow(/https/);
    expect(lerConfig({ MACUXI_HUB_URL: 'http://127.0.0.1:8787/integracao/v1/', MACUXI_CHAVE: chaveOk }).url).toBe('http://127.0.0.1:8787/integracao/v1');
    const ruim = 'mxc_curta-demais-SEGREDO';
    let mensagem = '';
    try {
      lerConfig({ MACUXI_CHAVE: ruim });
    } catch (e) {
      mensagem = (e as Error).message;
    }
    expect(mensagem).toMatch(/MACUXI_CHAVE/);
    expect(mensagem).not.toContain('SEGREDO');
    const padrao = lerConfig({ MACUXI_CHAVE: chaveOk });
    expect(padrao).toMatchObject({ url: 'https://api-demo.macuxifdv.com.br/integracao/v1', conectorId: 'erp-matriz', intervaloMs: 5000, conectorVersao: undefined });
  });

  it('X-Macuxi-Conector-Versao só é enviado quando informado', async () => {
    const sem = novoCliente(hub);
    const com = novoCliente(hub, { conectorVersao: '1.2.1' });
    const antes = hub.estado.requisicoes.length;
    await sem.consultarCursor('produto');
    await com.consultarCursor('produto');
    const [r1, r2] = hub.estado.requisicoes.slice(antes) as Registro[];
    expect(r1.cabecalhos['x-macuxi-conector-versao']).toBeUndefined();
    expect(r2.cabecalhos['x-macuxi-conector-versao']).toBe('1.2.1');
    expect(JSON.stringify(sem)).not.toContain(hub.chave);
    expect(JSON.stringify(hub.estado.requisicoes)).not.toContain(hub.chave);
  });
});
