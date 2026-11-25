import { describe, expect, it } from 'vitest';
import { RASCUNHO_VALIDADE_HORAS, chaveDaCopiaDoPedido, chaveDoRascunhoNovo, chaveParaSalvar, idDoPedidoNoEnvio, copiaDoPedidoSalvo, limparRascunhosExpirados, rascunhoIdNaRota, migrarSalvosParaChavePropria, minutosParaSumir, rascunhoExpirou, rascunhosParaLista, textoSomeEm, type RascunhoMinimo } from './rascunhos';

const HORA = 3_600_000;
const T0 = '2026-11-09T10:00:00.000Z';
const depois = (iso: string, ms: number) => new Date(Date.parse(iso) + ms);
const r = (extra: Partial<RascunhoMinimo> = {}): RascunhoMinimo => ({ customer_id: 'c1', lines: { p1: 2 }, updated_at: T0, ...extra });

describe('RN-VEN-39: rascunho some 24 h depois da última alteração', () => {
  it('RN-VEN-39: a validade é de 24 horas', () => {
    expect(RASCUNHO_VALIDADE_HORAS).toBe(24);
  });

  it('RN-VEN-39: com 23 h 59 min ainda existe; com 24 h + 1 min some (relógio injetado)', () => {
    expect(rascunhoExpirou(r(), depois(T0, 24 * HORA - 60_000))).toBe(false);
    expect(rascunhoExpirou(r(), depois(T0, 24 * HORA))).toBe(true);
    expect(rascunhoExpirou(r(), depois(T0, 24 * HORA + 60_000))).toBe(true);
  });

  it('RN-VEN-39: cada alteração renova as 24 h (conta a partir do updated_at)', () => {
    const alterado = r({ updated_at: '2026-11-10T09:00:00.000Z' });
    expect(rascunhoExpirou(alterado, depois(T0, 24 * HORA + 60_000))).toBe(false);
  });

  it('RN-VEN-39: a lista mostra cliente, itens e hora da última alteração, do mais recente ao mais antigo, só os vivos', () => {
    const lista = rascunhosParaLista(
      {
        a: r({ customer_id: 'c1', updated_at: '2026-11-09T10:00:00.000Z', lines: { p1: 2, p2: 1 } }),
        b: r({ customer_id: 'c2', updated_at: '2026-11-09T12:00:00.000Z' }),
        velho: r({ customer_id: 'c3', updated_at: '2026-11-07T12:00:00.000Z' }),
      },
      new Date('2026-11-09T13:00:00.000Z'),
    );
    expect(lista).toEqual([
      { chave: 'b', customer_id: 'c2', itens: 1, atualizado_em: '2026-11-09T12:00:00.000Z', edicao_de: null },
      { chave: 'a', customer_id: 'c1', itens: 2, atualizado_em: '2026-11-09T10:00:00.000Z', edicao_de: null },
    ]);
  });

  it('RN-VEN-38: a saída sem a pergunta (Voltar do Android, troca de aba, app em segundo plano) deixa o pedido gravado e ele aparece em Rascunhos para retomar', () => {
    // o app grava o rascunho a cada alteração; sair sem escolher na folha não apaga nem marca nada: só o relógio das 24 h corre
    const saiuSemPergunta = r({ updated_at: '2026-11-09T09:50:00.000Z', lines: { p1: 2, p2: 5 } });
    const lista = rascunhosParaLista({ c5007: saiuSemPergunta }, new Date('2026-11-09T09:52:00.000Z'));
    expect(lista).toEqual([{ chave: 'c5007', customer_id: 'c1', itens: 2, atualizado_em: '2026-11-09T09:50:00.000Z', edicao_de: null }]);
    expect(limparRascunhosExpirados({ c5007: saiuSemPergunta }, new Date('2026-11-09T09:52:00.000Z')).mantidos).toHaveProperty('c5007');
  });

  it('RN-VEN-39: rascunho vazio não entra; a edição de um registro salvo entra, mesmo sem itens (spec F.2), com o id do registro', () => {
    const lista = rascunhosParaLista({ vazio: r({ lines: {} }), zero: r({ lines: { p1: 0 } }), 'edit:x': r({ edit_order_id: 'x', lines: {} }) }, depois(T0, HORA));
    expect(lista).toEqual([{ chave: 'edit:x', customer_id: 'c1', itens: 0, atualizado_em: T0, edicao_de: 'x' }]);
  });

  it('RN-VEN-39: o selo "Some em" só aparece nas últimas 3 h: horas inteiras acima de 1 h, minutos abaixo; a edição de registro salvo segue a mesma regra', () => {
    expect(minutosParaSumir(r(), depois(T0, 21 * HORA))).toBe(180);
    expect(textoSomeEm(180)).toBeNull();
    expect(textoSomeEm(179)).toBe('Some em 2 h');
    expect(textoSomeEm(120)).toBe('Some em 2 h');
    expect(textoSomeEm(119)).toBe('Some em 1 h');
    expect(textoSomeEm(60)).toBe('Some em 1 h');
    expect(textoSomeEm(59)).toBe('Some em 59 min');
    expect(textoSomeEm(40)).toBe('Some em 40 min');
    expect(textoSomeEm(1)).toBe('Some em 1 min');
    expect(textoSomeEm(0)).toBe('Some em 1 min');
    expect(minutosParaSumir(r(), depois(T0, 23 * HORA + 20 * 60_000))).toBe(40);
    expect(minutosParaSumir(r(), depois(T0, 23 * HORA + 20 * 60_000 + 30_000))).toBe(40);
    expect(minutosParaSumir(r({ edit_order_id: 'p9' }), depois(T0, 23 * HORA))).toBe(60);
  });

  it('RN-VEN-39: a limpeza apaga só os vencidos e devolve o que ficou; quem virou orçamento ou pedido já saiu do mapa e não volta', () => {
    const { mantidos, removidos } = limparRascunhosExpirados({ novo: r({ updated_at: '2026-11-09T12:00:00.000Z' }), velho: r({ updated_at: '2026-11-08T09:00:00.000Z' }) }, new Date('2026-11-09T13:00:00.000Z'));
    expect(Object.keys(mantidos)).toEqual(['novo']);
    expect(removidos).toEqual(['velho']);
  });

  it('RN-VEN-39: a edição de registro salvo também some 24 h depois da última alteração (relógio injetado); o registro salvo não é tocado', () => {
    const mapa = { 'edit:p9': r({ edit_order_id: 'p9', lines: {} }) };
    expect(rascunhosParaLista(mapa, depois(T0, 24 * HORA - 1))).toHaveLength(1);
    expect(rascunhosParaLista(mapa, depois(T0, 24 * HORA))).toEqual([]);
    const antes = limparRascunhosExpirados(mapa, depois(T0, 24 * HORA - 1));
    expect(Object.keys(antes.mantidos)).toEqual(['edit:p9']);
    const { mantidos, removidos } = limparRascunhosExpirados(mapa, depois(T0, 24 * HORA));
    expect(mantidos).toEqual({});
    expect(removidos).toEqual(['edit:p9']);
  });

  it('RN-VEN-39/48: o pedido salvo nunca expira (mora na aba Pedidos até ser enviado); edição e orçamento salvo seguem as 24 h', () => {
    const velho = '2026-11-01T09:00:00.000Z';
    const agora = new Date('2026-11-24T13:00:00.000Z');
    const salvo = r({ updated_at: velho, salvo_em: velho });
    expect(rascunhoExpirou(salvo, agora)).toBe(false);
    const { mantidos, removidos } = limparRascunhosExpirados({ salvo, edicao: r({ updated_at: velho, salvo_em: velho, edit_order_id: 'o1' }), orc: r({ updated_at: velho, salvo_em: velho, tipo: 'orcamento' }) }, agora);
    expect(Object.keys(mantidos)).toEqual(['salvo']);
    expect(removidos).toEqual(['edicao', 'orc']);
    expect(rascunhosParaLista({ salvo }, agora).map((l) => l.chave)).toEqual(['salvo']);
  });
});

describe('RN-VEN-39/48: vários pedidos salvos por cliente, cada um com id próprio', () => {
  const salvo = (extra: Partial<RascunhoMinimo> = {}) => r({ salvo_em: T0, ...extra });
  let n = 0;
  const novoId = () => `uuid-${++n}`;

  it('RN-VEN-39: o Novo pedido do cliente (em digitação) continua um por cliente: a chave é o cliente', () => {
    expect(chaveDoRascunhoNovo('c1')).toBe('c1');
  });

  it('RN-VEN-39/48: duplicar pedido existente grava em chave nova (nunca na do cliente); editar usa edit:<id>', () => {
    expect(chaveDaCopiaDoPedido('duplicate', 'o1', 'uuid-9')).toBe('uuid-9');
    expect(chaveDaCopiaDoPedido('duplicate', 'o1', 'uuid-9')).not.toBe(chaveDoRascunhoNovo('c1'));
    expect(chaveDaCopiaDoPedido('edit', 'o1', 'uuid-9')).toBe('edit:o1');
  });

  it('RN-VEN-48: a rota só leva o rascunhoId quando a chave é própria (salvo ou cópia)', () => {
    expect(rascunhoIdNaRota('uuid-3', 'c1')).toBe('uuid-3');
    expect(rascunhoIdNaRota('c1', 'c1')).toBeUndefined();
    expect(rascunhoIdNaRota('edit:o1', 'c1')).toBeUndefined();
  });

  it('RN-VEN-33: o id do pedido no envio é sempre UUID (chave de salvo vale; edit:<uuid> reenvia o editado; o resto gera id novo)', () => {
    const u = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';
    expect(idDoPedidoNoEnvio('c1', 'c1', u)).toBe(u);
    expect(idDoPedidoNoEnvio('7a1b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b', 'c1', u)).toBe('7a1b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b');
    expect(idDoPedidoNoEnvio('edit:7a1b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b', 'c1', u)).toBe('7a1b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b');
    expect(idDoPedidoNoEnvio('edit:o1', 'c1', u)).toBe(u);
    expect(idDoPedidoNoEnvio('qualquer', 'c1', u)).toBe(u);
  });

  it('RN-VEN-48: ao salvar, o rascunho do cliente passa a uma chave própria; já salvo ou cópia (chave própria) mantém a chave', () => {
    expect(chaveParaSalvar('c1', 'c1', 'uuid-9')).toBe('uuid-9');
    expect(chaveParaSalvar('uuid-3', 'c1', 'uuid-9')).toBe('uuid-3');
    expect(chaveParaSalvar('edit:o1', 'c1', 'uuid-9')).toBe('edit:o1');
    // RN-VEN-33: a mesma chave é o id do pedido enviado (o reenvio do salvo não duplica)
  });

  it('RN-VEN-48: Duplicar do salvo cria um rascunho novo com os mesmos itens e condições, sem salvo_em, aberto no Resumo, e o original fica intacto', () => {
    const original = salvo({ lines: { p1: 2, p2: 5 } });
    const copia = copiaDoPedidoSalvo(original, '2026-11-25T10:00:00.000Z');
    expect(copia).toMatchObject({ customer_id: 'c1', lines: { p1: 2, p2: 5 }, salvo_em: null, updated_at: '2026-11-25T10:00:00.000Z', aba: 'resumo' });
    expect(copia.lines).not.toBe(original.lines);
    expect(original.salvo_em).toBe(T0);
  });

  it('RN-VEN-39/48: migra o salvo guardado na chave do cliente para uma chave própria, sem perder nada', () => {
    n = 0;
    const entrada = { c1: salvo({ lines: { p1: 2 } }), c2: r({ customer_id: 'c2' }), 'edit:o1': r({ edit_order_id: 'o1', salvo_em: T0 }), c4: salvo({ customer_id: 'c4', tipo: 'orcamento' }) };
    const { rascunhos, movidos } = migrarSalvosParaChavePropria(entrada, novoId);
    expect(movidos).toEqual([{ de: 'c1', para: 'uuid-1' }]);
    expect(Object.keys(rascunhos).sort()).toEqual(['c2', 'c4', 'edit:o1', 'uuid-1']);
    expect(rascunhos['uuid-1']).toEqual(entrada.c1);
    expect(rascunhos.c2).toBe(entrada.c2);
  });

  it('RN-VEN-39/48: a migração é idempotente (rodar de novo não muda nada) e não duplica o salvo já copiado', () => {
    n = 0;
    const entrada = { c1: salvo() };
    const um = migrarSalvosParaChavePropria(entrada, novoId);
    const dois = migrarSalvosParaChavePropria(um.rascunhos, novoId);
    expect(dois.movidos).toEqual([]);
    expect(dois.rascunhos).toEqual(um.rascunhos);
    // gravação interrompida: a cópia já existe e a chave antiga também; a antiga só sai
    const parcial = migrarSalvosParaChavePropria({ c1: salvo(), 'uuid-7': salvo() }, novoId);
    expect(Object.keys(parcial.rascunhos)).toEqual(['uuid-7']);
    expect(parcial.movidos).toEqual([{ de: 'c1', para: 'uuid-7' }]);
  });

  it('RN-VEN-48: dois salvos do mesmo cliente convivem na lista e nenhum vence em 24 h', () => {
    const agora = depois(T0, 30 * HORA);
    const lista = rascunhosParaLista({ 'uuid-1': salvo(), 'uuid-2': salvo({ updated_at: '2026-11-09T11:00:00.000Z' }), c1: r() }, agora);
    expect(lista.map((l) => l.chave)).toEqual(['uuid-2', 'uuid-1']);
  });
});
