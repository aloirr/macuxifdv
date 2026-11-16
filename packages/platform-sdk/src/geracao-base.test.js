/**
 * ADR 0021 (T-0079): regra pura da geração da base — o que o aparelho faz quando o servidor manda outra `geracao_base`.
 */
import { describe, expect, it } from 'vitest';
import { decidirGeracao, filaNaTrocaDeGeracao } from './geracao-base';
const item = (id, criado_em, extra = {}) => ({
    id,
    entidade: 'pedido',
    modulo: 'vendedor',
    operacao: 'upsert',
    payload: { id },
    rotulo: 'Pedido',
    detalhe: '',
    criado_em,
    tentativas: 0,
    ultimo_erro: '',
    ultima_tentativa_em: null,
    situacao: 'pendente',
    codigo: null,
    ...extra,
});
const aceito = (id, criado_em) => ({
    ...item(id, criado_em, { tentativas: 1, ultima_tentativa_em: '2026-11-04T10:00:00.000Z' }),
    situacao: 'aceito',
    aceito_em: '2026-11-04T10:00:00.000Z',
    aceito_servidor_em: '2026-11-04T10:00:00.000Z',
});
describe('decidirGeracao (ADR 0021 §4)', () => {
    it('servidor sem o campo (antigo ou antes da migração) → nada muda, guardada ou não', () => {
        expect(decidirGeracao(null, undefined)).toBe('sem_marcador');
        expect(decidirGeracao('g1', undefined)).toBe('sem_marcador');
        expect(decidirGeracao('g1', null)).toBe('sem_marcador');
        expect(decidirGeracao('g1', '')).toBe('sem_marcador');
    });
    it('aparelho sem geração guardada (instalação nova ou app atualizado) → adota, sem apagar', () => {
        expect(decidirGeracao(null, 'g1')).toBe('adotar');
    });
    it('igual → nada muda; diferente → troca de geração', () => {
        expect(decidirGeracao('g1', 'g1')).toBe('igual');
        expect(decidirGeracao('g1', 'g2')).toBe('trocou');
    });
    it('compara sem caixa e sem espaço (uuid do Postgres em minúsculas, texto vindo de outro lugar)', () => {
        expect(decidirGeracao('8F2C0000-0000-4000-8000-000000000001', ' 8f2c0000-0000-4000-8000-000000000001 ')).toBe('igual');
    });
});
describe('filaNaTrocaDeGeracao (ADR 0021 §5.1)', () => {
    it('aceitos ainda sobrepostos voltam como pendentes, na ordem de criação, antes dos itens mais novos', () => {
        const fila = [item('b', '2026-11-04T09:00:00.000Z'), item('d', '2026-11-04T11:00:00.000Z')];
        const aceitos = [aceito('c', '2026-11-04T10:00:00.000Z'), aceito('a', '2026-11-04T08:00:00.000Z')];
        const nova = filaNaTrocaDeGeracao(fila, aceitos);
        expect(nova.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
        const c = nova.find((i) => i.id === 'c');
        expect(c).toMatchObject({ situacao: 'pendente', codigo: null, ultimo_erro: '', tentativas: 1 });
        expect(c).not.toHaveProperty('aceito_em');
        expect(c).not.toHaveProperty('aceito_servidor_em');
    });
    it('nenhum item da fila se perde nem muda de situação (falhou e modulo_inativo ficam como estão)', () => {
        const fila = [
            item('x', '2026-11-04T09:00:00.000Z', { situacao: 'falhou', codigo: 'RN-VEN-02', ultimo_erro: 'Total negativo.' }),
            item('y', '2026-11-04T09:30:00.000Z', { situacao: 'modulo_inativo', codigo: 'MODULO_INATIVO' }),
        ];
        expect(filaNaTrocaDeGeracao(fila, [])).toEqual(fila);
    });
    it('mesmo id na fila e nos aceitos (app caiu entre as gravações) → fica uma vez, a versão da fila', () => {
        const fila = [item('a', '2026-11-04T08:00:00.000Z', { payload: { editado: true } })];
        const nova = filaNaTrocaDeGeracao(fila, [aceito('a', '2026-11-04T08:00:00.000Z')]);
        expect(nova).toHaveLength(1);
        expect(nova[0].payload).toEqual({ editado: true });
    });
});
