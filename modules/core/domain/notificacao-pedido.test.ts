import { describe, expect, it } from 'vitest';
import { entidadesDoPush, notificacoesDeAprovacaoPorAprovador, notificacaoDeMeta, notificacaoDePedido, notificacaoDeRotaDoDia } from './notificacao-pedido';

const ID = '0e500000-0000-4000-8000-000000000001';

describe('RN-CORE-23 item 3: notificação de pedido', () => {
  it('RN-CORE-23: aprovado vira "Pedido aprovado" para o vendedor, com link do pedido e entidades', () => {
    const n = notificacaoDePedido({ tipo: 'status', para: 'aprovado', pedidoId: ID, motivo: null });
    expect(n).toMatchObject({ destino: 'vendedor', titulo: 'Pedido aprovado', link: `/m/pedido?id=${ID}`, prioridade: 'alta' });
  });
  it('RN-CORE-23: rejeitado leva o motivo no texto', () => {
    const n = notificacaoDePedido({ tipo: 'status', para: 'rejeitado', pedidoId: ID, motivo: 'Desconto acima da alçada' });
    expect(n?.titulo).toBe('Pedido rejeitado');
    expect(n?.corpo).toContain('Desconto acima da alçada');
  });
  it('RN-CORE-23: para aprovar vai ao aprovador', () => {
    expect(notificacaoDePedido({ tipo: 'aprovacao_solicitada', pedidoId: ID })?.destino).toBe('aprovador');
  });
  it('RN-CORE-23: integrado e faturado notificam o vendedor; outros status não notificam', () => {
    expect(notificacaoDePedido({ tipo: 'status', para: 'integrado_erp', pedidoId: ID, motivo: null })?.titulo).toBe('Pedido integrado ao ERP');
    expect(notificacaoDePedido({ tipo: 'status', para: 'faturado_total', pedidoId: ID, motivo: null })?.titulo).toBe('Pedido faturado');
    expect(notificacaoDePedido({ tipo: 'status', para: 'na_fila', pedidoId: ID, motivo: null })).toBeNull();
  });
  it('RN-CORE-23: entidades do push por tipo de notificação', () => {
    expect(entidadesDoPush('pedido')).toEqual(['pedido', 'pedido_evento', 'notificacao']);
    expect(entidadesDoPush('sistema', '/m/metas')).toEqual(['meta', 'notificacao']);
    expect(entidadesDoPush('sistema', '/m/rota')).toEqual(['rota', 'rota_parada', 'notificacao']);
    expect(entidadesDoPush('recado')).toEqual(['notificacao']);
  });
  it('RN-CORE-23: número do pedido no título com 6 dígitos', () => {
    expect(notificacaoDePedido({ tipo: 'status', para: 'aprovado', pedidoId: ID, motivo: null, numero: 10 })?.titulo).toBe('Pedido 000010 aprovado');
    expect(notificacaoDePedido({ tipo: 'aprovacao_solicitada', pedidoId: ID, numero: '12' })?.titulo).toBe('Pedido 000012 para aprovar');
  });
  it('RN-CORE-23: meta e rota do dia geram notificação com link do app', () => {
    expect(notificacaoDeMeta({ valorAnterior: null }).link).toBe('/m/metas');
    expect(notificacaoDeMeta({ valorAnterior: 5 }).titulo).toBe('Meta atualizada');
    expect(notificacaoDeRotaDoDia().link).toBe('/m/rota');
  });
});

describe('notificacoesDeAprovacaoPorAprovador (T-0184, RN-VEN-30, RN-CORE-23)', () => {
  const NIVEIS = ['supervisor', 'gerente', 'analista'];
  const ROTULO = { desconto: 'Desconto', credito: 'Crédito', inadimplencia: 'Inadimplente', estoque: 'Estoque', preco_minimo: 'Preço mínimo' };
  const V = 'v';
  const base = { pedidoId: ID, numero: 10, vendedorId: V, ordemNiveis: NIVEIS, rotuloMotivo: ROTULO };
  const sup = { id: 's1', perfil: 'supervisor' };
  const ger = { id: 'g1', perfil: 'gerente' };
  const ana = { id: 'a1', perfil: 'analista' };
  const adm = { id: 'ad1', perfil: 'admin' };
  const aprov = (...l: Array<[string, string]>) => l.map(([motivo, nivel]) => ({ motivo, nivel }));
  const corpo = (r: ReturnType<typeof notificacoesDeAprovacaoPorAprovador>, id: string) => r.find((n) => n.usuarioId === id)?.notificacao.corpo;

  it('RN-VEN-30: cada aprovador recebe uma notificação, com os motivos do nível dele e dos abaixo (gerente decide supervisor)', () => {
    const r = notificacoesDeAprovacaoPorAprovador({ ...base, aprovacoes: aprov(['credito', 'gerente'], ['desconto', 'supervisor']), acima: [sup, ger], alcada: [] });
    expect(r).toHaveLength(2);
    expect(corpo(r, 's1')).toBe('Motivo: Desconto');
    expect(corpo(r, 'g1')).toBe('Motivo: Desconto, Crédito');
    expect(r[0]!.notificacao).toMatchObject({ destino: 'aprovador', titulo: 'Pedido 000010 para aprovar', link: `/m/pedido?id=${ID}`, prioridade: 'alta' });
  });
  it('RN-VEN-30: gerente sozinho recebe os motivos de supervisor e de gerente numa só notificação (fallback do supervisor)', () => {
    const r = notificacoesDeAprovacaoPorAprovador({ ...base, aprovacoes: aprov(['desconto', 'supervisor'], ['credito', 'gerente']), acima: [ger], alcada: [ger] });
    expect(r).toHaveLength(1);
    expect(corpo(r, 'g1')).toBe('Motivo: Desconto, Crédito');
  });
  it('RN-VEN-30: nível sem ninguém cai no fallback, sem tirar os motivos de quem é do nível', () => {
    const r = notificacoesDeAprovacaoPorAprovador({ ...base, aprovacoes: aprov(['desconto', 'supervisor'], ['credito', 'gerente']), acima: [ger], alcada: [ger, ana, adm] });
    // supervisor sem ninguém: fallback = gerente, analista, admin; gerente continua com os dois motivos
    expect(corpo(r, 'g1')).toBe('Motivo: Desconto, Crédito');
    expect(corpo(r, 'a1')).toBe('Motivo: Desconto');
    expect(corpo(r, 'ad1')).toBe('Motivo: Desconto');
    expect(r).toHaveLength(3);
  });
  it('RN-VEN-30: analista é do tenant e só decide o nível analista; os motivos dele vêm só desse nível', () => {
    const r = notificacoesDeAprovacaoPorAprovador({ ...base, aprovacoes: aprov(['estoque', 'analista'], ['desconto', 'supervisor']), acima: [sup], alcada: [ana, ger] });
    expect(corpo(r, 'a1')).toBe('Motivo: Estoque');
    expect(corpo(r, 's1')).toBe('Motivo: Desconto');
    expect(r.map((n) => n.usuarioId)).not.toContain('g1');
  });
  it('RN-VEN-30: pessoa em dois papéis é uma só e os motivos se juntam sem repetir', () => {
    const r = notificacoesDeAprovacaoPorAprovador({
      ...base,
      aprovacoes: aprov(['credito', 'gerente'], ['inadimplencia', 'gerente'], ['credito', 'supervisor']),
      acima: [ger, ger],
      alcada: [ger],
    });
    expect(r).toHaveLength(1);
    expect(corpo(r, 'g1')).toBe('Motivo: Crédito, Inadimplente');
  });
  it('RN-VEN-30: o vendedor nunca recebe, mesmo sendo responsável da equipe ou do fallback', () => {
    const eu = { id: V, perfil: 'gerente' };
    const r = notificacoesDeAprovacaoPorAprovador({ ...base, aprovacoes: aprov(['credito', 'gerente']), acima: [eu], alcada: [eu, adm] });
    expect(r.map((n) => n.usuarioId)).toEqual(['ad1']);
  });
  it('RN-VEN-30: é determinística (mesma entrada, mesma saída), o que sustenta a reentrega sem duplicar', () => {
    const e = { ...base, aprovacoes: aprov(['credito', 'gerente'], ['desconto', 'supervisor']), acima: [sup, ger], alcada: [] };
    expect(notificacoesDeAprovacaoPorAprovador(e)).toEqual(notificacoesDeAprovacaoPorAprovador(e));
  });
  it('RN-VEN-30: lista vazia não notifica ninguém', () => {
    expect(notificacoesDeAprovacaoPorAprovador({ ...base, aprovacoes: [], acima: [ger], alcada: [ger] })).toEqual([]);
  });
});
