/**
 * Postgres dos testes separado do da demo (02/11: a carga dos testes derrubou o macuxi-postgres da demo).
 * Estático: roda sempre, sem Postgres.
 */
import { describe, expect, it } from 'vitest';
import { ehBancoDeTeste } from '../scripts/limpar-bancos-teste.mjs';
import { HOSTS_LOCAIS, lerConfig, lerConfigTestes, PORTA_TESTES_PADRAO } from '../src/config';

describe('lerConfigTestes: os testes nunca usam o Postgres da demo por padrão', () => {
  it('local sem variáveis: localhost:5434, serviço postgres-testes; a demo segue na 5432', () => {
    expect(PORTA_TESTES_PADRAO).toBe(5434);
    expect(lerConfigTestes({})).toMatchObject({ host: 'localhost', porta: 5434, adminUsuario: 'postgres', servicoCompose: 'postgres-testes' });
    expect(lerConfig({})).toMatchObject({ host: 'localhost', porta: 5432 });
    expect(HOSTS_LOCAIS).toContain('macuxi-postgres-testes');
  });

  it('MACUXI_PG_TESTES_PORTA muda só a porta dos testes', () => {
    expect(lerConfigTestes({ MACUXI_PG_TESTES_PORTA: '5435' })).toMatchObject({ porta: 5435, servicoCompose: 'postgres-testes' });
  });

  it('MACUXI_PG_TESTES_URL manda: host, porta e admin vêm da URL', () => {
    const cfg = lerConfigTestes({ MACUXI_PG_TESTES_URL: 'postgres://adm:s%40nha@127.0.0.1:6543/qualquer', MACUXI_PG_PORTA: '5432' });
    expect(cfg).toMatchObject({ host: '127.0.0.1', porta: 6543, adminUsuario: 'adm', adminSenha: 's@nha' });
    expect(cfg.servicoCompose).toBeUndefined();
    expect(lerConfigTestes({ MACUXI_PG_TESTES_URL: 'postgres://postgres:postgres@localhost:5434/postgres' }).servicoCompose).toBe('postgres-testes');
    expect(() => lerConfigTestes({ MACUXI_PG_TESTES_URL: 'mysql://x@localhost/y' })).toThrow(/postgres:\/\//);
  });

  it('CI (MACUXI_PG_HOST/PORTA no ambiente): usa o service do workflow, sem subir compose', () => {
    const ci = { MACUXI_PG_HOST: 'localhost', MACUXI_PG_PORTA: '5432', MACUXI_PG_ADMIN_USUARIO: 'postgres', MACUXI_PG_ADMIN_SENHA: 'postgres' };
    expect(lerConfigTestes(ci)).toMatchObject({ host: 'localhost', porta: 5432 });
    // varrer-relogio.mjs força "sem banco" com MACUXI_PG_PORTA=1
    expect(lerConfigTestes({ MACUXI_PG_PORTA: '1' }).porta).toBe(1);
  });

  it('fora do local, a URL dos testes tem as mesmas travas de senha do lerConfig', () => {
    expect(() => lerConfigTestes({ MACUXI_PG_TESTES_URL: 'postgres://u:p@db.exemplo.com.br:5432/x' })).toThrow(/MACUXI_PG_APP_SENHA/);
  });
});

describe('limpar-bancos-teste.mjs: só apaga nomes criados pelos testes', () => {
  const protegidos = ['postgres', 'macuxi'];
  it('casa com os nomes de criarBancoDeTeste e do teste do Conector', () => {
    // mesmo formato de db/src/banco-teste.ts e apps/conector/test/integracao.pg.test.ts
    const doDb = `macuxi_teste_${Date.now().toString(36)}_${process.pid}_a1b2c3`;
    const doConector = `macuxi_conector_teste_${Date.now().toString(36)}_0f9e8d`;
    expect(ehBancoDeTeste(doDb, protegidos)).toBe(true);
    expect(ehBancoDeTeste(doConector, protegidos)).toBe(true);
  });
  it('nunca a demo, postgres, template* nem nome parecido', () => {
    for (const n of ['macuxi', 'postgres', 'template0', 'template1', 'macuxi_teste', 'macuxi_teste_x', 'macuxi_demo', 'macuxi_teste_abc_12_zzzzzz', 'macuxi_modelo_abc']) {
      expect(ehBancoDeTeste(n, protegidos), n).toBe(false);
    }
    expect(ehBancoDeTeste('macuxi_teste_abc_12_a1b2c3', ['macuxi_teste_abc_12_a1b2c3'])).toBe(false);
  });
});
