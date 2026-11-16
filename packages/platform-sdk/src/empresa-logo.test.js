/** T-0182 (desenho §2 e §3.1): conferência da logo, contratos e as chaves reservadas do Core. Dados fictícios. */
import { describe, expect, it } from 'vitest';
import { CODIGOS_LOGO, conferirLogo, empresaDosParametros, GravarNomeFantasiaSchema, LIMITES_LOGO, MarcaEmpresaSchema, MENSAGENS_ACESSO_LOGO, MENSAGENS_LOGO, nomeDaEmpresa, parametrosDaEmpresa, proporcaoDaLogo, rotaLogoDoAparelho, Sha256LogoSchema, TEXTO_LIMITES_LOGO, } from './empresa-logo';
/** PNG mínimo: assinatura + IHDR com largura e altura dadas (só o cabeçalho é lido). */
function pngFalso(largura, altura, extra = 0) {
    const b = new Uint8Array(33 + extra);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const v = new DataView(b.buffer);
    v.setUint32(16, largura);
    v.setUint32(20, altura);
    return b;
}
/** JPEG mínimo com o SOF0 dizendo largura × altura. */
function jpegFalso(largura, altura) {
    return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, altura >> 8, altura & 0xff, largura >> 8, largura & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}
const SHA = 'a'.repeat(64);
describe('conferirLogo (desenho §2.2; spec §2)', () => {
    it('PNG e JPEG válidos passam, com o tipo e as dimensões do cabeçalho', () => {
        expect(conferirLogo(pngFalso(600, 200), 'image/png')).toEqual({ ok: true, tipo: 'image/png', largura_px: 600, altura_px: 200 });
        expect(conferirLogo(jpegFalso(300, 300), 'image/jpeg; charset=binary')).toEqual({ ok: true, tipo: 'image/jpeg', largura_px: 300, altura_px: 300 });
    });
    it('formato: Content-Type fora de PNG/JPEG = 415; assinatura diferente, vazio ou cabeçalho cortado = 422', () => {
        expect(conferirLogo(pngFalso(600, 200), 'image/webp')).toEqual({ ok: false, status: 415, codigo: CODIGOS_LOGO.formato });
        expect(conferirLogo(pngFalso(600, 200), undefined)).toMatchObject({ status: 415 });
        expect(conferirLogo(pngFalso(600, 200), 'image/jpeg')).toEqual({ ok: false, status: 422, codigo: CODIGOS_LOGO.formato });
        expect(conferirLogo(new Uint8Array(), 'image/png')).toMatchObject({ status: 422, codigo: CODIGOS_LOGO.formato });
        expect(conferirLogo(pngFalso(600, 200).subarray(0, 20), 'image/png')).toMatchObject({ status: 422, codigo: CODIGOS_LOGO.formato });
    });
    it('tamanho: 1 MiB passa; 1 byte a mais = 413 LOGO_GRANDE_DEMAIS', () => {
        expect(conferirLogo(pngFalso(600, 200, LIMITES_LOGO.bytes - 33), 'image/png').ok).toBe(true);
        expect(conferirLogo(pngFalso(600, 200, LIMITES_LOGO.bytes - 32), 'image/png')).toEqual({ ok: false, status: 413, codigo: CODIGOS_LOGO.grande });
    });
    it('altura: 200 px passa; 199 px = 422 LOGO_ALTURA_MINIMA', () => {
        expect(conferirLogo(pngFalso(800, 200), 'image/png').ok).toBe(true);
        expect(conferirLogo(pngFalso(800, 199), 'image/png')).toEqual({ ok: false, status: 422, codigo: CODIGOS_LOGO.altura });
    });
    it('lado máximo: 4096 px passa; 4097 de largura ou altura = 422 LOGO_LADO_MAXIMO (PNG pequeno que declara 20.000 px)', () => {
        expect(conferirLogo(pngFalso(4096, 4096), 'image/png').ok).toBe(true);
        expect(conferirLogo(pngFalso(4097, 300), 'image/png')).toEqual({ ok: false, status: 422, codigo: CODIGOS_LOGO.lado });
        expect(conferirLogo(pngFalso(300, 20_000), 'image/png')).toMatchObject({ codigo: CODIGOS_LOGO.lado });
    });
    it('toda recusa tem frase para o portal', () => {
        for (const c of Object.values(CODIGOS_LOGO))
            expect(MENSAGENS_LOGO[c]).toMatch(/\S/);
    });
    it('frases e linha dos limites montadas de LIMITES_LOGO, com o texto exato da spec §2 (RD-0703)', () => {
        expect(TEXTO_LIMITES_LOGO).toBe('PNG ou JPG · até 1 MB · pelo menos 200 px de altura');
        expect(MENSAGENS_LOGO.LOGO_GRANDE_DEMAIS).toBe('O arquivo passa de 1 MB. Envie um menor.');
        expect(MENSAGENS_LOGO.LOGO_ALTURA_MINIMA).toBe('A imagem tem menos de 200 px de altura. Envie uma maior.');
        expect(MENSAGENS_LOGO.LOGO_LADO_MAXIMO).toBe('A imagem passa de 4096 px de largura ou altura. Envie uma menor.');
    });
    it('RN-CORE-33: o 403 da leitura diz o que a pessoa vê, sem falar em alterar; o da escrita diz quem altera', () => {
        expect(MENSAGENS_ACESSO_LOGO.leitura).toBe('Você só vê a logo e o nome fantasia da sua empresa.');
        expect(MENSAGENS_ACESSO_LOGO.leitura).not.toMatch(/alter/i);
        expect(MENSAGENS_ACESSO_LOGO.escrita).toBe('Só o time da Macuxi altera a logo e o nome fantasia.');
    });
});
describe('contratos do portal', () => {
    it('sha256 em hex minúsculo (RD-0702)', () => {
        expect(Sha256LogoSchema.safeParse('a'.repeat(64)).success).toBe(true);
        expect(Sha256LogoSchema.safeParse('A'.repeat(64)).success).toBe(false);
    });
    it('nome fantasia: apara; vazio ou só espaços = null; até 80 caracteres', () => {
        expect(GravarNomeFantasiaSchema.parse({ nome_fantasia: '  Mercado Bom  ' })).toEqual({ nome_fantasia: 'Mercado Bom' });
        expect(GravarNomeFantasiaSchema.parse({ nome_fantasia: '   ' })).toEqual({ nome_fantasia: null });
        expect(GravarNomeFantasiaSchema.parse({ nome_fantasia: null })).toEqual({ nome_fantasia: null });
        expect(GravarNomeFantasiaSchema.safeParse({ nome_fantasia: 'x'.repeat(81) }).success).toBe(false);
        expect(GravarNomeFantasiaSchema.safeParse({ nome_fantasia: 'A', outro: 1 }).success).toBe(false);
    });
    it('MarcaEmpresa é estrita: a chave do armazenamento nunca sai na resposta', () => {
        const logo = { sha256: SHA, tipo: 'image/png', tamanho_bytes: 10, largura_px: 600, altura_px: 200, atualizada_em: '2026-11-15T12:00:00Z' };
        const marca = { tenant_id: '00000000-0000-4000-8000-000000000001', razao_social: 'Distribuidora Exemplo Ltda', nome_fantasia: null, logo };
        expect(MarcaEmpresaSchema.parse(marca)).toEqual(marca);
        expect(MarcaEmpresaSchema.safeParse({ ...marca, logo: { ...logo, chave: 'x' } }).success).toBe(false);
    });
});
describe('no aparelho: chaves reservadas do Core (desenho §3.1)', () => {
    it('nomeDaEmpresa: fantasia; vazia ou nula = razão social (spec §5)', () => {
        expect(nomeDaEmpresa('Mercado Bom', 'Mercado Bom Comércio Ltda')).toBe('Mercado Bom');
        expect(nomeDaEmpresa('  ', 'Mercado Bom Comércio Ltda')).toBe('Mercado Bom Comércio Ltda');
        expect(nomeDaEmpresa(null, 'Mercado Bom Comércio Ltda')).toBe('Mercado Bom Comércio Ltda');
    });
    it('parametrosDaEmpresa → empresaDosParametros: ida e volta; logo incompleta = null', () => {
        const linha = { nome: 'Razão Ltda', nome_fantasia: 'Fantasia', logo_sha256: SHA, logo_tipo: 'image/jpeg', logo_largura_px: 400, logo_altura_px: 200 };
        const p = parametrosDaEmpresa(linha);
        expect(p).toEqual({ empresa_nome: 'Fantasia', empresa_logo: { sha256: SHA, tipo: 'image/jpeg', largura_px: 400, altura_px: 200 } });
        expect(empresaDosParametros({ sync_auto_min: 30, ...p })).toEqual({ nome: 'Fantasia', logo: p.empresa_logo });
        expect(parametrosDaEmpresa({ ...linha, logo_sha256: null }).empresa_logo).toBeNull();
    });
    it('empresaDosParametros: servidor antigo (sem as chaves) = null; logo fora do contrato = sem logo', () => {
        expect(empresaDosParametros({})).toBeNull();
        expect(empresaDosParametros(undefined)).toBeNull();
        expect(empresaDosParametros({ empresa_nome: 'X', empresa_logo: { sha256: 'curto', tipo: 'image/png', largura_px: 1, altura_px: 1 } })).toEqual({ nome: 'X', logo: null });
    });
    it('proporcaoDaLogo: largura ÷ altura dos px gravados (RD-0921)', () => {
        expect(proporcaoDaLogo({ largura_px: 600, altura_px: 240 })).toBe(2.5);
    });
    it('o endereço dos bytes muda com o sha256', () => {
        expect(rotaLogoDoAparelho(SHA)).toBe(`/v1/me/empresa/logo/${SHA}`);
    });
});
