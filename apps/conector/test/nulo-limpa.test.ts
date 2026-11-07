/**
 * T-0099: opt-in por campo `"nulo": "limpa"` no conector.json. Com ele, o NULL da view vai ao Hub como `null` e LIMPA o campo no
 * Macuxi; sem ele (padrão, `"omite"`), o comportamento da v1 não muda: o NULL some do registro e o Macuxi mantém o que tinha.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ErroConfig, interpretarConfig } from '../src/config/carregar';
import { campoAceitaNulo } from '../src/config/entidades';
import type { EntidadeConfig } from '../src/config/esquema';
import { mapearEValidar, mapearLinha } from '../src/mapeamento';
import { processarFila } from '../src/remetente';
import { sincronizarEntidade } from '../src/sincronizador';
import { type Ambiente, criarAmbiente } from './suporte/ambiente';

const CONSULTA = '/*cliente*/ SELECT * FROM v WHERE alterado_em > :cursor_alterado_em OR (alterado_em = :cursor_alterado_em AND external_id > :cursor_external_id) ORDER BY alterado_em, external_id LIMIT :limite';
const CAMPOS = {
  external_id: 'external_id',
  alterado_em: 'alterado_em',
  razao_social: 'razao_social',
  limite_credito_cents: { coluna: 'limite', transformar: 'centavos_de_decimal', nulo: 'limpa' },
  prazo_medio_max_dias: { coluna: 'prazo', transformar: 'inteiro' }, // sem opt-in: omite
  formas_pagamento: { coluna: 'formas', transformar: 'json', nulo: 'limpa' },
  'endereco.cidade': { coluna: 'cidade', nulo: 'limpa' },
  vendedor_external_id: { coluna: 'vendedor', nulo: 'omite' },
};

const configCom = (campos: Record<string, unknown>) =>
  interpretarConfig(
    JSON.stringify({
      hub: { url: 'https://h.example.com', conectorId: 'cnx-1' },
      erp: { tipo: 'postgres', host: 'h', banco: 'b', usuario: 'u' },
      entidades: { cliente: { consulta: CONSULTA, campos } },
    }),
    'json',
  );
const erroDe = (campos: Record<string, unknown>) => {
  try {
    configCom(campos);
  } catch (e) {
    if (e instanceof ErroConfig) return e.message;
    throw e;
  }
  return '';
};

const T = new Date('2026-03-01T10:00:00.000Z');

describe('conector.json: "nulo" na definição do campo', () => {
  it('aceita "limpa" e "omite" em campo que o contrato aceita nulo (inclusive caminho com ponto)', () => {
    const cfg = configCom(CAMPOS).entidades.cliente as EntidadeConfig;
    expect(cfg.campos.limite_credito_cents).toMatchObject({ nulo: 'limpa' });
    expect(cfg.campos.vendedor_external_id).toMatchObject({ nulo: 'omite' });
  });

  it('recusa "limpa" em campo obrigatório (razao_social, external_id, alterado_em), com o caminho e a orientação', () => {
    expect(erroDe({ ...CAMPOS, razao_social: { coluna: 'razao_social', nulo: 'limpa' } })).toMatch(/entidades\.cliente\.campos\.razao_social\.nulo.*"razao_social" de "cliente" é obrigatório/);
    expect(erroDe({ ...CAMPOS, external_id: { coluna: 'external_id', nulo: 'limpa' } })).toMatch(/campos\.external_id\.nulo/);
    expect(erroDe({ ...CAMPOS, alterado_em: { coluna: 'alterado_em', nulo: 'limpa' } })).toMatch(/campos\.alterado_em\.nulo/);
  });

  it('recusa valor desconhecido e "nulo" fora da forma { coluna }', () => {
    expect(erroDe({ ...CAMPOS, limite_credito_cents: { coluna: 'limite', nulo: 'apaga' } })).toMatch(/limite_credito_cents/);
    expect(erroDe({ ...CAMPOS, limite_credito_cents: { valor: 1, nulo: 'limpa' } })).toMatch(/limite_credito_cents/);
  });

  it('campoAceitaNulo segue o schema do contrato', () => {
    expect(campoAceitaNulo('cliente', 'limite_credito_cents')).toBe(true);
    expect(campoAceitaNulo('cliente', 'endereco.cidade')).toBe(true);
    expect(campoAceitaNulo('cliente', 'razao_social')).toBe(false);
    expect(campoAceitaNulo('cliente', 'external_id')).toBe(false);
    expect(campoAceitaNulo('cliente', 'nao_existe')).toBe(false);
    expect(campoAceitaNulo('cliente', 'razao_social.x')).toBe(false);
  });

  it('os exemplos (SQL Server e Oracle) validam com o schema e usam "nulo": "limpa" nos campos do cliente que o portal limpa', () => {
    for (const nome of ['conector.exemplo.json', 'conector.oracle.exemplo.json']) {
      const cfg = interpretarConfig(readFileSync(join(__dirname, '..', 'exemplos', nome), 'utf8'), 'json');
      const campos = (cfg.entidades.cliente as EntidadeConfig).campos;
      expect(campos.prazo_medio_max_dias, nome).toMatchObject({ nulo: 'limpa' });
      expect(campos.formas_pagamento, nome).toMatchObject({ nulo: 'limpa' });
    }
  });
});

describe('mapeamento com "nulo"', () => {
  const cfg = () => configCom(CAMPOS).entidades.cliente as EntidadeConfig;

  it('NULL com "limpa" vira null no registro (e passa no contrato); sem opt-in ou com "omite", o campo some', () => {
    const linha = { external_id: 'C1', alterado_em: T, razao_social: 'Mercado', limite: null, prazo: null, formas: null, cidade: null, vendedor: null };
    const m = mapearLinha(cfg(), linha, 0);
    expect(m.registro).toMatchObject({ limite_credito_cents: null, formas_pagamento: null, endereco: { cidade: null } });
    expect(m.registro).not.toHaveProperty('prazo_medio_max_dias');
    expect(m.registro).not.toHaveProperty('vendedor_external_id');
    const r = mapearEValidar('cliente', cfg(), [linha]);
    expect(r.invalidas).toBe(0);
    expect(r.registros[0]).toMatchObject({ limite_credito_cents: null, formas_pagamento: null, endereco: { cidade: null } });
  });

  it('valor presente com "limpa" segue a transformação normal; coluna que não veio na linha continua omitida', () => {
    const m = mapearLinha(cfg(), { external_id: 'C1', alterado_em: T, razao_social: 'Mercado', limite: '12.34', formas: '["PIX"]' }, 0);
    expect(m.registro).toMatchObject({ limite_credito_cents: 1234, formas_pagamento: ['PIX'] });
    expect(m.registro).not.toHaveProperty('endereco');
  });

  it('sem nenhum opt-in o registro é idêntico ao da v1 (nulos omitidos)', () => {
    const semOptIn = configCom({ external_id: 'external_id', alterado_em: 'alterado_em', razao_social: 'razao_social', limite_credito_cents: { coluna: 'limite', transformar: 'centavos_de_decimal' } }).entidades.cliente as EntidadeConfig;
    const m = mapearLinha(semOptIn, { external_id: 'C1', alterado_em: T, razao_social: 'Mercado', limite: null }, 0);
    expect(m.registro).toEqual({ external_id: 'C1', alterado_em: T.toISOString(), razao_social: 'Mercado' });
  });
});

describe('ponta a ponta: o null chega ao Hub no lote', () => {
  let amb: Ambiente | undefined;
  afterEach(async () => amb?.encerrar());

  it('o registro do lote leva limite_credito_cents: null (limpa) e não leva prazo_medio_max_dias (omite)', async () => {
    amb = await criarAmbiente({ entidades: { cliente: { consulta: CONSULTA, campos: CAMPOS } } });
    amb.erp.definir('cliente', [{ external_id: 'C1', alterado_em: T, razao_social: 'Mercado', limite: null, prazo: null, formas: null, cidade: 'Boa Vista', vendedor: null }]);
    await sincronizarEntidade(amb.ctx, 'cliente');
    for (let i = 0; i < 3; i++) {
      await processarFila(amb.ctx);
      amb.relogio.avancar(6_000);
    }
    const reg = amb.hub.envelopes[0]?.registros[0] as Record<string, unknown>;
    expect(reg).toMatchObject({ external_id: 'C1', limite_credito_cents: null, formas_pagamento: null, endereco: { cidade: 'Boa Vista' } });
    expect(reg).not.toHaveProperty('prazo_medio_max_dias');
    expect(reg).not.toHaveProperty('vendedor_external_id');
  });
});
