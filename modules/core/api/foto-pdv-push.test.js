/**
 * Push `cliente_foto` (RN-CORE-38; T-0147): carteira, tipo, "só o que falta", perfis de leitura do arquivo e idempotência.
 * Sem banco: o `db` falso responde por trecho de SQL.
 */
import { describe, expect, it, vi } from 'vitest';
import { receberFotosPdv } from './foto-pdv-push';
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLIENTE = U(2);
const TIPO = U(3);
const EU = U(9);
function montar(c = {}) {
    const sqls = [];
    const registrarArquivo = vi.fn(async () => ({ criado: true }));
    const db = {
        query: vi.fn(async (sql) => {
            sqls.push(sql);
            if (sql.includes('from core.cliente_foto where id'))
                return { rows: c.ja ? [c.ja] : [] };
            if (sql.includes('from core.cliente where'))
                return { rows: [{ '?column?': 1 }] };
            if (sql.includes('from core.foto_tipo'))
                return { rows: c.tipo === null ? [] : [{ id: TIPO, ...(c.tipo ?? { sensivel: false, fachada: true, ativo: true }) }] };
            if (sql.includes('from core.cliente_foto where cliente_id'))
                return { rows: c.vigente ? [{ id: U(50) }] : [] };
            return { rows: [] };
        }),
    };
    const ctx = {
        usuario: { id: EU, perfil: c.perfil ?? 'vendedor' },
        carteira: async () => c.carteira ?? new Set([CLIENTE]),
        comTenant: async (fn) => fn(db, { registrarArquivo }),
    };
    return { ctx, sqls, registrarArquivo };
}
const item = (extra = {}) => ({
    id: U(1),
    operacao: 'upsert',
    payload: { id: U(1), cliente_id: CLIENTE, foto_tipo_id: TIPO, arquivo_id: U(4), origem: 'camera', tirada_em: '2026-11-10T15:00:00.000Z', ...extra },
});
describe('RN-CORE-38: receber o push cliente_foto', () => {
    it('RN-CORE-38: fachada aceita referencia o arquivo sem restrição de perfil (regra da carteira)', async () => {
        const m = montar();
        expect(await receberFotosPdv(m.ctx, [item()])).toEqual([{ id: U(1), status: 'aceito' }]);
        expect(m.registrarArquivo).toHaveBeenCalledWith(expect.objectContaining({ id: U(4), finalidade: 'pdv', entidade: 'cliente_foto', entidade_id: U(1), cliente_id: CLIENTE, perfis_leitura: null }));
    });
    it('RN-CORE-38: tipo sensível grava admin, analista, gerente e supervisor em perfis_leitura', async () => {
        const m = montar({ tipo: { sensivel: true, fachada: false, ativo: true } });
        await receberFotosPdv(m.ctx, [item()]);
        expect(m.registrarArquivo).toHaveBeenCalledWith(expect.objectContaining({ perfis_leitura: ['admin', 'analista', 'gerente', 'supervisor'] }));
    });
    it('RN-CORE-38: cliente fora da carteira é recusado e nada é gravado', async () => {
        const m = montar({ carteira: new Set() });
        expect(await receberFotosPdv(m.ctx, [item()])).toMatchObject([{ status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' }]);
        expect(m.registrarArquivo).not.toHaveBeenCalled();
    });
    it('RN-CORE-38: tipo inexistente ou inativo é recusado', async () => {
        const m = montar({ tipo: null });
        expect(await receberFotosPdv(m.ctx, [item()])).toMatchObject([{ status: 'rejeitado', codigo: 'FOTO_TIPO_NAO_ENCONTRADO' }]);
        const n = montar({ tipo: { sensivel: false, fachada: true, ativo: false } });
        expect(await receberFotosPdv(n.ctx, [item()])).toMatchObject([{ status: 'rejeitado', codigo: 'FOTO_TIPO_NAO_ENCONTRADO' }]);
    });
    it('RN-CORE-38: vendedor só envia o que falta; supervisor substitui e a antiga sai logicamente', async () => {
        const v = montar({ vigente: true });
        expect(await receberFotosPdv(v.ctx, [item()])).toMatchObject([{ status: 'rejeitado', codigo: 'RN-CORE-38', mensagem: 'Esta foto já foi enviada.' }]);
        const s = montar({ vigente: true, perfil: 'supervisor' });
        expect(await receberFotosPdv(s.ctx, [item()])).toEqual([{ id: U(1), status: 'aceito' }]);
        expect(s.sqls.some((q) => q.includes('update core.cliente_foto set deleted_at'))).toBe(true);
    });
    it('RN-CORE-38: reenviar o mesmo comando é aceito sem gravar de novo; id de outro dono é recusado', async () => {
        const m = montar({ ja: { cliente_id: CLIENTE, foto_tipo_id: TIPO, enviado_por: EU } });
        expect(await receberFotosPdv(m.ctx, [item()])).toEqual([{ id: U(1), status: 'aceito' }]);
        expect(m.registrarArquivo).not.toHaveBeenCalled();
        const o = montar({ ja: { cliente_id: CLIENTE, foto_tipo_id: TIPO, enviado_por: U(77) } });
        expect(await receberFotosPdv(o.ctx, [item()])).toMatchObject([{ status: 'rejeitado', codigo: 'ID_EM_USO' }]);
    });
    it('RN-CORE-38: o aparelho não remove foto e o id do item tem de conferir com o payload', async () => {
        const m = montar();
        expect(await receberFotosPdv(m.ctx, [{ ...item(), operacao: 'remover' }])).toMatchObject([{ codigo: 'OPERACAO_NAO_SUPORTADA' }]);
        expect(await receberFotosPdv(m.ctx, [item({ id: U(5) })])).toMatchObject([{ codigo: 'PAYLOAD_INVALIDO' }]);
    });
});
