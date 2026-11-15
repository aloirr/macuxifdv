/**
 * RN-CORE-59 — Código FDV (T-0175): 5 dígitos por empresa (00001), 100000 sem zero à esquerda, só de leitura (422
 * CODIGO_FDV_SOMENTE_LEITURA mesmo igual ao gravado), nunca reaproveitado; no BKO, ao lado do Código no ERP, sem edição.
 * Aceite e costura entre camadas (contrato → API → domínio → banco → BKO); a regra pura tem teste de unidade no módulo.
 */
import { EditarUsuarioRequestSchema, UsuarioItemSchema } from '../../../modules/core/contracts';
import { describe, expect, it } from 'vitest';
import { existe, importar, ler } from '../apoio/v1013';

const DOMINIO = 'modules/core/domain/codigo-fdv.ts';
const MIGRACAO = 'db/migrations/0080_core_usuario_codigo_fdv.up.sql';
const COM_FDV = existe(DOMINIO);

interface CodigoFdv {
  formatarCodigoFdv(n: number): string;
  validarCodigoFdv(t: string): { ok: boolean };
  recusarCodigoFdvNoCorpo(c: Record<string, unknown>): { codigo: string } | null;
}
const regexDe = (fonte: string, padrao: RegExp): string => padrao.exec(fonte)?.[1] ?? '';

describe('RN-CORE-59 — Código FDV', () => {
  if (!COM_FDV) {
    it('antes do PR: o usuário não tem Código FDV no contrato nem na API', () => {
      expect(Object.keys(UsuarioItemSchema.shape)).not.toContain('codigo_fdv');
      expect(ler('modules/core/api/usuarios.ts')).not.toContain('CODIGO_FDV');
    });
    return;
  }

  it('formato: 00001…99999 com 5 dígitos e 100000 sem zero à esquerda; 0, 00000, 0100000, letras e prefixo recusados', async () => {
    const d = await importar<CodigoFdv>(DOMINIO);
    expect([1, 42, 99999, 100000].map(d.formatarCodigoFdv)).toEqual(['00001', '00042', '99999', '100000']);
    for (const ok of ['00001', '99999', '100000']) expect(d.validarCodigoFdv(ok).ok).toBe(true);
    for (const ruim of ['0', '00000', '0100000', '0001A', 'FDV00001', '1234', '']) expect(d.validarCodigoFdv(ruim).ok, ruim).toBe(false);
  });

  it.skipIf(!existe(MIGRACAO))('o CHECK da 0080 usa o mesmo formato do domínio; o código só se emite pelo contador e não muda depois', () => {
    const sql = ler(MIGRACAO);
    const doBanco = regexDe(sql, /codigo_fdv ~ '(\^[^']+\$)'/);
    expect(doBanco).not.toBe('');
    expect(regexDe(ler(DOMINIO), /\/(\^[^/]+\$)\/\.exec/)).toBe(doBanco);
    expect(sql).toContain('ultimo_sequencial + 1');
    expect(sql).toContain('usuario_codigo_fdv_somente_leitura');
  });

  it('codigo_fdv no corpo de editar passa no contrato (não vira 400) e a regra recusa com 422, mesmo igual ao gravado ou nulo', async () => {
    const d = await importar<CodigoFdv>(DOMINIO);
    const corpo = EditarUsuarioRequestSchema.parse({ codigo_fdv: '00001' }) as Record<string, unknown>;
    expect(d.recusarCodigoFdvNoCorpo(corpo)?.codigo).toBe('CODIGO_FDV_SOMENTE_LEITURA');
    expect(d.recusarCodigoFdvNoCorpo({ codigo_fdv: null })?.codigo).toBe('CODIGO_FDV_SOMENTE_LEITURA');
    expect(d.recusarCodigoFdvNoCorpo({ nome: 'Ana Souza' })).toBeNull();
  });

  it('a API recusa antes de gravar em criar e editar (ErroRegraNegocio = 422) e nunca grava a coluna', () => {
    const api = ler('modules/core/api/usuarios.ts');
    expect(api).toMatch(/const recusarCodigoFdv = [\s\S]{0,200}new ErroRegraNegocio\(/);
    expect(api.match(/const c = ctx\.corpo;\s+recusarCodigoFdv\(c\);/g)).toHaveLength(2);
    expect(api).not.toMatch(/codigo_fdv\s*=/);
    expect(api).not.toMatch(/insert into core\.usuario \([^)]*codigo_fdv/);
    expect(ler('modules/core/api/vinculo-erp.ts')).not.toContain('codigo_fdv');
  });

  it('BKO: coluna "Código FDV" na lista e, em Editar, o valor só para leitura (com copiar) logo antes do "Código no ERP"', () => {
    const tela = ler('modules/core/web/components/usuarios/usuarios-page.tsx');
    expect(tela).toMatch(/<th className=\{th\}>Código FDV<\/th>/);
    const ini = tela.indexOf('<Campo rotulo="Código FDV">');
    const erp = tela.indexOf('<Campo rotulo="Código no ERP"');
    expect(ini).toBeGreaterThan(-1);
    expect(erp).toBeGreaterThan(ini);
    const bloco = tela.slice(ini, erp);
    expect(bloco).not.toMatch(/<input|onChange/);
    expect(bloco).toContain('aria-label="Copiar código FDV"');
  });
});
