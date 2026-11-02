import { criarRegistroSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { ENTIDADES_CADASTRO, ENTIDADES_COLETA, ENTIDADES_PROMOTOR } from './entidades';

describe('entidades de sync do Promotor (T-0056)', () => {
  it('o `sync` do manifesto lista exatamente as entidades definidas', () => {
    expect([...manifest.sync].sort()).toEqual(ENTIDADES_PROMOTOR.map((e) => e.nome).sort());
  });

  it('registram no registro de sync da plataforma (nomes válidos, sem repetição)', () => {
    const r = criarRegistroSync([manifest]);
    for (const e of ENTIDADES_PROMOTOR) r.registrar(e);
    expect(r.entidadesAtivas(['promotor'], 'push').map((e) => e.nome).sort()).toEqual(Object.keys(ENTIDADES_COLETA).sort());
    expect(r.entidadesAtivas(['promotor'], 'pull').map((e) => e.nome).sort()).toEqual(ENTIDADES_CADASTRO.map((e) => e.nome).sort());
  });

  it('coletas: somente inserção, exceto a visita de loja (aberta no check-in, fechada no checkout)', () => {
    for (const e of Object.values(ENTIDADES_COLETA)) expect(e.conflito, e.nome).toBe(e.nome === 'visita_loja' ? 'app_edita_ate_status' : 'somente_insercao');
  });

  it('RN-PRO-01: nenhuma entidade do Promotor é de pedido', () => {
    for (const e of ENTIDADES_PROMOTOR) expect(e.nome).not.toMatch(/pedido/);
  });

  it('módulo inativo: o registro não oferece as entidades do Promotor (RN-CORE-02)', () => {
    const r = criarRegistroSync([manifest]);
    for (const e of ENTIDADES_PROMOTOR) r.registrar(e);
    expect(r.entidadesAtivas(['core'])).toEqual([]);
  });
});
