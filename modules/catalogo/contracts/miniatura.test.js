import { describe, expect, it } from 'vitest';
import { BYTES_MAX_MINIATURA, LADO_MAX_MINIATURA_PX, MiniaturaProdutoSchema, ProdutoConteudoSyncSchema } from './index';
const linha = {
    id: '0ca00000-0000-4000-8000-000000000001',
    updated_at: '2026-11-07T12:00:00.000000Z',
    deleted_at: null,
    external_id: null,
    produto_id: '0ca00000-0000-4000-8000-000000000002',
    descricao: 'Filtro',
};
const miniatura = { arquivo_id: '0ca00000-0000-4000-8000-000000000003', url: '/v1/arquivos/0ca00000-0000-4000-8000-000000000003', largura: 320, altura: 320, bytes_max: 30720, versao: 'v1' };
describe('T-0097: miniatura do produto no contrato do pull', () => {
    it('T-0097: os tetos são 320 px e 30 KB', () => {
        expect(LADO_MAX_MINIATURA_PX).toBe(320);
        expect(BYTES_MAX_MINIATURA).toBe(30720);
    });
    it('T-0097: linha antiga de produto_conteudo (sem miniatura) continua válida', () => {
        const r = ProdutoConteudoSyncSchema.parse(linha);
        expect(r.miniatura ?? null).toBeNull();
        expect(r.descricao).toBe('Filtro');
    });
    it('T-0097: miniatura válida (relativa ou https) é aceita', () => {
        expect(ProdutoConteudoSyncSchema.parse({ ...linha, miniatura }).miniatura).toEqual(miniatura);
        expect(MiniaturaProdutoSchema.safeParse({ ...miniatura, arquivo_id: null, url: 'https://cdn.exemplo.com/a.jpg' }).success).toBe(true);
    });
    it('T-0097: miniatura fora do teto vira null e não derruba a linha', () => {
        for (const ruim of [{ ...miniatura, largura: 321 }, { ...miniatura, bytes_max: 30721 }, { ...miniatura, url: 'http://x/a.jpg' }, { ...miniatura, versao: '' }]) {
            const r = ProdutoConteudoSyncSchema.safeParse({ ...linha, miniatura: ruim });
            expect(r.success).toBe(true);
            expect(r.success && r.data.miniatura).toBeNull();
        }
    });
});
