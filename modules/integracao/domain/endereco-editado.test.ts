import { describe, expect, it } from 'vitest';
import { EnderecoEntregaErp, PedidoAprovadoParaFila, PedidoParaErp, VERSAO_CONTRATO, type PedidoAprovadoParaFila as Snapshot } from '../contracts';
import { exigeConector } from './pedido-versao';
import { montarPedidoParaErp, type Mapeamento } from './pedido-fila';

const mapas: Mapeamento[] = [{ tipo: 'condicao_pagamento', codigo_erp: '007', codigo_macuxi: '30DD', ativo: true }];
const base = (extra: Partial<Snapshot> = {}): Snapshot => ({
  pedido_uuid: '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b',
  cliente_external_id: 'C1',
  vendedor_external_id: 'V1',
  condicao_pagamento_codigo: '30DD',
  criado_em: '2026-11-01T09:00:00.000Z',
  aprovado_em: '2026-11-01T09:30:00.000Z',
  itens: [{ sequencia: 1, produto_external_id: 'SKU1', quantidade: 10, preco_unitario_cents: 500, desconto_cents: 0, total_cents: 5000 }],
  desconto_total_cents: 0,
  total_cents: 5000,
  ...extra,
});
const editado = { external_id: null, logradouro: 'Rua Nova', numero: 'S/N', complemento: null, bairro: 'Centro', cidade: 'Boa Vista', uf: 'rr', cep: '69301000', principal: false, origem: 'editado' as const };
const doErp = { external_id: 'END-2', logradouro: 'Av. do ERP', numero: '10', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69301000', principal: false, origem: 'erp' as const };

describe('RN-VEN-17 / T-0141: endereço editado na devolução ao ERP (aditivo no v1)', () => {
  it('RN-VEN-17: origem editado é válida, com external_id nulo, e a versão do contrato continua v1', () => {
    const r = EnderecoEntregaErp.parse(editado);
    expect(r).toMatchObject({ origem: 'editado', external_id: null, uf: 'RR' });
    expect(VERSAO_CONTRATO).toBe('v1');
  });

  it('RN-VEN-17: origem fora de erp/editado é recusada; origem ausente ou nula continua válida (endereço do ERP)', () => {
    expect(EnderecoEntregaErp.safeParse({ ...editado, origem: 'outro' }).success).toBe(false);
    const { origem: _o, ...semOrigem } = editado;
    expect(EnderecoEntregaErp.safeParse(semOrigem).success).toBe(true);
    expect(EnderecoEntregaErp.safeParse({ ...editado, origem: null }).success).toBe(true);
  });

  it('RN-VEN-17: o Hub repassa origem, textos e external_id nulo do evento ao pedido do Conector (origem não é descartada)', () => {
    const snap = PedidoAprovadoParaFila.parse(base({ endereco_entrega: editado }));
    const r = montarPedidoParaErp(snap, mapas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pedido.endereco_entrega).toMatchObject({ origem: 'editado', external_id: null, logradouro: 'Rua Nova', numero: 'S/N', cidade: 'Boa Vista', uf: 'RR', cep: '69301000' });
    expect(PedidoParaErp.safeParse(r.pedido).success).toBe(true);
  });

  it('RN-VEN-17: endereço do ERP escolhido segue com external_id preenchido e origem erp', () => {
    const r = montarPedidoParaErp(PedidoAprovadoParaFila.parse(base({ endereco_entrega: doErp })), mapas);
    expect(r.ok && r.pedido.endereco_entrega).toMatchObject({ origem: 'erp', external_id: 'END-2' });
  });

  it('RN-VEN-17: Conector antigo x novo — editado tem principal falso e exige o 1.3.0 (o 1.2.x deixa o pedido na fila)', () => {
    const r = montarPedidoParaErp(PedidoAprovadoParaFila.parse(base({ endereco_entrega: editado })), mapas);
    if (!r.ok) throw new Error('montagem falhou');
    expect(exigeConector(r.pedido)).toBe('1.3.0');
  });

  it('RN-VEN-17: compatibilidade com o Conector 1.3.x, que não conhece origem — sem origem, os textos e o external_id nulo bastam para o SQL', () => {
    const { origem: _o, ...visto } = EnderecoEntregaErp.parse(editado);
    expect(visto.external_id ?? null).toBeNull();
    expect(visto).toMatchObject({ logradouro: 'Rua Nova', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69301000' });
  });

  it('RN-VEN-17: pedido sem endereço ou com endereço antigo (sem origem) sai idêntico — o payload não ganha campo novo', () => {
    const semEnd = montarPedidoParaErp(PedidoAprovadoParaFila.parse(base()), mapas);
    expect(semEnd.ok && 'endereco_entrega' in semEnd.pedido).toBe(false);
    const { origem: _o, ...antigo } = doErp;
    const r = montarPedidoParaErp(PedidoAprovadoParaFila.parse(base({ endereco_entrega: antigo })), mapas);
    expect(r.ok && r.pedido.endereco_entrega).toEqual(EnderecoEntregaErp.parse(antigo));
    expect(r.ok && 'origem' in (r.pedido.endereco_entrega ?? {})).toBe(false);
  });
});
