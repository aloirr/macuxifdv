import { describe, expect, it } from 'vitest';
import { alvoDaEntrega, classificarCriacaoPedido, decidirCanalPedido, decidirEntregaPedidoApi, montarRetornoDaEntrega, motivoRecusaSeguro, pedidoDoAlvo } from './pedido-api';

const UUID = '3f2b7a52-6c0e-4d44-9a52-5d2f3c1a9b10';
const nuvem = { ativo: true, recebe_pedidos: true, campo_uuid: 'U_MXUUID', pedido_pela_api: true };

describe('RN-INT-19: pedido pela API só com o campo do UUID do Macuxi no ERP', () => {
  it('RN-INT-19: com busca ligada, Conector nuvem que recebe pedidos e campo do UUID configurado, o pedido vai pela API', () => {
    expect(decidirCanalPedido({ buscaLigada: true, conector: nuvem })).toEqual({ canal: 'api' });
  });
  it('RN-INT-19: sem o campo do UUID o pedido vai pelo Conector (não se cria pedido sem a chave de idempotência)', () => {
    expect(decidirCanalPedido({ buscaLigada: true, conector: { ...nuvem, campo_uuid: null } })).toEqual({ canal: 'conector', motivo: 'sem_campo_uuid' });
    expect(decidirCanalPedido({ buscaLigada: true, conector: { ...nuvem, campo_uuid: '  ' } })).toEqual({ canal: 'conector', motivo: 'sem_campo_uuid' });
  });
  it('RN-INT-19: modelo sem pedido pela API, Conector que não recebe pedidos, inativo ou busca desligada: vai pelo Conector', () => {
    expect(decidirCanalPedido({ buscaLigada: true, conector: { ...nuvem, pedido_pela_api: false } })).toEqual({ canal: 'conector', motivo: 'modelo_sem_pedido_pela_api' });
    expect(decidirCanalPedido({ buscaLigada: true, conector: { ...nuvem, recebe_pedidos: false } })).toEqual({ canal: 'conector', motivo: 'conector_nao_recebe_pedidos' });
    expect(decidirCanalPedido({ buscaLigada: true, conector: { ...nuvem, ativo: false } })).toEqual({ canal: 'conector', motivo: 'conector_nao_recebe_pedidos' });
    expect(decidirCanalPedido({ buscaLigada: false, conector: nuvem })).toEqual({ canal: 'conector', motivo: 'busca_desligada' });
    expect(decidirCanalPedido({ buscaLigada: true, conector: null })).toEqual({ canal: 'conector', motivo: 'sem_conector_nuvem' });
  });
  it('RN-INT-19: procura antes de criar — achou o pedido pelo UUID, não cria e usa o número do ERP', () => {
    expect(decidirEntregaPedidoApi({ achado: { numero_erp: '9001' } })).toEqual({ acao: 'ja_existe', numero_erp: '9001' });
  });
  it('RN-INT-19: não achou, cria', () => {
    expect(decidirEntregaPedidoApi({ achado: null })).toEqual({ acao: 'criar' });
  });
});

describe('RN-INT-19: resposta do ERP à criação do pedido', () => {
  it('RN-INT-19: 2xx com número é integrado', () => {
    expect(classificarCriacaoPedido({ status: 201, numero_erp: '9001', motivo: null })).toEqual({ resultado: 'integrado', numero_erp: '9001' });
  });
  it('RN-INT-19: 2xx sem número no corpo é falha transitória: a próxima tentativa acha o pedido pelo UUID e não duplica', () => {
    expect(classificarCriacaoPedido({ status: 200, numero_erp: null, motivo: null })).toEqual({ resultado: 'tentar_de_novo', paraColetas: false });
  });
  it('RN-INT-19: recusa de regra do ERP (400, 409, 422) vira rejeitado_erp com o motivo', () => {
    for (const status of [400, 409, 422]) expect(classificarCriacaoPedido({ status, numero_erp: null, motivo: 'Cliente bloqueado' })).toEqual({ resultado: 'rejeitado_erp', motivo: 'Cliente bloqueado' });
    expect(classificarCriacaoPedido({ status: 400, numero_erp: null, motivo: null })).toEqual({ resultado: 'rejeitado_erp', motivo: 'O ERP recusou o pedido (HTTP 400) sem informar o motivo.' });
  });
  it('RN-INT-20: 401 e 403 param as coletas e o pedido espera a troca da credencial (não é rejeição do pedido)', () => {
    expect(classificarCriacaoPedido({ status: 401, numero_erp: null, motivo: null })).toEqual({ resultado: 'tentar_de_novo', paraColetas: true });
    expect(classificarCriacaoPedido({ status: 403, numero_erp: null, motivo: null })).toEqual({ resultado: 'tentar_de_novo', paraColetas: true });
  });
  it('RN-INT-20: 429 e 5xx tentam de novo', () => {
    for (const status of [429, 500, 503]) expect(classificarCriacaoPedido({ status, numero_erp: null, motivo: null })).toEqual({ resultado: 'tentar_de_novo', paraColetas: false });
  });
  it('o motivo do ERP vai a uma linha só, sem controle, em até 300 caracteres', () => {
    expect(motivoRecusaSeguro('  linha1\n\tlinha2\u0000 ')).toBe('linha1 linha2');
    expect(motivoRecusaSeguro('x'.repeat(500))).toHaveLength(300);
  });
});

describe('RN-INT-08: o retorno da entrega pela API usa o contrato do retorno do Conector', () => {
  it('integrado leva o número do ERP; rejeitado leva o motivo', () => {
    const a = montarRetornoDaEntrega(UUID, { resultado: 'integrado', numero_erp: '9001' }, '2026-11-22T14:00:00.000Z');
    expect(a).toMatchObject({ versao_contrato: 'v1', pedido_uuid: UUID, status: 'integrado', numero_erp: '9001', ocorrido_em: '2026-11-22T14:00:00.000Z' });
    const r = montarRetornoDaEntrega(UUID, { resultado: 'rejeitado_erp', motivo: 'Cliente bloqueado' }, '2026-11-22T14:00:00.000Z');
    expect(r).toMatchObject({ status: 'rejeitado_erp', motivo: 'Cliente bloqueado' });
  });
});

describe('RN-INT-19: alvo da entrega (uma entrega nova por rodada, decifrável pelos candidatos da fila)', () => {
  const OUTRO = '9a1c2b3d-0000-4d44-9a52-5d2f3c1a9b11';
  it('o alvo é um UUID estável por (pedido, rodada) e muda com a rodada', () => {
    expect(alvoDaEntrega(UUID, 0)).toBe(alvoDaEntrega(UUID.toUpperCase(), 0));
    expect(alvoDaEntrega(UUID, 0)).not.toBe(alvoDaEntrega(UUID, 1));
    expect(alvoDaEntrega(UUID, 0)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
  it('acha o pedido entre os candidatos em qualquer rodada até a tentativa atual; fora da fila devolve nulo', () => {
    const cands = [{ pedido_uuid: OUTRO, tentativas: 0 }, { pedido_uuid: UUID, tentativas: 3 }];
    expect(pedidoDoAlvo(alvoDaEntrega(UUID, 2), cands)).toBe(UUID);
    expect(pedidoDoAlvo(alvoDaEntrega(OUTRO, 0), cands)).toBe(OUTRO);
    expect(pedidoDoAlvo(alvoDaEntrega(UUID, 4), cands)).toBeNull();
    expect(pedidoDoAlvo(alvoDaEntrega(UUID, 0), [])).toBeNull();
  });
});
