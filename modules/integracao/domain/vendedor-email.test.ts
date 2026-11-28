import { describe, expect, it } from 'vitest';
import { CODIGOS_ERRO_LINHA } from '../contracts';
import { ehReprocessavel } from './erros';
import { emailsDeVendedorParaConferir, normalizarEmailVendedor, recusarVendedoresComEmailEmOutraEmpresa } from './vendedor-email';

const linha = (indice: number, email: string | null | undefined) => ({ indice, external_id: `V${indice}`, registro: { external_id: `V${indice}`, nome: 'Maria', email } });

describe('vendedor com e-mail de outra empresa (RN-CORE-32, ADR 0078 D5)', () => {
  it('RN-CORE-32: o e-mail é comparado normalizado (minúsculas, sem espaços nas pontas)', () => {
    expect(normalizarEmailVendedor('  Maria.Silva@Exemplo.COM.br ')).toBe('maria.silva@exemplo.com.br');
    expect(normalizarEmailVendedor('   ')).toBeNull();
    expect(normalizarEmailVendedor(null)).toBeNull();
    expect(normalizarEmailVendedor(undefined)).toBeNull();
  });

  it('RN-CORE-32: só o vendedor com e-mail real vai à conferência; o provisório @sem-email.invalid (RN-CORE-58) e o vazio ficam fora', () => {
    const linhas = [linha(0, ' A@X.com '), linha(1, 'a@x.com'), linha(2, 'erp-7@SEM-EMAIL.invalid'), linha(3, ''), linha(4, null), linha(5, 'b@x.com')];
    expect(emailsDeVendedorParaConferir('vendedor', linhas)).toEqual(['a@x.com', 'b@x.com']);
    expect(emailsDeVendedorParaConferir('cliente', linhas)).toEqual([]);
  });

  it('RN-CORE-32: o vendedor com e-mail de outra empresa é recusado com VENDEDOR_EMAIL_EM_OUTRA_EMPRESA e o resto segue', () => {
    const linhas = [linha(0, ' Ana@Exemplo.com '), linha(1, 'bia@exemplo.com'), linha(2, 'erp-9@sem-email.invalid'), linha(3, null)];
    const r = recusarVendedoresComEmailEmOutraEmpresa('vendedor', linhas, new Set(['ana@exemplo.com']));
    expect(r.aceitas.map((l) => l.external_id)).toEqual(['V1', 'V2', 'V3']);
    expect(r.erros).toEqual([
      { indice: 0, external_id: 'V0', codigo: 'VENDEDOR_EMAIL_EM_OUTRA_EMPRESA', campo: 'email', mensagem: 'Este e-mail já está em uso em outra empresa. Use outro e-mail.', reprocessavel: false },
    ]);
  });

  it('RN-CORE-32: o erro nunca leva o e-mail (dado pessoal)', () => {
    const r = recusarVendedoresComEmailEmOutraEmpresa('vendedor', [linha(0, 'ana@exemplo.com')], new Set(['ana@exemplo.com']));
    expect(JSON.stringify(r.erros)).not.toContain('ana@');
  });

  it('RN-CORE-32: outra entidade e conjunto vazio não recusam nada', () => {
    const linhas = [linha(0, 'ana@exemplo.com')];
    expect(recusarVendedoresComEmailEmOutraEmpresa('cliente', linhas, new Set(['ana@exemplo.com'])).erros).toEqual([]);
    expect(recusarVendedoresComEmailEmOutraEmpresa('vendedor', linhas, new Set()).aceitas).toHaveLength(1);
  });

  it('RN-INT-03: o código novo está no contrato e exige reenvio corrigido (não é reprocessável)', () => {
    expect(CODIGOS_ERRO_LINHA).toContain('VENDEDOR_EMAIL_EM_OUTRA_EMPRESA');
    expect(ehReprocessavel('VENDEDOR_EMAIL_EM_OUTRA_EMPRESA')).toBe(false);
  });
});
