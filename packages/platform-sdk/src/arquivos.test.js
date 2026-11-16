import { describe, expect, it } from 'vitest';
import { CODIGOS_ARQUIVO, caminhoFoto, ConcluirEnvioSchema, conferirPartes, dimensoesJpeg, ehJpeg, PARTE_ENVIO_BYTES, PARTES_ENVIO_MAX, partesDoEnvio, perfilLeArquivo, problemasPerfisLeitura, TIPOS_ARQUIVO, TIPOS_ENVIO_APARELHO, UrlEnvioSchema, validarNovoArquivo, } from './arquivos';
const ID = '0f000000-0000-4000-8000-0000000000aa';
/** JPEG mínimo: SOI, APP0 (16 bytes), SOF0 com 640×480, EOI. Suficiente para a assinatura e as dimensões. */
function jpegDeTeste(largura = 640, altura = 480, extra = 0) {
    const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
    const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, altura >> 8, altura & 0xff, largura >> 8, largura & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, ...new Array(extra).fill(0), 0xff, 0xd9]);
}
describe('ADR 0010: regras puras dos arquivos', () => {
    it('caminho padrão da foto é fotos/<uuid>.jpg (o mesmo da câmera do shell); id inválido é erro', () => {
        expect(caminhoFoto(ID.toUpperCase())).toBe(`fotos/${ID}.jpg`);
        expect(() => caminhoFoto('../x')).toThrow(/UUID/);
    });
    it('assinatura JPEG FF D8 FF; PNG e vazio não passam', () => {
        expect(ehJpeg(jpegDeTeste())).toBe(true);
        expect(ehJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
        expect(ehJpeg(new Uint8Array())).toBe(false);
    });
    it('dimensões lidas do SOF (sem decodificar); sem SOF = null', () => {
        expect(dimensoesJpeg(jpegDeTeste(1600, 1200))).toEqual({ largura: 1600, altura: 1200 });
        expect(dimensoesJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
        expect(dimensoesJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeNull();
    });
    it('validarNovoArquivo: UUIDs, snake_case e tipo aceito', () => {
        expect(validarNovoArquivo({ id: ID, finalidade: 'fachada', entidade: 'visita', entidade_id: ID, cliente_id: null })).toEqual([]);
        const p = validarNovoArquivo({ id: 'x', finalidade: 'Fachada', entidade: 'visita-x', entidade_id: ID, cliente_id: 'y', tipo: 'image/gif' });
        expect(p).toHaveLength(5);
    });
});
describe('ADR 0041 (T-0147, RN-CORE-38): perfis de leitura do arquivo', () => {
    const SENSIVEL = ['admin', 'analista', 'gerente', 'supervisor'];
    it('lista válida: 1 a 7 perfis da plataforma, sem repetição; null = regra de sempre; vazia é recusada', () => {
        expect(problemasPerfisLeitura(null)).toEqual([]);
        expect(problemasPerfisLeitura(undefined)).toEqual([]);
        expect(problemasPerfisLeitura(SENSIVEL)).toEqual([]);
        expect(problemasPerfisLeitura([])).toEqual(['perfis_leitura vazio (use null para a regra de sempre)']);
        expect(problemasPerfisLeitura(['admin', 'diretor'])).toEqual(['perfil de leitura diretor não existe']);
        expect(problemasPerfisLeitura(['admin', 'admin'])).toEqual(['perfis_leitura com perfil repetido']);
        expect(validarNovoArquivo({ id: ID, finalidade: 'pdv', entidade: 'cliente_foto', entidade_id: ID, perfis_leitura: [] })).toHaveLength(1);
        expect(validarNovoArquivo({ id: ID, finalidade: 'pdv', entidade: 'cliente_foto', entidade_id: ID, perfis_leitura: SENSIVEL })).toEqual([]);
    });
    it('RN-CORE-38: admin, analista, gerente e supervisor leem o sensível; vendedor, promotor e assistente não', () => {
        for (const p of SENSIVEL)
            expect(perfilLeArquivo(SENSIVEL, { perfil: p }), p).toBe(true);
        for (const p of ['vendedor', 'promotor', 'assistente'])
            expect(perfilLeArquivo(SENSIVEL, { perfil: p }), p).toBe(false);
    });
    it('sem lista vale a regra de sempre; com lista, falha fechada sem perfil', () => {
        expect(perfilLeArquivo(null, { perfil: 'vendedor' })).toBe(true);
        expect(perfilLeArquivo(undefined, {})).toBe(true);
        expect(perfilLeArquivo(SENSIVEL, {})).toBe(false);
    });
    it('perfis resolvidos na requisição (ADR 0033) decidem pela BASE; o perfil do token só vale sem eles', () => {
        // personalizado sobre supervisor lê; o token diz supervisor mas o tenant deixou só um perfil de base vendedor: não lê
        expect(perfilLeArquivo(SENSIVEL, { perfil: 'vendedor', perfis: [{ base: 'vendedor' }, { base: 'supervisor' }] })).toBe(true);
        expect(perfilLeArquivo(SENSIVEL, { perfil: 'supervisor', perfis: [{ base: 'vendedor' }] })).toBe(false);
        expect(perfilLeArquivo(SENSIVEL, { perfil: 'gerente', perfis: [] })).toBe(true);
    });
});
describe('ADR 0058 §1: envio em partes de 8 MiB e tipos do lote de fotos', () => {
    it('tipos aceitos em plataforma.arquivo: JPEG, PNG, WEBP e o ZIP; o aparelho só envia JPEG', () => {
        expect([...TIPOS_ARQUIVO]).toEqual(['image/jpeg', 'image/png', 'image/webp', 'application/zip']);
        expect([...TIPOS_ENVIO_APARELHO]).toEqual(['image/jpeg']);
        expect(validarNovoArquivo({ id: ID, finalidade: 'foto_lote', entidade: 'foto_lote', entidade_id: ID, tipo: 'application/zip' })).toEqual([]);
        expect(validarNovoArquivo({ id: ID, finalidade: 'x', entidade: 'x', entidade_id: ID, tipo: 'image/gif' })).toEqual(['tipo image/gif não aceito']);
    });
    it('63 partes de 8 MiB cobrem os 500 MB da RN-CAT-14', () => {
        expect(PARTE_ENVIO_BYTES).toBe(8 * 1024 * 1024);
        expect(PARTES_ENVIO_MAX * PARTE_ENVIO_BYTES).toBeGreaterThanOrEqual(500 * 1024 * 1024);
        expect(partesDoEnvio(1)).toBe(1);
        expect(partesDoEnvio(PARTE_ENVIO_BYTES)).toBe(1);
        expect(partesDoEnvio(PARTE_ENVIO_BYTES + 1)).toBe(2);
        expect(partesDoEnvio(500 * 1024 * 1024)).toBe(63);
    });
    it('concluir: partes de 1 a 63 e tamanho positivo, sem campo extra', () => {
        expect(ConcluirEnvioSchema.safeParse({ partes: 2, tamanho_bytes: 9_000_000 }).success).toBe(true);
        expect(ConcluirEnvioSchema.safeParse({ partes: 0, tamanho_bytes: 1 }).success).toBe(false);
        expect(ConcluirEnvioSchema.safeParse({ partes: 64, tamanho_bytes: 1 }).success).toBe(false);
        expect(ConcluirEnvioSchema.safeParse({ partes: 1, tamanho_bytes: 1, sha256: 'x' }).success).toBe(false);
    });
    it('conferirPartes: 1 a n−1 com 8 MiB, a última de 1 a 8 MiB e a soma igual ao total; senão lista as faltantes', () => {
        const P = PARTE_ENVIO_BYTES;
        expect(conferirPartes([P, P, 10], 2 * P + 10)).toEqual({ ok: true });
        expect(conferirPartes([P], P)).toEqual({ ok: true });
        expect(conferirPartes([P, null, 10], 2 * P + 10)).toEqual({ ok: false, partes_faltando: [2] });
        expect(conferirPartes([P, P - 1, 10], 2 * P + 9)).toEqual({ ok: false, partes_faltando: [2] });
        expect(conferirPartes([P, 0], P)).toEqual({ ok: false, partes_faltando: [2] });
        expect(conferirPartes([P, 10], P + 11)).toEqual({ ok: false, partes_faltando: [] });
    });
    it('URL de envio: PUT, URL válida e expiração em ISO', () => {
        expect(UrlEnvioSchema.safeParse({ url: 'https://s3.exemplo/x?X-Amz-Signature=1', metodo: 'PUT', expira_em: '2026-11-15T12:00:00.000Z' }).success).toBe(true);
        expect(UrlEnvioSchema.safeParse({ url: 'https://s3.exemplo/x', metodo: 'GET', expira_em: '2026-11-15T12:00:00.000Z' }).success).toBe(false);
    });
    it('códigos novos do envio em partes', () => {
        expect(CODIGOS_ARQUIVO).toMatchObject({ parteInvalida: 'PARTE_INVALIDA', envioIncompleto: 'ENVIO_INCOMPLETO', urlAssinadaDesligada: 'URL_ASSINADA_DESLIGADA' });
    });
});
