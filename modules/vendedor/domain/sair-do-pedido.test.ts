import { describe, expect, it } from 'vitest';
import { TEXTOS_DA_SAIDA, avisoSoOrcamento, destinoDoSalvarDaSaida, opcoesDaSaida, opcoesDaSaidaEdicao, pedidoAlterado, rascunhoParaRetomar, textoAlteradoEm, textoDeItens, type RascunhoGuardado } from './sair-do-pedido';

const vazio = { lines: {}, discount_pct: 0 };
const ok = { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] };
const rasc = (o: Partial<RascunhoGuardado> = {}): RascunhoGuardado => ({ ...vazio, customer_id: 'c1', updated_at: '2026-11-08T10:00:00Z', ...o });

describe('RN-VEN-38: pedido alterado', () => {
  it('RN-VEN-38: rascunho recém-aberto (sem item nem campo mexido) não pergunta ao sair', () => {
    expect(pedidoAlterado(vazio)).toBe(false);
    expect(pedidoAlterado({ ...vazio, lines: { a: 0 }, frete: { modalidade: 'FOB' } })).toBe(false);
  });
  it('RN-VEN-38: pelo menos 1 item já é pedido alterado', () => {
    expect(pedidoAlterado({ ...vazio, lines: { a: 1 } })).toBe(true);
  });
  it.each([
    ['observação', { observacao: 'entregar de manhã' }],
    ['desconto do pedido', { discount_pct: 2 }],
    ['acréscimo em R$', { acrescimo_valor_cents: 500 }],
    ['endereço de entrega', { endereco_entrega_id: 'e1' }],
    ['transportadora', { frete: { modalidade: 'FOB' as const, transportadora_id: 't1' } }],
  ])('RN-VEN-38: campo mudado (%s) conta como alteração', (_n, mudanca) => {
    expect(pedidoAlterado({ ...vazio, ...mudanca })).toBe(true);
  });
});

describe('RN-VEN-38: opções da folha e RN-VEN-13', () => {
  const base = { pre_venda_ligada: true, preco_data: '2026-11-09' };
  it('RN-VEN-38: cliente normal vê Salvar e enviar pedido, Apenas salvar, Salvar como orçamento (Preço de 09/11) e Descartar', () => {
    expect(opcoesDaSaida({ ...base, cliente: ok })).toEqual({ salvar: true, apenasSalvar: true, orcamento: true, subtituloOrcamento: 'Preço de 09/11', aviso: null });
  });
  it.each([
    ['bloqueado', { ...ok, bloqueado: true }, 'Cliente bloqueado: só dá para salvar como orçamento'],
    ['inativo', { ...ok, ativo: false }, 'Cliente inativo: só dá para salvar como orçamento'],
    ['incompleto', { ...ok, cadastro_incompleto: true, campos_faltantes: ['CNPJ'] }, 'Cadastro do cliente incompleto: só dá para salvar como orçamento'],
  ])('RN-VEN-13: cliente %s vê só Apenas salvar, Salvar como orçamento e Descartar, com o motivo', (_n, cliente, aviso) => {
    const o = opcoesDaSaida({ ...base, cliente });
    expect(o.salvar).toBe(false);
    expect(o.apenasSalvar).toBe(true);
    expect(o.orcamento).toBe(true);
    expect(o.aviso).toBe(aviso);
    expect(avisoSoOrcamento(cliente)).toBe(aviso);
  });
  it('RN-VEN-38: tenant sem pré-venda não oferece orçamento', () => {
    expect(opcoesDaSaida({ ...base, pre_venda_ligada: false, cliente: ok }).orcamento).toBe(false);
  });
  it('RN-VEN-13: cliente só-orçamento mantém o orçamento mesmo sem pré-venda ligada (a folha nunca fica sem salvar)', () => {
    expect(opcoesDaSaida({ pre_venda_ligada: false, preco_data: '2026-11-09', cliente: { ...ok, bloqueado: true } }).orcamento).toBe(true);
  });
});

describe('RN-VEN-38: textos da folha (T-0137)', () => {
  it('RN-VEN-38: rótulos novos da folha Sair do pedido', () => {
    expect(TEXTOS_DA_SAIDA.salvar.rotulo).toBe('Salvar e enviar pedido');
    expect(TEXTOS_DA_SAIDA.apenasSalvar).toEqual({ rotulo: 'Apenas salvar', subtitulo: 'Guarda sem enviar' });
    expect(TEXTOS_DA_SAIDA.orcamento.rotulo).toBe('Salvar como orçamento');
  });
});

describe('RN-VEN-38 / RN-CORE-36: salvar pela folha', () => {
  it('RN-VEN-38: com pendência fecha a folha e abre o Resumo no bloco "Falta para salvar"', () => {
    expect(destinoDoSalvarDaSaida(2)).toBe('mostrar_pendencias');
  });
  it('RN-VEN-38: sem pendência salva na hora', () => {
    expect(destinoDoSalvarDaSaida(0)).toBe('salvar_agora');
  });
});

describe('RN-VEN-38: retomada depois que o sistema fecha o app', () => {
  it('RN-VEN-38: oferece o rascunho alterado mais recente de Novo pedido', () => {
    const r = rascunhoParaRetomar({
      c1: rasc({ lines: { a: 1 }, updated_at: '2026-11-08T10:00:00Z' }),
      c2: rasc({ customer_id: 'c2', lines: { b: 2 }, updated_at: '2026-11-08T11:00:00Z' }),
    });
    expect(r?.chave).toBe('c2');
  });
  it('RN-VEN-38: rascunho sem alteração e edição de pedido salvo não são oferecidos', () => {
    expect(rascunhoParaRetomar({ c1: rasc(), 'edit:p1': rasc({ lines: { a: 1 }, edit_order_id: 'p1' }) })).toBeNull();
  });
  it('RN-VEN-38: rascunho guardado por Apenas salvar não é oferecido como pedido não terminado', () => {
    expect(rascunhoParaRetomar({ c1: rasc({ lines: { a: 1 }, salvo_em: '2026-11-08T11:00:00Z' }) })).toBeNull();
    expect(rascunhoParaRetomar({ c1: rasc({ lines: { a: 1 }, salvo_em: '2026-11-08T11:00:00Z' }), c2: rasc({ customer_id: 'c2', lines: { b: 1 } }) })?.chave).toBe('c2');
  });
  it('RN-VEN-38: textos de itens', () => {
    expect(textoDeItens({ ...vazio, lines: { a: 1, b: 3 } })).toBe('2 itens');
    expect(textoDeItens({ ...vazio, lines: { a: 1 } })).toBe('1 item');
    expect(textoDeItens(vazio)).toBeNull();
  });

  it('RN-VEN-38: alterado hoje, ontem e antes, no fuso do tenant (Manaus)', () => {
    const agora = new Date('2026-11-08T18:00:00Z');
    expect(textoAlteradoEm('2026-11-08T14:34:00Z', agora, 'America/Manaus')).toBe('alterado às 10h34');
    expect(textoAlteradoEm('2026-11-07T22:10:00Z', agora, 'America/Manaus')).toBe('alterado ontem às 18h10');
    expect(textoAlteradoEm('2026-11-05T13:02:00Z', agora, 'America/Manaus')).toBe('alterado em 05/11 às 09h02');
  });
});

describe('RN-VEN-38 (v1.0.1): saída da edição de pedido salvo', () => {
  it('RN-VEN-38: edição de pedido oferece Salvar alterações com o destino e Descartar alterações com confirmação própria', () => {
    const o = opcoesDaSaidaEdicao({ tipo: 'pedido', destino: 'Vai para o supervisor' });
    expect(o.salvar).toEqual({ rotulo: 'Salvar alterações', subtitulo: 'Vai para o supervisor' });
    expect(o.descartar.rotulo).toBe('Descartar alterações');
    expect(o.confirmacao.titulo).toBe('Descartar as alterações?');
  });
  it('RN-VEN-38: edição de orçamento oferece Salvar orçamento', () => {
    expect(opcoesDaSaidaEdicao({ tipo: 'orcamento', destino: 'x' }).salvar.rotulo).toBe('Salvar orçamento');
  });
});
