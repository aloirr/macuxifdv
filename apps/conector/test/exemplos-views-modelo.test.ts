import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpretarConfig } from '../src/config/carregar';
import { camposDoContrato, ORDEM_CARGA } from '../src/config/entidades';

const ler = (nome: string) => interpretarConfig(readFileSync(join(__dirname, '..', 'exemplos', nome), 'utf8'), 'json');
const campoRaiz = (c: string) => c.split('.')[0] as string;

describe('T-0089 I2: exemplos do Conector lendo as views-modelo vw_macuxi_<entidade> (banco-dados)', () => {
  const sql = ler('conector.exemplo.json');

  it('RN-INT-04: o exemplo SQL Server cobre todas as entidades da ORDEM_CARGA, cada uma com SELECT ... FROM vw_macuxi_<entidade>', () => {
    expect(Object.keys(sql.entidades).sort()).toEqual([...ORDEM_CARGA].sort());
    for (const e of ORDEM_CARGA) {
      const c = sql.entidades[e]?.consulta ?? '';
      expect(c.startsWith('SELECT TOP (:limite) '), e).toBe(true);
      expect(c, e).toContain(` FROM dbo.vw_macuxi_${e} WHERE `);
    }
  });

  it('RN-INT-04: o desempate do cursor (alterado_em, external_id) usa colação binária no WHERE e no ORDER BY em todas as consultas dos dois exemplos', () => {
    const oracle = ler('conector.oracle.exemplo.json');
    for (const e of Object.keys(sql.entidades)) {
      const c = sql.entidades[e as keyof typeof sql.entidades]?.consulta ?? '';
      expect(c, e).toContain('external_id COLLATE Latin1_General_BIN2 > :cursor_external_id');
      expect(c, e).toContain('ORDER BY alterado_em, external_id COLLATE Latin1_General_BIN2');
    }
    const nls = "NLSSORT(external_id, 'NLS_SORT=BINARY')";
    for (const e of Object.keys(oracle.entidades)) {
      const c = oracle.entidades[e as keyof typeof oracle.entidades]?.consulta ?? '';
      expect(c, e).toContain(`${nls} > NLSSORT(:cursor_external_id, 'NLS_SORT=BINARY')`);
      expect(c, e).toContain(`ORDER BY alterado_em, ${nls}`);
    }
  });

  it('o mapeamento é 1 para 1 com o contrato: todo campo do contrato mapeado e nenhum campo fora dele', () => {
    for (const e of ORDEM_CARGA) {
      const mapeados = new Set(Object.keys(sql.entidades[e]?.campos ?? {}).map(campoRaiz));
      expect([...mapeados].sort(), e).toEqual([...camposDoContrato(e)].sort());
    }
  });

  it('transformações do recado do banco-dados nas entidades novas e no cliente', () => {
    const t = (e: string, c: string) => {
      const v = sql.entidades[e as keyof typeof sql.entidades]?.campos[c];
      return typeof v === 'object' && v !== null ? (v as { transformar?: string }).transformar : undefined;
    };
    expect([t('forma_pagamento', 'ativo'), t('forma_pagamento', 'ordem')]).toEqual(['booleano', 'inteiro']);
    expect([t('prazo_pagamento', 'ativo'), t('prazo_pagamento', 'parcelas_dias'), t('prazo_pagamento', 'prazo_medio_dias'), t('prazo_pagamento', 'ordem')]).toEqual(['booleano', 'json', 'inteiro', 'inteiro']);
    expect([t('tabela_escalonada', 'ativo'), t('tabela_escalonada', 'quantidade_minima'), t('tabela_escalonada', 'preco_unidade_cents'), t('tabela_escalonada', 'vigencia_inicio'), t('tabela_escalonada', 'vigencia_fim')]).toEqual(['booleano', 'inteiro', 'inteiro', 'data_civil', 'data_civil']);
    expect([t('cliente', 'prazo_medio_max_dias'), t('cliente', 'formas_pagamento')]).toEqual(['inteiro', 'json']);
  });

  it('o exemplo Oracle traz as entidades novas e os campos novos do cliente, lendo as views', () => {
    const ora = ler('conector.oracle.exemplo.json');
    for (const e of ['forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'] as const) {
      expect(ora.entidades[e]?.consulta, e).toContain(`FROM macuxi.vw_macuxi_${e} `);
      expect(Object.keys(ora.entidades[e]?.campos ?? {}).sort(), e).toEqual([...camposDoContrato(e)].sort());
    }
    expect(Object.keys(ora.entidades.cliente?.campos ?? {})).toEqual(expect.arrayContaining(['prazo_medio_max_dias', 'formas_pagamento']));
  });
});

describe('T-0159 / RN-CORE-39: filial com CNPJ e endereço no exemplo do Conector', () => {
  it('RN-CORE-39: a consulta e o mapeamento da filial levam cnpj, logradouro, numero, complemento, bairro, cep e telefone', () => {
    const f = ler('conector.exemplo.json').entidades.filial;
    for (const campo of ['cnpj', 'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'telefone']) {
      expect(f?.consulta, campo).toContain(`, ${campo}`);
      expect(f?.campos?.[campo], campo).toBe(campo);
    }
  });
});
