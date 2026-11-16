/** Rodapé legal (docs/design/telas/rodape-legal.md §3.3): contrato dos dados legais. Dados fictícios. */
import { describe, expect, it } from 'vitest';
import { DadosLegaisSchema, GravarDadosLegaisSchema, normalizarSite, ROTA_DADOS_LEGAIS_PUBLICOS, ROTA_PORTAL_DADOS_LEGAIS, SITE_PADRAO, siteValido, } from './index';
const mensagens = (v) => {
    const r = GravarDadosLegaisSchema.safeParse(v);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};
describe('dados legais do rodapé', () => {
    it('constantes', () => {
        expect([SITE_PADRAO, ROTA_DADOS_LEGAIS_PUBLICOS, ROTA_PORTAL_DADOS_LEGAIS]).toEqual([
            'macuxifdv.com.br',
            '/v1/publico/dados-legais',
            '/v1/plataforma/dados-legais',
        ]);
    });
    it('normalizarSite tira esquema, www, barras finais e caixa; não valida', () => {
        expect(normalizarSite('  https://www.Exemplo.com.br/ ')).toBe('exemplo.com.br');
        expect(normalizarSite('HTTP://exemplo.com.br//')).toBe('exemplo.com.br');
        expect(normalizarSite('exemplo.com.br/pagina')).toBe('exemplo.com.br/pagina');
        expect(normalizarSite('')).toBe('');
    });
    it('siteValido aceita só domínio em minúsculas', () => {
        for (const s of ['macuxifdv.com.br', 'a.io', 'sub-dominio.exemplo.com'])
            expect(siteValido(s)).toBe(true);
        for (const s of ['', 'exemplo', 'Exemplo.com', 'exemplo.com/x', '-a.com', 'a-.com', 'a..com', 'a.c0m', `${'a'.repeat(64)}.com`, `${'a.'.repeat(130)}com`])
            expect(siteValido(s)).toBe(false);
    });
    it('gravar normaliza: razão social sem espaços nas pontas, CNPJ sem máscara, site normalizado', () => {
        expect(GravarDadosLegaisSchema.parse({ razao_social: '  Empresa Exemplo Ltda ', cnpj: '11.222.333/0001-81', site: 'https://www.Exemplo.com.br/' })).toEqual({
            razao_social: 'Empresa Exemplo Ltda',
            cnpj: '11222333000181',
            site: 'exemplo.com.br',
        });
    });
    it('vazio vira null (razão social e CNPJ) e o site padrão', () => {
        expect(GravarDadosLegaisSchema.parse({ razao_social: '   ', cnpj: '', site: '' })).toEqual({ razao_social: null, cnpj: null, site: SITE_PADRAO });
        expect(GravarDadosLegaisSchema.parse({ razao_social: null, cnpj: null, site: null })).toEqual({ razao_social: null, cnpj: null, site: SITE_PADRAO });
    });
    it('recusa com a mensagem do campo', () => {
        expect(mensagens({ razao_social: 'x'.repeat(121), cnpj: null, site: null })).toEqual(['razao_social: Use até 120 caracteres.']);
        expect(mensagens({ razao_social: null, cnpj: '11.222.333/0001-82', site: null })).toEqual(['cnpj: CNPJ inválido. Confira os 14 dígitos.']);
        expect(mensagens({ razao_social: null, cnpj: '1122233300018', site: null })).toEqual(['cnpj: CNPJ inválido. Confira os 14 dígitos.']);
        expect(mensagens({ razao_social: null, cnpj: null, site: 'exemplo.com.br/contato' })).toEqual(['site: Use só o endereço, ex.: macuxifdv.com.br.']);
        expect(mensagens({ razao_social: null, cnpj: null, site: null, extra: 1 })).toHaveLength(1);
        expect(mensagens({ razao_social: null, cnpj: null })).toHaveLength(1);
    });
    it('leitura: CNPJ só com 14 dígitos, site obrigatório', () => {
        expect(DadosLegaisSchema.safeParse({ razao_social: null, cnpj: null, site: SITE_PADRAO }).success).toBe(true);
        expect(DadosLegaisSchema.safeParse({ razao_social: 'Empresa Exemplo Ltda', cnpj: '11222333000181', site: 'exemplo.com.br' }).success).toBe(true);
        expect(DadosLegaisSchema.safeParse({ razao_social: '', cnpj: null, site: SITE_PADRAO }).success).toBe(false);
        expect(DadosLegaisSchema.safeParse({ razao_social: null, cnpj: '11.222.333/0001-81', site: SITE_PADRAO }).success).toBe(false);
        expect(DadosLegaisSchema.safeParse({ razao_social: null, cnpj: null, site: '' }).success).toBe(false);
    });
});
