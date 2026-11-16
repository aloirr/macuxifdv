import { PedidoParaErp } from '@macuxi/integracao/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { cicloPedidos, parametrosCabecalho } from '../src/pedidos';
import { compararVersoes, VERSAO_CONECTOR } from '../src/versao';
import { type Ambiente, criarAmbiente } from './suporte/ambiente';

let amb: Ambiente | undefined;
afterEach(async () => {
  const a = amb;
  amb = undefined;
  await a?.encerrar();
});

const UUID = '6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f02';
const pedido = (extra: Record<string, unknown> = {}) =>
  PedidoParaErp.parse({
    versao_contrato: 'v1', pedido_uuid: UUID, cliente_external_id: 'c1', vendedor_external_id: 'v1', condicao_pagamento_erp: '30D',
    criado_em: '2026-11-10T11:00:00Z', aprovado_em: '2026-11-10T11:30:00Z', total_cents: 1000,
    itens: [{ sequencia: 1, produto_external_id: 'p1', quantidade: 1, preco_unitario_cents: 1000, total_cents: 1000 }],
    ...extra,
  });
const PEDIDOS = {
  gravacao: { cabecalho: '/*cab*/ INSERT INTO pedido VALUES (:pedido_uuid, :filial_codigo, :filial_external_id)', itens: '/*item*/ INSERT INTO item VALUES (:pedido_uuid, :sequencia)', numeroErp: '/*num*/ SELECT numero_erp FROM pedido WHERE uuid = :pedido_uuid' },
  status: { consulta: '/*st*/ SELECT * FROM v WHERE pedido_uuid = :pedido_uuid', mapaStatus: { I: 'integrado' } },
};

async function gravarCom(p: PedidoParaErp): Promise<Record<string, unknown>> {
  amb = await criarAmbiente({ pedidos: PEDIDOS });
  amb.hub.pedidosParaEntregar = [p];
  const vistos: Record<string, unknown>[] = [];
  amb.erp.onExecucao = (sql, par) => void (sql.includes('/*cab*/') && vistos.push(par));
  amb.erp.onConsulta = () => [{ numero_erp: 'PV-1' }];
  await cicloPedidos(amb.ctx);
  return vistos[0] ?? {};
}

describe('RN-CORE-39 (T-0149): filial do pedido na gravação do Conector 1.4.0', () => {
  it('RN-CORE-39: o Conector é 1.4.0 ou mais novo (a partir da 1.4.0 o Hub aceita pedido de filial não padrão)', () => {
    expect(compararVersoes(VERSAO_CONECTOR, '1.4.0')).toBeGreaterThanOrEqual(0);
  });

  it('RN-CORE-39: o cabeçalho recebe filial_codigo e filial_external_id do pedido da filial Boa Vista', async () => {
    const v = await gravarCom(pedido({ filial: { codigo: '0002', external_id: 'FIL-BV', nome: 'Boa Vista', padrao: false } }));
    expect(v).toMatchObject({ filial_codigo: '0002', filial_external_id: 'FIL-BV' });
  });

  it('RN-CORE-39: pedido sem filial (ou da filial sem chave do ERP) grava nulos = filial padrão do ERP', async () => {
    expect(await gravarCom(pedido())).toMatchObject({ filial_codigo: null, filial_external_id: null });
    await amb?.encerrar();
    expect(await gravarCom(pedido({ filial: { codigo: '0001', external_id: null, padrao: true } }))).toMatchObject({ filial_codigo: '0001', filial_external_id: null });
  });
});

describe('RN-VEN-16/17/24 (T-0149, Conector 1.4.0): frete, endereço de entrega e pagamento no SQL do cabeçalho', () => {
  it('RN-VEN-16: frete FOB com transportadora cadastrada repassa modalidade e dados da transportadora', () => {
    const t = { tipo: 'cadastrada', id: '6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f10', external_id: 'TR-9', nome: 'Rápido Norte', cnpj: '12345678000190' };
    expect(parametrosCabecalho(pedido({ frete: { modalidade: 'FOB', transportadora: t } }))).toMatchObject({
      frete_modalidade: 'FOB', frete_transportadora_tipo: 'cadastrada', frete_transportadora_external_id: 'TR-9', frete_transportadora_nome: 'Rápido Norte', frete_transportadora_cnpj: '12345678000190',
    });
  });

  it('RN-VEN-16: FOB com transportadora digitada leva nome e CNPJ, sem id nem external_id; CIF só a modalidade', () => {
    const p = parametrosCabecalho(pedido({ frete: { modalidade: 'FOB', transportadora: { tipo: 'digitada', nome: 'Trans X', cnpj: '12345678000190' } } }));
    expect(p).toMatchObject({ frete_transportadora_tipo: 'digitada', frete_transportadora_nome: 'Trans X', frete_transportadora_id: null, frete_transportadora_external_id: null });
    expect(parametrosCabecalho(pedido({ frete: { modalidade: 'CIF' } }))).toMatchObject({ frete_modalidade: 'CIF', frete_transportadora_nome: null });
  });

  it('RN-VEN-17: endereço editado chega com origem editado e external_id nulo (o SQL usa os textos)', () => {
    const p = parametrosCabecalho(pedido({ endereco_entrega: { external_id: null, origem: 'editado', logradouro: 'Rua A', numero: '10', cidade: 'Boa Vista', uf: 'rr', cep: '69300000', principal: false } }));
    expect(p).toMatchObject({ entrega_origem: 'editado', entrega_external_id: null, entrega_logradouro: 'Rua A', entrega_numero: '10', entrega_uf: 'RR', entrega_cep: '69300000', entrega_principal: false });
  });

  it('RN-VEN-17: endereço do cadastro sem origem vale erp e leva o external_id', () => {
    const p = parametrosCabecalho(pedido({ endereco_entrega: { external_id: 'END-1', logradouro: 'Av B', cidade: 'Manaus', uf: 'AM', principal: true } }));
    expect(p).toMatchObject({ entrega_origem: 'erp', entrega_external_id: 'END-1', entrega_principal: true });
  });

  it('RN-VEN-24: forma, prazo e prazo médio vão ao cabeçalho; parcelas em texto "30,60"', () => {
    const p = parametrosCabecalho(pedido({ pagamento: { forma_codigo: 'BOL', forma_external_id: 'F1', prazo_codigo: '30/60', prazo_external_id: null, parcelas_dias: [30, 60], prazo_medio_dias: 45 } }));
    expect(p).toMatchObject({ pagamento_forma_codigo: 'BOL', pagamento_forma_external_id: 'F1', pagamento_prazo_codigo: '30/60', pagamento_prazo_external_id: null, pagamento_parcelas_dias: '30,60', pagamento_prazo_medio_dias: 45 });
  });

  it('RN-INT-08: pedido antigo (sem frete, endereço, pagamento) grava tudo nulo, nunca undefined', () => {
    const p = parametrosCabecalho(pedido());
    for (const k of ['frete_modalidade', 'entrega_origem', 'entrega_logradouro', 'pagamento_forma_codigo', 'pagamento_parcelas_dias']) expect(p[k]).toBeNull();
    expect(Object.values(p).includes(undefined)).toBe(false);
  });

  it('RN-VEN-17: o cabeçalho gravado no ERP recebe os parâmetros novos', async () => {
    const v = await gravarCom(pedido({ frete: { modalidade: 'CIF' }, pagamento: { forma_codigo: 'PIX', prazo_codigo: 'AV', parcelas_dias: [0], prazo_medio_dias: 0 } }));
    expect(v).toMatchObject({ frete_modalidade: 'CIF', pagamento_forma_codigo: 'PIX', pagamento_parcelas_dias: '0' });
  });
});
