/**
 * RN-CORE-31 Onboarding de tenant (desenho T-0083 §2 e §4): `planoDeOnboarding` valida a entrada do comando e monta,
 * pelos manifestos, as licenças (core sempre; dependência faltando = recusa) e os módulos por perfil padrão.
 */
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { FUSO_PADRAO_ONBOARDING, planoDeOnboarding, type EntradaOnboarding, type ResultadoOnboarding } from './onboarding';

const todos = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;
const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: [...todos] }),
  defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: [...todos] }),
  defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core', 'catalogo'], perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] }),
  defineModule({ id: 'promotor', versao: '1.0.0', depende: ['core'], opcionais: ['catalogo', 'vendedor'], perfis: ['promotor', 'supervisor', 'gerente', 'analista', 'admin'] }),
  defineModule({ id: 'integracao', versao: '1.0.0', depende: ['core'], perfis: ['admin', 'analista'] }),
];

const base: EntradaOnboarding = {
  codigo: 'distribuidora-x',
  nome: 'Distribuidora X',
  modulos: ['catalogo', 'vendedor'],
  admin: { email: 'admin@x.com.br', nome: 'Fulana' },
};

function ok(r: ResultadoOnboarding) {
  if (!r.ok) throw new Error(`esperava plano, veio erro: ${JSON.stringify(r.erros)}`);
  return r.plano;
}
function erros(r: ResultadoOnboarding) {
  if (r.ok) throw new Error('esperava erro, veio plano');
  return r.erros;
}

describe('planoDeOnboarding (RN-CORE-31)', () => {
  it('RN-CORE-31: monta tenant com padrões (fuso, plano, documento nulo) e módulos em ordem de dependência, core primeiro', () => {
    const p = ok(planoDeOnboarding(base, manifestos));
    expect(p.tenant).toEqual({ codigo: 'distribuidora-x', nome: 'Distribuidora X', documento: null, fuso: FUSO_PADRAO_ONBOARDING, plano: 'piloto' });
    expect(FUSO_PADRAO_ONBOARDING).toBe('America/Sao_Paulo');
    expect(p.modulos.map((m) => m.modulo)).toEqual(['core', 'catalogo', 'vendedor']);
  });

  it('RN-CORE-31 item 2: core entra sempre, mesmo sem ser pedido; pedir só core vale', () => {
    expect(ok(planoDeOnboarding({ ...base, modulos: [] }, manifestos)).modulos.map((m) => m.modulo)).toEqual(['core']);
    expect(ok(planoDeOnboarding({ ...base, modulos: ['core'] }, manifestos)).modulos.map((m) => m.modulo)).toEqual(['core']);
  });

  it('RN-CORE-31 item 2 / RN-CORE-03: módulo sem a dependência obrigatória é recusado (não liga a dependência sozinho)', () => {
    const e = erros(planoDeOnboarding({ ...base, modulos: ['vendedor'] }, manifestos));
    expect(e).toEqual([expect.objectContaining({ codigo: 'DEPENDENCIA_FALTANDO', campo: 'modulos', modulo: 'vendedor', dependencia: 'catalogo' })]);
    expect(e[0]!.mensagem).toContain('catalogo');
  });

  it('RN-CORE-03: dependência opcional ausente não recusa', () => {
    expect(ok(planoDeOnboarding({ ...base, modulos: ['promotor'] }, manifestos)).modulos.map((m) => m.modulo)).toEqual(['core', 'promotor']);
  });

  it('RN-CORE-31 item 1: perfis de cada módulo = perfis padrão do manifesto', () => {
    const p = ok(planoDeOnboarding({ ...base, modulos: ['catalogo', 'vendedor', 'integracao'] }, manifestos));
    const perfis = Object.fromEntries(p.modulos.map((m) => [m.modulo, m.perfis]));
    expect(perfis.core).toEqual([...todos]);
    expect(perfis.vendedor).toEqual(['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin']);
    expect(perfis.integracao).toEqual(['admin', 'analista']);
  });

  it('RN-PRO-01: o perfil promotor nunca recebe o módulo Vendedor; manifesto que o conceda é recusado', () => {
    const p = ok(planoDeOnboarding({ ...base, modulos: ['catalogo', 'vendedor', 'promotor'] }, manifestos));
    expect(p.modulos.find((m) => m.modulo === 'vendedor')!.perfis).not.toContain('promotor');
    const errado = [...manifestos.filter((m) => m.id !== 'vendedor'), defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core', 'catalogo'], perfis: ['vendedor', 'promotor'] })];
    expect(erros(planoDeOnboarding(base, errado))).toEqual([expect.objectContaining({ codigo: 'PROMOTOR_COM_VENDEDOR', modulo: 'vendedor' })]);
  });

  it('módulo desconhecido ou não instalado é recusado; repetido conta uma vez', () => {
    expect(erros(planoDeOnboarding({ ...base, modulos: ['catalogo', 'xyz'] }, manifestos))).toEqual([expect.objectContaining({ codigo: 'MODULO_DESCONHECIDO', modulo: 'xyz' })]);
    expect(erros(planoDeOnboarding({ ...base, modulos: ['gestor'] }, manifestos))).toEqual([expect.objectContaining({ codigo: 'MODULO_DESCONHECIDO', modulo: 'gestor' })]);
    expect(ok(planoDeOnboarding({ ...base, modulos: ['catalogo', 'catalogo', ' Catalogo '] }, manifestos)).modulos.map((m) => m.modulo)).toEqual(['core', 'catalogo']);
  });

  it('código: normaliza para minúsculas e segue o check da 0001 (^[a-z0-9][a-z0-9-]{1,39}$)', () => {
    expect(ok(planoDeOnboarding({ ...base, codigo: '  Distribuidora-X ' }, manifestos)).tenant.codigo).toBe('distribuidora-x');
    for (const codigo of ['', 'x', '-abc', 'dist x', 'dist_x', 'a'.repeat(41), 'ação']) {
      expect(erros(planoDeOnboarding({ ...base, codigo }, manifestos)).map((e) => e.codigo)).toContain('CODIGO_INVALIDO');
    }
    expect(ok(planoDeOnboarding({ ...base, codigo: 'a'.repeat(40) }, manifestos)).tenant.codigo).toHaveLength(40);
  });

  it('fuso: IANA reconhecido pelo Intl; inválido é recusado', () => {
    expect(ok(planoDeOnboarding({ ...base, fuso: 'America/Manaus' }, manifestos)).tenant.fuso).toBe('America/Manaus');
    expect(erros(planoDeOnboarding({ ...base, fuso: 'America/Atlantida' }, manifestos)).map((e) => e.codigo)).toEqual(['FUSO_INVALIDO']);
  });

  it('licenças: inteiro ≥ 0 só para módulo pedido; ausente = sem teto (null)', () => {
    const p = ok(planoDeOnboarding({ ...base, licencas: { vendedor: 20, catalogo: 0 } }, manifestos));
    expect(Object.fromEntries(p.modulos.map((m) => [m.modulo, m.licencas]))).toEqual({ core: null, catalogo: 0, vendedor: 20 });
    expect(erros(planoDeOnboarding({ ...base, licencas: { vendedor: -1 } }, manifestos))).toEqual([expect.objectContaining({ codigo: 'LICENCA_INVALIDA', modulo: 'vendedor' })]);
    expect(erros(planoDeOnboarding({ ...base, licencas: { vendedor: 2.5 } }, manifestos)).map((e) => e.codigo)).toEqual(['LICENCA_INVALIDA']);
    expect(erros(planoDeOnboarding({ ...base, licencas: { promotor: 5 } }, manifestos))).toEqual([expect.objectContaining({ codigo: 'LICENCA_SEM_MODULO', modulo: 'promotor' })]);
  });

  it('nome, plano, documento e admin: obrigatórios aparados; vazios recusados', () => {
    const p = ok(planoDeOnboarding({ ...base, nome: '  Distribuidora X ', documento: ' 12.345.678/0001-90 ', plano: ' anual ', admin: { email: ' Admin@X.com.br ', nome: ' Fulana ' } }, manifestos));
    expect(p.tenant).toMatchObject({ nome: 'Distribuidora X', documento: '12.345.678/0001-90', plano: 'anual' });
    expect(p.admin).toEqual({ email: 'Admin@X.com.br', nome: 'Fulana', perfil: 'admin' });
    expect(ok(planoDeOnboarding({ ...base, documento: '  ' }, manifestos)).tenant.documento).toBeNull();
    const e = erros(planoDeOnboarding({ ...base, nome: ' ', plano: ' ', admin: { email: ' ', nome: '' } }, manifestos)).map((x) => x.campo);
    expect(e).toEqual(expect.arrayContaining(['nome', 'plano', 'admin.email', 'admin.nome']));
  });

  it('junta todos os erros de uma vez (o operador corrige tudo numa rodada)', () => {
    const e = erros(planoDeOnboarding({ ...base, codigo: 'X', fuso: 'nada', modulos: ['vendedor', 'xyz'] }, manifestos)).map((x) => x.codigo);
    expect(e).toEqual(expect.arrayContaining(['CODIGO_INVALIDO', 'FUSO_INVALIDO', 'MODULO_DESCONHECIDO', 'DEPENDENCIA_FALTANDO']));
  });

  it('função pura: não altera a entrada e o plano não compartilha arrays com os manifestos', () => {
    const entrada = { ...base, modulos: ['catalogo', 'vendedor'], licencas: { vendedor: 3 } };
    const copia = structuredClone(entrada);
    const p = ok(planoDeOnboarding(entrada, manifestos));
    expect(entrada).toEqual(copia);
    expect(p.modulos[0]!.perfis).not.toBe(manifestos[0]!.perfis);
  });
});
