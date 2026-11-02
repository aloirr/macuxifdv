import { describe, expect, it } from 'vitest';
import { ConfigConector, type EntidadeConfig } from '../src/config/esquema';
import { compararCursor, mapearEValidar, mapearLinha } from '../src/mapeamento';
import { configDeTeste } from './suporte/ambiente';

const cfgCliente = (extra: Partial<EntidadeConfig> = {}): EntidadeConfig => ({ ...(configDeTeste('http://127.0.0.1:1', '.').entidades.cliente as EntidadeConfig), ...extra });

describe('mapeamento coluna → campo do contrato', () => {
  it('converte tipos do ERP: datas UTC, booleanos, centavos de decimal, JSON e caminho com ponto', () => {
    const cfg = ConfigConector.parse({
      hub: { url: 'https://h.example.com', conectorId: 'cnx-1' },
      erp: { tipo: 'sqlserver', host: 'h', banco: 'b', usuario: 'u' },
      entidades: {
        cliente: {
          consulta: 'SELECT :cursor_alterado_em, :cursor_external_id, :limite',
          campos: {
            external_id: 'COD', alterado_em: 'ALT', razao_social: 'RS', bloqueado: { coluna: 'BLQ', transformar: 'booleano' },
            limite_credito_cents: { coluna: 'LIM', transformar: 'centavos_de_decimal' }, 'endereco.cidade': 'CID',
            contatos: { coluna: 'CT', transformar: 'json' }, ativo: { valor: true },
          },
        },
      },
    }).entidades.cliente as EntidadeConfig;
    const m = mapearLinha(cfg, { cod: 77, ALT: new Date('2026-01-02T03:04:05.678Z'), RS: 'Mercado Sol', BLQ: 'S', LIM: '1234.5', CID: 'Boa Vista', CT: '[{"nome":"Ana"}]' }, 0);
    expect(m.registro).toMatchObject({
      external_id: '77', alterado_em: '2026-01-02T03:04:05.678Z', bloqueado: true, limite_credito_cents: 123450,
      endereco: { cidade: 'Boa Vista' }, contatos: [{ nome: 'Ana' }], ativo: true,
    });
  });

  it('alterado_em aceita milissegundos, texto sem fuso (UTC) e texto com fuso', () => {
    const c = cfgCliente();
    const ms = Date.parse('2026-05-05T10:00:00.123Z');
    expect(mapearLinha(c, { external_id: 'a', alterado_em: ms }, 0).alterado_ms).toBe(ms);
    expect(mapearLinha(c, { external_id: 'a', alterado_em: '2026-05-05 10:00:00.123' }, 0).alterado_ms).toBe(ms);
    expect(mapearLinha(c, { external_id: 'a', alterado_em: '2026-05-05T07:00:00.123-03:00' }, 0).alterado_ms).toBe(ms);
    expect(mapearLinha(c, { external_id: 'a', alterado_em: 'ontem' }, 0).alterado_ms).toBeNull();
  });

  it('valida com o schema do contrato e as mensagens de erro nunca carregam o valor da linha', () => {
    const linhas = [
      { external_id: 'c1', alterado_em: new Date('2026-01-01T00:00:00Z'), razao_social: 'Padaria 12.345.678/0001-95', bloqueado: false },
      { external_id: 'c2', alterado_em: new Date('2026-01-01T00:00:01Z'), razao_social: null, bloqueado: false },
    ];
    const r = mapearEValidar('cliente', cfgCliente(), linhas);
    expect(r.invalidas).toBe(1);
    expect(r.problemas).toEqual([{ posicao: 1, external_id: 'c2', campo: 'razao_social', codigo: 'campo_obrigatorio', mensagem: 'campo obrigatório sem valor' }]);
    expect(JSON.stringify(r.problemas)).not.toMatch(/Padaria|12\.345/);
  });

  it('RN-INT-03: linha inválida vai ao Hub COM o motivo (em linhas_invalidas, não em registros); com linhasInvalidas=descartar fica só no log local', () => {
    const linhas = [{ external_id: 'c2', alterado_em: new Date('2026-01-01T00:00:01Z'), razao_social: null }];
    const enviar = mapearEValidar('cliente', cfgCliente(), linhas);
    expect(enviar.registros).toHaveLength(0);
    expect(enviar.linhasInvalidas).toEqual([{ external_id: 'c2', codigo: 'campo_obrigatorio', campo: 'razao_social', mensagem: 'campo obrigatório sem valor' }]);
    const descartar = mapearEValidar('cliente', cfgCliente({ linhasInvalidas: 'descartar' }), linhas);
    expect(descartar.registros).toHaveLength(0);
    expect(descartar.linhasInvalidas).toHaveLength(0);
    expect(descartar.invalidas).toBe(1); // continua contando e indo ao log local
  });

  it('linha sem external_id ou sem alterado_em legível é descartada (sem eles não existe cursor)', () => {
    const r = mapearEValidar('cliente', cfgCliente(), [
      { external_id: null, alterado_em: new Date('2026-01-01T00:00:00Z'), razao_social: 'x' },
      { external_id: 'k', alterado_em: null, razao_social: 'y' },
      { external_id: 'ok', alterado_em: new Date('2026-01-01T00:00:00Z'), razao_social: 'z' },
    ]);
    expect(r.descartadas).toBe(2);
    expect(r.registros).toHaveLength(1);
  });

  it('o cursor declarado é o maior par; o de leitura é o da última linha na ordem da consulta', () => {
    const r = mapearEValidar('cliente', cfgCliente(), [
      { external_id: 'b', alterado_em: new Date('2026-01-01T00:00:02Z'), razao_social: 'x' },
      { external_id: 'a', alterado_em: new Date('2026-01-01T00:00:02Z'), razao_social: 'y' },
    ]);
    expect(r.cursor).toEqual({ alterado_em: '2026-01-01T00:00:02.000Z', external_id: 'b' });
    expect(r.ultimo).toEqual({ alterado_em: '2026-01-01T00:00:02.000Z', external_id: 'a' });
  });

  it('ordem do cursor: instante primeiro, empate pelo external_id (igual ao Hub, RN-INT-05)', () => {
    const a = { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a' };
    expect(compararCursor(a, { ...a, external_id: 'b' })).toBe(-1);
    expect(compararCursor({ ...a, alterado_em: '2026-01-01T00:00:00.001Z' }, { ...a, external_id: 'z' })).toBe(1);
    expect(compararCursor(a, a)).toBe(0);
  });

  it('colunas não diferenciam maiúsculas (aliases de SQL Server e PostgreSQL)', () => {
    const m = mapearLinha(cfgCliente(), { EXTERNAL_ID: 'x', ALTERADO_EM: new Date('2026-01-01T00:00:00Z'), RAZAO_SOCIAL: 'R' }, 0);
    expect(m.registro.razao_social).toBe('R');
    expect(m.external_id).toBe('x');
  });
});
