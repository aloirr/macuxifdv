/**
 * RN-VEN-17 (T-0141 C), ponta a ponta no pacote do Vendedor: o endereço digitado no formulário (offline, à mão, sem CEP online)
 * atravessa o rascunho, o push, a regra da API, o retrato gravado, o detalhe (Campo, Gestão e BKO), os dois PDFs e o `aprovado@1`
 * com `origem: 'editado'`, e o cadastro do cliente (Core) não muda. Valor × regra: o mesmo endereço em todos os lugares.
 */
import { describe, expect, it } from 'vitest';

import { enderecoDoPedido as enderecoDaApi } from '../../api/mapeamento';
import { EnderecoEntregaPedido, PedidoAprovadoEvento, PedidoPush } from '../../contracts';
import { montarPedidoAprovado, enderecoParaEvento } from '../../domain/aprovacao';
import { enderecoDoPedido as regraDoEndereco, type EnderecoDoCadastro } from '../../domain/endereco-pedido';
import { buildOrderPdfHtml, pdfDoPedido, type DetalheParaPdf } from '../../domain/pdf-pedido';
import { enderecoFoiEditado, textoDoEnderecoEntrega } from '../../web/lib/detalhe-pedido';
import { enderecoEditadoDoRetrato } from './documento';
import { cartaoDoEndereco, errosDoFormulario, formularioDoEndereco, rascunhoComEnderecoEditado } from './endereco-pedido';
import type { EnderecoDaTela } from './novo-pedido';
import { montarPedido, rascunhoVazio } from './pedidos';

const U = '9f0c6b9e-6c3f-4b5f-8b3a-1f4a0f7d1c99';
const principal: EnderecoDaTela = { id: 'e1', cliente_id: 'c1', tipo: 'principal', descricao: null, logradouro: 'Rua Pará', numero: '137', complemento: null, bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', cep: '69053000', principal: true, ativo: true };
const deposito: EnderecoDaTela = { ...principal, id: 'e2', tipo: 'entrega', descricao: 'Depósito', logradouro: 'Av. Torquato Tapajós', numero: '4010', bairro: 'Flores', cep: '69048000', principal: false };
const lista = [principal, deposito];
const doCadastro: EnderecoDoCadastro[] = lista.map((e) => ({ ...e, external_id: `ERP-${e.id}` }));

/** O que o vendedor digita no formulário (parte do endereço principal, muda número e complemento). */
const digitado = { ...formularioDoEndereco(principal), numero: '140', complemento: 'fundos' };

describe('RN-VEN-17: endereço editado só no pedido, de ponta a ponta', () => {
  // 1) formulário → rascunho (offline: nada de consulta de CEP)
  const rascunho = rascunhoComEnderecoEditado(rascunhoVazio('c1'), digitado, lista);
  // 2) rascunho → push que vai à fila do aparelho
  const push = montarPedido({ id: U, cliente: { id: 'c1' } as never, rascunho, v: { totals: { total_cents: 100, lines: [{ product_id: U, quantity: 1 }] } } as never, semSinal: true, agora: '2026-11-09T13:00:00.000Z' });
  // 3) API: revalida e grava o retrato
  const api = regraDoEndereco({ editado: push.endereco_entrega_editado, escolhido_id: push.endereco_entrega_id, enderecos: doCadastro });

  it('RN-VEN-17: sem sinal o formulário valida à mão: Cidade e UF são obrigatórias', () => {
    expect(errosDoFormulario({ ...digitado, cidade: '', uf: '' })).toEqual({ cidade: 'Obrigatório', uf: 'Obrigatório' });
    expect(errosDoFormulario(digitado)).toEqual({});
  });

  it('RN-VEN-17: o rascunho guarda o endereço digitado (sem id) e o cartão mostra o selo "Editado neste pedido"', () => {
    expect(rascunho.endereco_entrega_id).toBeNull();
    expect(cartaoDoEndereco({ rascunho, lista }).selo).toEqual({ texto: 'Editado neste pedido', tom: 'destaque' });
    expect(cartaoDoEndereco({ rascunho, lista }).linhas).toEqual(['Rua Pará, 140, fundos · São Geraldo', 'Manaus/AM · 69053-000']);
  });

  it('RN-VEN-17: o push leva o digitado e o contrato do envio aceita; sem o id do endereço', () => {
    const lido = PedidoPush.parse(push);
    expect(lido.endereco_entrega_editado).toEqual({ logradouro: 'Rua Pará', numero: '140', complemento: 'fundos', bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', cep: '69053000' });
    expect(lido.endereco_entrega_id).toBeUndefined();
    // o contrato recusa UF inexistente e CEP fora de 8 dígitos (a API revalida)
    expect(PedidoPush.safeParse({ ...push, endereco_entrega_editado: { ...lido.endereco_entrega_editado!, uf: 'XX' } }).success).toBe(false);
    expect(PedidoPush.safeParse({ ...push, endereco_entrega_editado: { ...lido.endereco_entrega_editado!, cep: '69053-000' } }).success).toBe(false);
  });

  it('RN-VEN-17: a API grava o retrato origem editado, id e external_id nulos, não principal; o cadastro do cliente não muda', () => {
    const antes = JSON.stringify(doCadastro);
    expect(api).toMatchObject({ ok: true, endereco_id: null, retrato: { id: null, external_id: null, principal: false, origem: 'editado', numero: '140', complemento: 'fundos' } });
    if (!api.ok) throw new Error('esperava ok');
    expect(EnderecoEntregaPedido.safeParse(api.retrato).success).toBe(true);
    expect(JSON.stringify(doCadastro)).toBe(antes);
  });

  it('RN-VEN-17: o detalhe lê o retrato com a origem (Campo, Gestão e BKO) e mostra o mesmo endereço', () => {
    if (!api.ok || !api.retrato) throw new Error('esperava retrato');
    const detalhe = enderecoDaApi({ endereco_entrega: api.retrato as unknown as Record<string, unknown> } as never);
    expect(detalhe).toMatchObject({ origem: 'editado', logradouro: 'Rua Pará', numero: '140', complemento: 'fundos', cidade: 'Manaus', uf: 'AM', cep: '69053000' });
    expect(enderecoFoiEditado(detalhe)).toBe(true);
    expect(textoDoEnderecoEntrega(detalhe)).toBe('Rua Pará, 140 – fundos · São Geraldo · Manaus/AM · CEP 69053-000');
    // retrato antigo (sem origem) é do ERP, sem selo
    expect(enderecoFoiEditado(enderecoDaApi({ endereco_entrega: { logradouro: 'Rua A', cidade: 'X', uf: 'AM' } } as never))).toBe(false);
  });

  it('RN-VEN-17: Duplicar e Transformar levam o endereço editado de volta como digitado', () => {
    if (!api.ok || !api.retrato) throw new Error('esperava retrato');
    const detalhe = enderecoDaApi({ endereco_entrega: api.retrato as unknown as Record<string, unknown> } as never);
    expect(enderecoEditadoDoRetrato(detalhe)).toEqual({ logradouro: 'Rua Pará', numero: '140', complemento: 'fundos', bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', cep: '69053000' });
    expect(enderecoEditadoDoRetrato({ ...detalhe!, origem: 'erp' })).toBeNull();
  });

  it('RN-VEN-17: os dois PDFs (cliente e BKO) trazem o endereço na ficha "Entrega" (spec pdf-pedido, proposta 2) com o mesmo endereço e nenhuma marca de editado', () => {
    if (!api.ok || !api.retrato) throw new Error('esperava retrato');
    const detalhe = enderecoDaApi({ endereco_entrega: api.retrato as unknown as Record<string, unknown> } as never)!;
    const d: DetalheParaPdf = {
      number: 'PED-000123', status: 'approved', received_at: '2026-11-09T13:00:00.000Z', seller_name: 'Lucas', customer_name: 'Atacadinho', payment_terms: '28 dias', discount_pct: 0,
      subtotal_cents: 100, total_cents: 100, price_table_id: null,
      items: [{ erp_code: 'P1', description: 'Produto', quantity: 1, unit_price_cents: 100, total_cents: 100 }], history: [],
      cliente: { razao_social: 'Atacadinho Ltda', nome_fantasia: 'Atacadinho', documento: '12345678000190', codigo_erp: 'C5007' },
      delivery_address: detalhe,
    };
    for (const view of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(d), view, { tenant_name: 'Distribuidora', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: '2026-11-09T14:00:00.000Z' });
      expect(html).toContain(">Entrega<");
      expect(html).toContain('Rua Pará, 140 – fundos');
      expect(html).toContain('69053-000');
      expect(html).not.toMatch(/Editado neste pedido/i);
    }
  });

  it('RN-VEN-17: o aprovado@1 leva origem editado, external_id nulo e principal false; o contrato do evento aceita', () => {
    if (!api.ok || !api.retrato) throw new Error('esperava retrato');
    const endereco = enderecoParaEvento(api.retrato as unknown as Record<string, unknown>);
    expect(endereco).toEqual({ external_id: null, logradouro: 'Rua Pará', numero: '140', complemento: 'fundos', bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', cep: '69053000', principal: false, origem: 'editado' });
    const payload = montarPedidoAprovado({
      pedido_uuid: U, cliente_external_id: 'C5007', vendedor_external_id: 'V1', condicao_pagamento_codigo: '28', criado_em: '2026-11-09T13:00:00.000Z', aprovado_em: '2026-11-09T13:00:01.000Z', observacao: null,
      itens: [{ produto_external_id: 'P1', quantidade: 1, preco_tabela_cents: 100, total_cents: 100 }],
      endereco_entrega: endereco,
    });
    expect(PedidoAprovadoEvento.parse(payload).endereco_entrega).toMatchObject({ origem: 'editado', external_id: null, principal: false });
  });

  it('RN-VEN-17: endereço do ERP continua igual (origem erp) e o payload antigo, sem origem, segue válido no evento', () => {
    const erp = regraDoEndereco({ editado: null, escolhido_id: 'e2', enderecos: doCadastro });
    if (!erp.ok || !erp.retrato) throw new Error('esperava retrato');
    expect(erp.retrato).toMatchObject({ id: 'e2', external_id: 'ERP-e2', origem: 'erp', principal: false });
    expect(enderecoParaEvento({ logradouro: 'Rua A', cidade: 'Manaus', uf: 'am', principal: true })).toEqual({ external_id: null, logradouro: 'Rua A', numero: null, complemento: null, bairro: null, cidade: 'Manaus', uf: 'AM', cep: null, principal: true });
  });
});
