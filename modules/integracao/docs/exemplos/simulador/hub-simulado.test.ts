/**
 * T-0108: o Hub simulado do kit do TI se comporta como o guia da API em PDF descreve: autenticação, idempotência,
 * recusas de envelope, processamento do lote, erros por linha, cursor e devolução de pedidos.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos (kit do TI em Node puro)
import { chaveTemFormatoValido, criarHubSimulado, gerarChaveFicticia } from './hub-simulado.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */

const hub = criarHubSimulado();
let base = '';
const PEDIDO = '3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c';

beforeAll(async () => {
  base = await hub.iniciar(0);
});
afterAll(() => hub.parar());

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
async function chamar(metodo: string, caminho: string, corpo?: unknown, cab: Record<string, string> = {}) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${hub.chave}`, 'X-Macuxi-Conector-Id': hub.conectorId, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...cab },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  return { status: r.status, cab: r.headers, corpo: texto ? (JSON.parse(texto) as any) : null };
}
const reg = (id: string, extra: Record<string, unknown> = {}, quando = '2026-11-05T13:45:10Z') => ({ external_id: id, alterado_em: quando, ativo: true, ...extra });
const env = (entidade: string, registros: unknown[], extra: Record<string, unknown> = {}) => ({ versao_contrato: 'v1', entidade, modo: 'delta', registros, ...extra });
async function enviar(envelope: Record<string, unknown>, chave = sha(JSON.stringify(envelope) + randomUUID())) {
  return chamar('POST', '/lotes', envelope, { 'Idempotency-Key': chave });
}
async function concluir(loteId: string) {
  let r = await chamar('GET', `/lotes/${loteId}`);
  const vistos = [r.corpo.status];
  while (!['concluido', 'concluido_com_erros', 'falhou'].includes(r.corpo.status)) {
    r = await chamar('GET', `/lotes/${loteId}`);
    vistos.push(r.corpo.status);
  }
  return { ...r, vistos };
}

describe('Hub simulado: autenticação e cabeçalhos', () => {
  it('401 credencial_invalida com chave errada ou Conector de outro identificador; X-Request-Id em toda resposta', async () => {
    const a = await fetch(`${base}/cursores/produto`, { headers: { Authorization: `Bearer ${gerarChaveFicticia()}`, 'X-Macuxi-Conector-Id': hub.conectorId } });
    expect(a.status).toBe(401);
    expect(((await a.json()) as any).codigo).toBe('credencial_invalida');
    expect(a.headers.get('x-request-id')).toMatch(/^req-/);
    const b = await fetch(`${base}/cursores/produto`, { headers: { Authorization: `Bearer ${hub.chave}`, 'X-Macuxi-Conector-Id': 'outro' } });
    expect(b.status).toBe(401);
    const ok = await chamar('GET', '/cursores/produto');
    expect(ok.status).toBe(200);
    expect(ok.cab.get('x-request-id')).toMatch(/^req-/);
  });

  it('a chave fictícia tem o formato real (mxc_ + 43 base64url)', () => {
    expect(chaveTemFormatoValido(hub.chave)).toBe(true);
    expect(hub.chave).toMatch(/^mxc_[A-Za-z0-9_-]{43}$/);
  });
});

describe('Hub simulado: recusas de envelope (nenhum lote é criado)', () => {
  const casos: [string, () => Promise<{ status: number; corpo: any }>, number, string][] = [
    ['Idempotency-Key ausente', () => chamar('POST', '/lotes', env('vendedor', [reg('V1')])), 400, 'chave_idempotencia_invalida'],
    ['Idempotency-Key curta', () => chamar('POST', '/lotes', env('vendedor', [reg('V1')]), { 'Idempotency-Key': 'curta' }), 400, 'chave_idempotencia_invalida'],
    ['completo sem sessao', () => enviar(env('vendedor', [reg('V1')], { modo: 'completo' })), 422, 'sessao_ausente'],
    ['delta com sessao', () => enviar(env('vendedor', [reg('V1')], { sessao: { id: randomUUID(), parte: 1, ultimo: true } })), 422, 'sessao_nao_se_aplica'],
    ['lote vazio', () => enviar(env('vendedor', [])), 422, 'lote_vazio'],
    ['acima de 5.000', () => enviar(env('vendedor', Array.from({ length: 5001 }, (_, i) => reg(`V${i}`)))), 422, 'acima_do_limite'],
    ['entidade desconhecida', () => enviar(env('foguete', [reg('X')])), 422, 'entidade_desconhecida'],
    ['versão não suportada', () => enviar({ ...env('vendedor', [reg('V1')]), versao_contrato: 'v9' }), 422, 'versao_nao_suportada'],
    ['modo inválido', () => enviar({ ...env('vendedor', [reg('V1')]), modo: 'parcial' }), 400, 'envelope_invalido'],
  ];
  for (const [nome, chamada, status, codigo] of casos) {
    it(`${nome}: ${status} ${codigo} no formato RecusaLote`, async () => {
      const antes = hub.estado.lotes.size;
      const r = await chamada();
      expect(r.status).toBe(status);
      expect(r.corpo.codigo).toBe(codigo);
      expect(r.corpo.erros[0].codigo).toBe(codigo);
      expect(r.corpo.mensagem).toEqual(expect.any(String));
      expect(r.corpo.requisicao_id).toMatch(/^req-/);
      expect(hub.estado.lotes.size).toBe(antes);
    });
  }

  it('lote só com linhas inválidas (registros vazios) é aceito', async () => {
    const r = await enviar(env('cliente', [], { linhas_invalidas: [{ external_id: 'C999', codigo: 'campo_obrigatorio', campo: 'razao_social', mensagem: 'razao_social está vazio no ERP.' }] }));
    expect(r.status).toBe(202);
  });
});

describe('Hub simulado: idempotência por lote', () => {
  it('mesma chave e mesmo conteúdo: 202 repetido com o mesmo lote_id e Idempotent-Replay; conteúdo diferente: 409', async () => {
    const envelope = env('vendedor', [reg('V100', { nome: 'A' })]);
    const chave = sha('chave-do-teste-de-idempotencia');
    const primeiro = await enviar(envelope, chave);
    expect(primeiro.status).toBe(202);
    expect(primeiro.corpo).toMatchObject({ status: 'recebido', entidade: 'vendedor', modo: 'delta', recebidos: 1 });
    expect(primeiro.corpo.consulta).toBe(`/integracao/v1/lotes/${primeiro.corpo.lote_id}`);
    expect(primeiro.corpo.repetido).toBeUndefined();
    // enviado_em e conector_id não contam para a chave
    const repetido = await enviar({ ...envelope, enviado_em: '2026-11-06T00:00:00Z', conector_id: 'qualquer' }, chave);
    expect(repetido.status).toBe(202);
    expect(repetido.corpo).toMatchObject({ lote_id: primeiro.corpo.lote_id, repetido: true });
    expect(repetido.cab.get('idempotent-replay')).toBe('true');
    const diferente = await enviar(env('vendedor', [reg('V100', { nome: 'B' })]), chave);
    expect(diferente.status).toBe(409);
    expect(diferente.corpo.codigo).toBe('chave_idempotencia_reutilizada');
    expect(diferente.corpo.erros).toHaveLength(1);
  });
});

describe('Hub simulado: processamento do lote, erros por linha e cursor', () => {
  it('GET /lotes/{id} passa por processando; o cursor só avança quando o lote termina; entidade desconhecida no cursor é 404', async () => {
    expect((await chamar('GET', '/cursores/estoque')).corpo).toEqual({ entidade: 'estoque', cursor: null, atualizado_em: null });
    expect((await chamar('GET', '/cursores/foguete')).status).toBe(404);
    const aceito = await enviar(env('produto', [reg('P1', { sku: 'A', nome: 'Um', unidade: 'UN' }, '2026-11-05T10:00:00Z'), reg('P2', { sku: 'B', nome: 'Dois', unidade: 'UN' }, '2026-11-05T11:00:00Z')]));
    expect((await chamar('GET', '/cursores/produto')).corpo.cursor).toBeNull(); // recebido: ainda não avançou
    const fim = await concluir(aceito.corpo.lote_id);
    expect(fim.vistos).toEqual(['processando', 'concluido']);
    expect(fim.corpo.contagens).toMatchObject({ recebidas: 2, novas: 2, com_erro: 0 });
    expect((await chamar('GET', '/cursores/produto')).corpo.cursor).toEqual({ alterado_em: '2026-11-05T11:00:00Z', external_id: 'P2' });
  });

  it('inalterada, atualizada e obsoleta (alterado_em menor); duplicado no lote vale a última ocorrência', async () => {
    const lote = await concluir(
      (
        await enviar(
          env('produto', [
            reg('P1', { sku: 'A', nome: 'Um', unidade: 'UN' }, '2026-11-05T10:00:00Z'), // igual
            reg('P2', { sku: 'B', nome: 'Dois NOVO', unidade: 'UN' }, '2026-11-05T12:00:00Z'), // atualizada
            reg('P3', { sku: 'C', nome: 'Tres', unidade: 'UN' }, '2026-11-05T09:00:00Z'),
            reg('P3', { sku: 'C', nome: 'Tres v2', unidade: 'UN' }, '2026-11-05T09:30:00Z'), // vale esta
          ]),
        )
      ).corpo.lote_id,
    );
    expect(fim(lote).contagens).toEqual({ recebidas: 4, duplicadas_no_lote: 1, com_erro: 0, novas: 1, atualizadas: 1, inalteradas: 1, obsoletas: 0 });
    expect(fim(lote).avisos[0]).toMatchObject({ codigo: 'duplicado_no_lote', external_id: 'P3' });
    const velho = await concluir((await enviar(env('produto', [reg('P2', { sku: 'B', nome: 'Antigo', unidade: 'UN' }, '2026-11-05T08:00:00Z')]))).corpo.lote_id);
    expect(fim(velho).contagens.obsoletas).toBe(1);
    expect((await chamar('GET', '/cursores/produto')).corpo.cursor).toEqual({ alterado_em: '2026-11-05T12:00:00Z', external_id: 'P2' }); // o cursor não recua
  });

  it('erros por linha: referencia_ausente (reprocessável), valor_fora_da_faixa (não reprocessável) e linhas_invalidas com origem conector', async () => {
    const aceito = await enviar(
      env(
        'preco',
        [
          reg('TAB01:P1', { produto_external_id: 'P1', preco_cents: 790 }),
          reg('TAB01:P404', { produto_external_id: 'P404', preco_cents: 100 }),
          reg('TAB01:P2', { produto_external_id: 'P2', preco_cents: -5 }),
        ],
        { linhas_invalidas: [{ external_id: null, codigo: 'registro_invalido', mensagem: 'Linha sem código.' }] },
      ),
    );
    const fimLote = await concluir(aceito.corpo.lote_id);
    const r = fim(fimLote);
    expect(r.status).toBe('concluido_com_erros');
    expect(r.erros.map((e: any) => [e.indice, e.external_id, e.codigo, e.campo, e.reprocessavel, e.origem])).toEqual([
      [1, 'TAB01:P404', 'referencia_ausente', 'produto_external_id', true, 'hub'],
      [2, 'TAB01:P2', 'valor_fora_da_faixa', 'preco_cents', false, 'hub'],
      [3, null, 'registro_invalido', null, false, 'conector'],
    ]);
    for (const e of r.erros) expect(e.mensagem).not.toMatch(/\b790\b|\b-5\b/); // nunca cita o valor
    expect(r.cursor).toEqual({ alterado_em: '2026-11-05T13:45:10Z', external_id: 'TAB01:P1' });
    // limite_erros corta e informa o que omitiu
    const curto = await chamar('GET', `/lotes/${aceito.corpo.lote_id}?limite_erros=1`);
    expect(curto.corpo.erros).toHaveLength(1);
    expect(curto.corpo).toMatchObject({ erros_total: 3, erros_omitidos: 2 });
    expect((await chamar('GET', `/lotes/${randomUUID()}`)).corpo.codigo).toBe('lote_nao_encontrado');
  });

  function fim(r: { corpo: any }) {
    return r.corpo;
  }
});

describe('Hub simulado: devolução de pedidos', () => {
  const retorno = (extra: Record<string, unknown> = {}) => ({ versao_contrato: 'v1', pedido_uuid: PEDIDO, status: 'integrado', numero_erp: 'PV-004512', ocorrido_em: '2026-11-05T14:02:00Z', ...extra });

  it('retorno antes de buscar: 422 pedido_nao_entregue; desconhecido: 422 pedido_desconhecido; caminho diferente do corpo: 400', async () => {
    const naoEntregue = await chamar('POST', `/pedidos/${PEDIDO}/retorno`, retorno());
    expect(naoEntregue.status).toBe(422);
    expect(naoEntregue.corpo).toMatchObject({ codigo: 'pedido_nao_entregue', erros: [{ codigo: 'pedido_nao_entregue' }] });
    const outro = randomUUID();
    const desconhecido = await chamar('POST', `/pedidos/${outro}/retorno`, retorno({ pedido_uuid: outro }));
    expect(desconhecido.corpo.codigo).toBe('pedido_desconhecido');
    const divergente = await chamar('POST', `/pedidos/${outro}/retorno`, retorno());
    expect(divergente.status).toBe(400);
    expect(divergente.corpo.codigo).toBe('requisicao_invalida');
    const semNumero = await chamar('POST', `/pedidos/${PEDIDO}/retorno`, retorno({ numero_erp: undefined }));
    expect(semNumero.status).toBe(400);
  });

  it('pendentes devolve o pedido de exemplo do OpenAPI, marca enviado (tentativa 1) e não o devolve de novo', async () => {
    expect((await chamar('GET', '/pedidos/pendentes?limite=0')).status).toBe(400);
    const a = await chamar('GET', '/pedidos/pendentes?limite=10');
    expect(a.corpo.pedidos).toHaveLength(1);
    expect(a.corpo.pedidos[0]).toMatchObject({ pedido_uuid: PEDIDO, tentativa: 1, cliente_external_id: 'C000123' });
    expect(hub.estado.pedidos.get(PEDIDO).estado).toBe('enviado');
    expect((await chamar('GET', '/pedidos/pendentes')).corpo).toEqual({ pedidos: [] });
  });

  it('integrado, repetido (200 repetido:true), numero_erp diferente (422) e transição inválida (422)', async () => {
    const ok = await chamar('POST', `/pedidos/${PEDIDO}/retorno`, retorno());
    expect(ok).toMatchObject({ status: 200, corpo: { pedido_uuid: PEDIDO, status: 'integrado', repetido: false } });
    const igual = await chamar('POST', `/pedidos/${PEDIDO}/retorno`, retorno({ ocorrido_em: '2026-11-05T14:03:00Z' }));
    expect(igual).toMatchObject({ status: 200, corpo: { repetido: true } });
    const divergente = await chamar('POST', `/pedidos/${PEDIDO}/retorno`, retorno({ numero_erp: 'PV-999999' }));
    expect(divergente).toMatchObject({ status: 422, corpo: { codigo: 'numero_erp_divergente' } });
    const rejeitar = await chamar('POST', `/pedidos/${PEDIDO}/retorno`, retorno({ status: 'rejeitado_erp', numero_erp: undefined, motivo: 'Cliente bloqueado no ERP.' }));
    expect(rejeitar).toMatchObject({ status: 422, corpo: { codigo: 'transicao_invalida' } });
  });

  it('faturado_parcial aceita o retorno e devolve itens_descartados para item inválido (200)', async () => {
    const nota = { numero: '8841', serie: '1', emitida_em: '2026-11-05T16:30:00Z', total_cents: 6000 };
    const r = await chamar(
      'POST',
      `/pedidos/${PEDIDO}/retorno`,
      retorno({
        status: 'faturado_parcial',
        nota,
        itens_faturados: [
          { sequencia: 1, produto_external_id: 'P000045', quantidade: 24, valor_cents: 6000 },
          { sequencia: 9, produto_external_id: 'P000099', quantidade: 3, valor_cents: 10 },
        ],
      }),
    );
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ status: 'faturado_parcial', repetido: false });
    expect(r.corpo.itens_descartados).toHaveLength(1);
    expect(r.corpo.itens_descartados[0]).toMatchObject({ indice: 1, sequencia: 9, codigo: 'sequencia_inexistente', codigos: ['sequencia_inexistente'], campo: 'itens_faturados[1].sequencia' });
  });
});

describe('Hub simulado: falhas transitórias', () => {
  it('responde 503 com Retry-After: 1 nas próximas N chamadas autenticadas e depois normaliza', async () => {
    hub.definirFalhasTransitorias(2);
    for (let i = 0; i < 2; i += 1) {
      const r = await chamar('GET', '/cursores/produto');
      expect(r.status).toBe(503);
      expect(r.cab.get('retry-after')).toBe('1');
      expect(r.corpo.codigo).toBe('servico_indisponivel');
    }
    expect((await chamar('GET', '/cursores/produto')).status).toBe(200);
  });
});
