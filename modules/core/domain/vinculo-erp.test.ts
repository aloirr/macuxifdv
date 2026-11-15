import { describe, expect, it } from 'vitest';
import { ehUsuarioProvisorio, emailQueACargaPodeGravar, planejarVinculoErp, type UsuarioDoVinculo } from './vinculo-erp';
import { emailDoVendedorErp } from './erp-mapeamento';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const prov: UsuarioDoVinculo = { id: 'a0000000-0000-4000-8000-000000000001', tenant_id: T1, perfil: 'vendedor', email: emailDoVendedorErp(null, 'VEN-9').email, external_id: 'VEN-9' };
const real: UsuarioDoVinculo = { id: 'b0000000-0000-4000-8000-000000000002', tenant_id: T1, perfil: 'vendedor', email: 'real@exemplo.com.br', external_id: null };
const c = (n: number) => `c000000${n}-0000-4000-8000-00000000000${n}`;
const cart = (id: string, cliente: string, papel: 'vendedor' | 'promotor' = 'vendedor') => ({ id, cliente_id: cliente, papel });
const vazio = { carteiraProvisorio: [], carteiraReal: [] };

describe('RN-CORE-58: vínculo do vendedor do ERP ao usuário do BKO pelo código do ERP', () => {
  it('RN-CORE-58: provisório é o e-mail @sem-email.invalid gerado pela carga', () => {
    expect(ehUsuarioProvisorio(prov.email)).toBe(true);
    expect(ehUsuarioProvisorio('Alguem@SEM-EMAIL.invalid')).toBe(true);
    expect(ehUsuarioProvisorio('real@exemplo.com.br')).toBe(false);
  });

  it('RN-CORE-58: o plano passa o external_id, move a carteira, desativa o provisório e publica um evento por cliente movido', () => {
    const r = planejarVinculoErp({ provisorio: prov, real, carteiraProvisorio: [cart('p1', c(1)), cart('p2', c(2))], carteiraReal: [] });
    expect(r).toMatchObject({ ok: true, ja_vinculado: false, external_id: 'VEN-9', provisorio_id: prov.id, real_id: real.id, desativar_provisorio: true });
    if (!r.ok) return;
    expect(r.carteira_mover).toEqual(['p1', 'p2']);
    expect(r.carteira_descartar).toEqual([]);
    expect(r.eventos_cliente).toEqual([c(1), c(2)]);
    expect(r.referencias.map((x) => x.tabela)).toEqual(expect.arrayContaining(['core.carteira', 'core.nota_erp', 'core.rota', 'core.meta', 'core.indicador_diario']));
  });

  it('RN-CORE-58: carteira sem duplicar: cliente que o real já tem no mesmo papel só sai do provisório, sem evento', () => {
    const r = planejarVinculoErp({ provisorio: prov, real, carteiraProvisorio: [cart('p1', c(1)), cart('p2', c(2)), cart('p3', c(3), 'promotor')], carteiraReal: [{ cliente_id: c(2), papel: 'vendedor' }, { cliente_id: c(3), papel: 'vendedor' }] });
    if (!r.ok) throw new Error('esperava plano');
    expect(r.carteira_mover).toEqual(['p1', 'p3']);
    expect(r.carteira_descartar).toEqual(['p2']);
    expect(r.eventos_cliente).toEqual([c(1), c(3)]);
  });

  it('RN-CORE-58: repetir é idempotente: provisório já vinculado devolve plano vazio', () => {
    const r = planejarVinculoErp({ provisorio: { ...prov, vinculado: true }, real: { ...real, external_id: 'VEN-9' }, ...vazio });
    expect(r).toMatchObject({ ok: true, ja_vinculado: true, carteira_mover: [], eventos_cliente: [], desativar_provisorio: false });
  });

  it('RN-CORE-58: recusa quem não é provisório', () => {
    expect(planejarVinculoErp({ provisorio: { ...prov, email: 'outro@exemplo.com.br' }, real, ...vazio })).toMatchObject({ ok: false, codigo: 'VINCULO_NAO_PROVISORIO' });
  });

  it('RN-CORE-58: recusa quando o provisório não tem código do ERP', () => {
    expect(planejarVinculoErp({ provisorio: { ...prov, external_id: null }, real, ...vazio })).toMatchObject({ ok: false, codigo: 'VINCULO_SEM_CODIGO_ERP' });
  });

  it('RN-CORE-58: recusa quando o usuário real já tem outro código do ERP', () => {
    expect(planejarVinculoErp({ provisorio: prov, real: { ...real, external_id: 'VEN-1' }, ...vazio })).toMatchObject({ ok: false, codigo: 'VINCULO_REAL_COM_OUTRO_CODIGO' });
  });

  it('RN-CORE-58: recusa perfis incompatíveis; só vendedor com vendedor e promotor com promotor', () => {
    expect(planejarVinculoErp({ provisorio: prov, real: { ...real, perfil: 'promotor' }, ...vazio })).toMatchObject({ ok: false, codigo: 'VINCULO_PERFIL_INCOMPATIVEL' });
    expect(planejarVinculoErp({ provisorio: prov, real: { ...real, perfil: 'gerente' }, ...vazio })).toMatchObject({ ok: false, codigo: 'VINCULO_PERFIL_INCOMPATIVEL' });
    expect(planejarVinculoErp({ provisorio: { ...prov, perfil: 'promotor' }, real: { ...real, perfil: 'promotor' }, ...vazio })).toMatchObject({ ok: true });
  });

  it('RN-CORE-58: recusa o mesmo usuário nos dois lados', () => {
    expect(planejarVinculoErp({ provisorio: prov, real: { ...prov }, ...vazio })).toMatchObject({ ok: false, codigo: 'VINCULO_MESMO_USUARIO' });
  });

  it('RN-CORE-58: recusa usuários de tenants diferentes', () => {
    expect(planejarVinculoErp({ provisorio: prov, real: { ...real, tenant_id: T2 }, ...vazio })).toMatchObject({ ok: false, codigo: 'VINCULO_OUTRO_TENANT' });
  });

  it('RN-CORE-58: o usuário real não pode ser outro provisório', () => {
    expect(planejarVinculoErp({ provisorio: prov, real: { ...real, email: 'x@sem-email.invalid' }, ...vazio })).toMatchObject({ ok: false, codigo: 'VINCULO_REAL_PROVISORIO' });
  });

  it('RN-CORE-58: a mensagem de recusa diz a ação seguinte, em português', () => {
    const r = planejarVinculoErp({ provisorio: { ...prov, email: 'a@b.com' }, real, ...vazio });
    if (r.ok) throw new Error('esperava recusa');
    expect(r.mensagem).toMatch(/provisório/i);
  });

  it('RN-CORE-58: a carga nunca troca o e-mail real do usuário vinculado, nem põe o provisório por cima dele', () => {
    expect(emailQueACargaPodeGravar({ emailAtual: 'real@exemplo.com.br', emailDoErp: 'outro@erp.com.br', erpProvisorio: false, emailLivre: true })).toBeNull();
    expect(emailQueACargaPodeGravar({ emailAtual: 'real@exemplo.com.br', emailDoErp: 'erp-1@sem-email.invalid', erpProvisorio: true, emailLivre: true })).toBeNull();
  });

  it('RN-CORE-58: a carga só troca e-mail provisório por e-mail real livre', () => {
    expect(emailQueACargaPodeGravar({ emailAtual: 'erp-1@sem-email.invalid', emailDoErp: 'novo@erp.com.br', erpProvisorio: false, emailLivre: true })).toBe('novo@erp.com.br');
    expect(emailQueACargaPodeGravar({ emailAtual: 'erp-1@sem-email.invalid', emailDoErp: 'novo@erp.com.br', erpProvisorio: false, emailLivre: false })).toBeNull();
  });
});
