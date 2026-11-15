import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpretarConfig } from '../src/config/carregar';
import { mapearEValidar } from '../src/mapeamento';
import { parametrosCabecalho } from '../src/pedidos';
import { PedidoParaErp } from '@macuxi/integracao/contracts';
import { VERSAO_CONECTOR } from '../src/versao';

const ler = (nome: string) => interpretarConfig(readFileSync(join(__dirname, '..', 'exemplos', nome), 'utf8'), 'json');
const cfg = ler('conector.exemplo.json').entidades.prazo_pagamento!;
const base = { external_id: 'P1', alterado_em: new Date('2026-03-01T10:00:00Z'), ativo: true, forma_external_id: 'F1', codigo: '30', descricao: '30 dias', parcelas_dias: '[30]', prazo_medio_dias: 30, ordem: 1 };
const rodar = (extra: Record<string, unknown>) => mapearEValidar('prazo_pagamento', cfg, [{ ...base, ...extra }]);

const UUID = '6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f01';
const pedido = (extra: Record<string, unknown> = {}) =>
  PedidoParaErp.parse({
    versao_contrato: 'v1', pedido_uuid: UUID, cliente_external_id: 'c1', vendedor_external_id: 'v1', condicao_pagamento_erp: '30D',
    criado_em: '2026-03-10T11:00:00Z', aprovado_em: '2026-03-10T11:30:00Z', total_cents: 3000,
    itens: [{ sequencia: 1, produto_external_id: 'p1', quantidade: 3, preco_unitario_cents: 1000, total_cents: 3000 }],
    ...extra,
  });
const pg = (extra: Record<string, unknown> = {}) => ({ forma_codigo: 'BOL', prazo_codigo: '30', parcelas_dias: [30], prazo_medio_dias: 30, ...extra });

describe('RN-INT-15: leitura do % de ajuste do prazo (Conector 1.5.0)', () => {
  it('RN-INT-15: coluna numérica ou em texto (pg/Oracle, com vírgula) vira percentual_ajuste', () => {
    expect(rodar({ percentual_ajuste: -1.71 }).registros[0]?.percentual_ajuste).toBe(-1.71);
    expect(rodar({ percentual_ajuste: '-1.71' }).registros[0]?.percentual_ajuste).toBe(-1.71);
    expect(rodar({ percentual_ajuste: '2,5' }).registros[0]?.percentual_ajuste).toBe(2.5);
  });

  it('RN-INT-15: sem a coluna na linha, o registro não leva a chave', () => {
    const r = rodar({});
    expect(r.registros).toHaveLength(1);
    expect('percentual_ajuste' in (r.registros[0] ?? {})).toBe(false);
  });

  it('RN-INT-15: coluna NULL, o registro não leva a chave', () => {
    const r = rodar({ percentual_ajuste: null });
    expect(r.registros).toHaveLength(1);
    expect('percentual_ajuste' in (r.registros[0] ?? {})).toBe(false);
  });

  it('RN-INT-15: 100.5 e 1.234 invalidam a linha, sem o valor na mensagem', () => {
    for (const v of [100.5, 1.234]) {
      const r = rodar({ percentual_ajuste: v });
      expect(r.registros).toHaveLength(0);
      expect(r.problemas.length).toBeGreaterThan(0);
      expect(JSON.stringify(r.problemas)).not.toContain(String(v));
    }
  });

  it('RN-INT-15: os exemplos leem com SELECT * e mapeiam percentual_ajuste como número', () => {
    for (const nome of ['conector.exemplo.json', 'conector.oracle.exemplo.json']) {
      const e = ler(nome).entidades.prazo_pagamento;
      expect(e?.consulta, nome).toMatch(/SELECT (TOP \(:limite\) )?\* FROM /);
      expect(e?.campos.percentual_ajuste, nome).toEqual({ coluna: 'percentual_ajuste', transformar: 'numero' });
    }
  });
});

describe('RN-INT-15: % de ajuste no pedido (Hub para ERP), só informativo', () => {
  it('RN-INT-15: pagamento.percentual_ajuste vira pagamento_percentual_ajuste', () => {
    expect(parametrosCabecalho(pedido({ pagamento: pg({ percentual_ajuste: -1.71 }) })).pagamento_percentual_ajuste).toBe(-1.71);
  });

  it('RN-INT-15: sem o campo ou sem pagamento, o parâmetro vai null', () => {
    expect(parametrosCabecalho(pedido({ pagamento: pg() })).pagamento_percentual_ajuste).toBeNull();
    expect(parametrosCabecalho(pedido()).pagamento_percentual_ajuste).toBeNull();
  });

  it('RN-INT-15: o Conector não recalcula preço nem total', () => {
    const p = pedido({ pagamento: pg({ percentual_ajuste: 5 }) });
    const c = parametrosCabecalho(p);
    expect(c.total_cents).toBe(p.total_cents);
    expect(c.desconto_total_cents).toBe(p.desconto_total_cents ?? null);
  });

  it('RN-INT-15: o EXEC do SQL Server e o INSERT do Oracle citam o parâmetro', () => {
    expect(ler('conector.exemplo.json').pedidos?.gravacao.cabecalho).toContain('@pagamento_percentual_ajuste = :pagamento_percentual_ajuste');
    const o = ler('conector.oracle.exemplo.json').pedidos?.gravacao.cabecalho ?? '';
    expect(o).toContain(', pagamento_percentual_ajuste)');
    expect(o).toContain(':pagamento_percentual_ajuste');
  });

  it('RN-INT-15: o Conector é a versão 1.5.0', () => {
    expect(VERSAO_CONECTOR).toBe('1.5.0');
  });
});
