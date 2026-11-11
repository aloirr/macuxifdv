/**
 * T-0149 / ADR 0040 / RN-CORE-39: filial no Hub v1 (aditivo): entidade `filial`, `filial_external_id` em cliente, preço, estoque e
 * escalonada, filial no pedido devolvido ao ERP e Conector 1.4.0 para pedido de filial que não é a padrão.
 */
import { describe, expect, it } from 'vitest';
import { CAMPO_SOMA_CONTROLE, ENTIDADES, EVENTOS_ATUALIZADO, PedidoAprovadoParaFila, PedidoParaErp, SCHEMA_REGISTRO, VERSAO_CONTRATO, type PedidoParaErp as PedidoErp } from '../contracts';
import { validarLinhas } from './idempotencia';
import { ordenarCarga, referenciasDoRegistro } from './ordem';
import { conectorAtendePedido, exigeConector, VERSAO_CONECTOR_FILIAL } from './pedido-versao';
import { montarPedidoParaErp, selecionarPendentes, type PedidoNaFila } from './pedido-fila';

const T = '2026-11-10T12:00:00Z';
const base = { alterado_em: T };

const item = { sequencia: 1, produto_external_id: 'P1', quantidade: 10, preco_unitario_cents: 120, desconto_cents: 0, total_cents: 1200 };
const pedido = (extra: Record<string, unknown> = {}): PedidoErp =>
  PedidoParaErp.parse({ versao_contrato: VERSAO_CONTRATO, pedido_uuid: '11111111-1111-4111-8111-111111111111', cliente_external_id: 'C1', vendedor_external_id: 'V1', criado_em: T, aprovado_em: T, itens: [item], total_cents: 1200, ...extra });
const boaVista = { codigo: '0002', external_id: 'FIL-BV', nome: 'Boa Vista', padrao: false };
const manaus = { codigo: '0001', external_id: null, nome: 'Manaus', padrao: true };

describe('RN-CORE-39: entidade filial no contrato do Hub', () => {
  it('RN-CORE-39: filial entra aditiva no v1, com evento atualizado@1 e soma de controle só por contagem', () => {
    expect(ENTIDADES).toContain('filial');
    expect(Object.keys(SCHEMA_REGISTRO).sort()).toEqual([...ENTIDADES].sort());
    expect(EVENTOS_ATUALIZADO.filial).toBeDefined();
    expect(CAMPO_SOMA_CONTROLE.filial).toBeNull();
  });

  const completa = { cnpj: '11.222.333/0001-81', logradouro: 'Av. Ville Roy', numero: '1500', bairro: 'Centro', cep: '69301-000', cidade: 'Boa Vista', uf: 'rr' };

  it('RN-INT-03: filial válida passa (UF em maiúsculas); sem código, nome longo ou UF de 3 letras viram erro de linha legível', () => {
    const r = validarLinhas('filial', [
      { ...base, external_id: 'F1', codigo: '0002', nome: 'Boa Vista', ...completa },
      { ...base, external_id: 'F3', nome: 'Sem código', ...completa },
      { ...base, external_id: 'F4', codigo: '0004', nome: 'Z'.repeat(81), ...completa },
      { ...base, external_id: 'F5', codigo: '0005', nome: 'UF ruim', ...completa, uf: 'BRA' },
    ]);
    expect(r.validas.map((l) => l.external_id)).toEqual(['F1']);
    expect((r.validas[0]?.registro as { uf: string }).uf).toBe('RR');
    expect(r.erros.map((e) => e.campo).sort()).toEqual(['codigo', 'nome', 'uf']);
  });

  it('RN-CORE-39: a carga rejeita a filial sem CNPJ válido ou sem endereço (logradouro, número, bairro, CEP, cidade, UF), com erro por campo', () => {
    const r = validarLinhas('filial', [
      { ...base, external_id: 'A', codigo: '1', nome: 'Sem CNPJ', ...completa, cnpj: undefined },
      { ...base, external_id: 'B', codigo: '2', nome: 'CNPJ ruim', ...completa, cnpj: '11222333000182' },
      { ...base, external_id: 'C', codigo: '3', nome: 'Sem endereço', cnpj: completa.cnpj, cidade: 'Boa Vista', uf: 'RR' },
      { ...base, external_id: 'D', codigo: '4', nome: 'Sem número', ...completa, numero: '  ' },
      { ...base, external_id: 'E', codigo: '5', nome: 'Completa', ...completa, complemento: 'Sala 2', telefone: '9532240000' },
    ]);
    expect(r.validas.map((l) => l.external_id)).toEqual(['E']);
    const campos = (id: string) => r.erros.filter((e) => e.external_id === id).map((e) => e.campo).sort();
    expect(campos('A')).toEqual(['cnpj']);
    expect(campos('B')).toEqual(['cnpj']);
    expect(campos('C')).toEqual(['bairro', 'cep', 'logradouro', 'numero']);
    expect(campos('D')).toEqual(['numero']);
  });

  it('RN-INT-04: filial carrega antes de cliente, preço, estoque e tabela escalonada, em qualquer ordem pedida', () => {
    const r = ordenarCarga(['estoque', 'tabela_escalonada', 'preco', 'cliente', 'produto', 'vendedor', 'filial']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pos = (e: string) => r.ordem.indexOf(e as never);
    for (const e of ['cliente', 'preco', 'estoque', 'tabela_escalonada']) expect(pos('filial')).toBeLessThan(pos(e));
  });

  it('RN-INT-04: filial_external_id é referência por chave no cliente, preço, estoque e escalonada; a ausente (padrão) não gera referência', () => {
    for (const e of ['cliente', 'preco', 'estoque', 'tabela_escalonada'] as const) {
      expect(referenciasDoRegistro(e, { filial_external_id: 'FIL-BV' }).some((x) => x.entidade === 'filial' && x.external_id === 'FIL-BV'), e).toBe(true);
      expect(referenciasDoRegistro(e, { filial_external_id: null }).some((x) => x.entidade === 'filial'), e).toBe(false);
      expect(referenciasDoRegistro(e, {}).some((x) => x.entidade === 'filial'), e).toBe(false);
    }
  });
});

describe('RN-CORE-39: filial_external_id aditivo nas entidades existentes', () => {
  it('RN-INT-02: cliente, preço, estoque e escalonada aceitam filial_external_id; sem ele (e com null) continuam válidos', () => {
    const casos = {
      cliente: { external_id: 'C1', razao_social: 'Mercado A Ltda' },
      preco: { external_id: 'PR1', tabela_external_id: 'T1', tabela_nome: 'Varejo', vigencia_inicio: '2026-11-01', produto_external_id: 'P1', preco_cents: 100 },
      estoque: { external_id: 'E1', deposito_external_id: 'D1', produto_external_id: 'P1', saldo: 5 },
      tabela_escalonada: { external_id: 'ES1', produto_external_id: 'P1', quantidade_minima: 10, preco_unidade_cents: 90, vigencia_inicio: '2026-11-01' },
    } as const;
    for (const [e, reg] of Object.entries(casos)) {
      const ent = e as keyof typeof casos;
      const r = validarLinhas(ent, [
        { ...base, ...reg },
        { ...base, ...reg, external_id: 'X2', filial_external_id: 'FIL-BV' },
        { ...base, ...reg, external_id: 'X3', filial_external_id: null },
      ]);
      expect(r.erros, e).toEqual([]);
      const filiais = r.validas.map((l) => (l.registro as { filial_external_id?: string | null }).filial_external_id);
      expect(filiais, e).toEqual([undefined, 'FIL-BV', null]);
    }
  });
});

describe('RN-CORE-39: filial no pedido devolvido ao ERP', () => {
  it('RN-INT-08: PedidoParaErp.filial é opcional e aceita null (pedido antigo segue válido)', () => {
    expect(pedido().filial).toBeUndefined();
    expect(pedido({ filial: null }).filial).toBeNull();
    expect(pedido({ filial: boaVista }).filial?.codigo).toBe('0002');
    expect(PedidoParaErp.safeParse({ ...pedido(), filial: { external_id: 'X' } }).success).toBe(false);
  });

  it('RN-INT-08: o repasse da filial vai do pedido aprovado ao payload do ERP; sem filial, o payload é o mesmo de antes (sem chave extra)', () => {
    const origem = (extra: Record<string, unknown>) =>
      PedidoAprovadoParaFila.parse({ pedido_uuid: '55555555-5555-4555-8555-555555555555', cliente_external_id: 'C1', vendedor_external_id: 'V1', criado_em: T, aprovado_em: T, itens: [item], total_cents: 1200, ...extra });
    const com = montarPedidoParaErp(origem({ filial: boaVista }), []);
    expect(com.ok && com.pedido.filial?.codigo).toBe('0002');
    expect(com.ok && com.pedido.filial?.external_id).toBe('FIL-BV');
    const sem = montarPedidoParaErp(origem({}), []);
    expect(sem.ok && 'filial' in sem.pedido).toBe(false);
  });

  it('RN-CORE-39: pedido de filial que não é a padrão exige o Conector 1.4.0; o da padrão (ou sem filial) vai a qualquer Conector', () => {
    expect(VERSAO_CONECTOR_FILIAL).toBe('1.4.0');
    expect(exigeConector(pedido({ filial: boaVista }))).toBe('1.4.0');
    expect(exigeConector(pedido({ filial: manaus }))).toBeNull();
    expect(exigeConector(pedido({ filial: null }))).toBeNull();
    expect(exigeConector(pedido())).toBeNull();
  });

  it('RN-CORE-39: a exigência maior vence (FOB + filial não padrão = 1.4.0)', () => {
    const fob = { modalidade: 'FOB', transportadora: { tipo: 'digitada', nome: 'Rápido', cnpj: '12345678000199' } };
    expect(exigeConector(pedido({ frete: fob, filial: boaVista }))).toBe('1.4.0');
    expect(exigeConector(pedido({ frete: fob, filial: manaus }))).toBe('1.3.0');
  });

  it('RN-CORE-39: pedido da filial Boa Vista espera na fila no Conector 1.3.x (não é recusado) e sai no 1.4.0', () => {
    const naFila = (p: PedidoErp): PedidoNaFila => ({
      pedido_uuid: p.pedido_uuid, estado: 'pendente', payload: p, retencao_codigo: null, enviado_em: null, tentativas: 0, numero_erp: null, motivo: null,
      notas_aplicadas: [], itens_faturados_acumulados: {}, removido_em: null,
    });
    const bv = pedido({ filial: boaVista });
    const pad = pedido({ pedido_uuid: '22222222-2222-4222-8222-222222222222', filial: manaus });
    const fila = [naFila(bv), naFila(pad)];
    expect(selecionarPendentes(fila, T, { versaoConector: '1.3.0' }).entregar.map((p) => p.pedido_uuid)).toEqual([pad.pedido_uuid]);
    expect(selecionarPendentes(fila, T, { versaoConector: '1.4.0' }).entregar).toHaveLength(2);
    expect(conectorAtendePedido('1.3.9', exigeConector(bv))).toBe(false);
  });
});
