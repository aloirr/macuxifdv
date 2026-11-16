import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { definirEvento } from './eventos';
import { conferirEventosPublicados, eventoTolerante, lerPayloadTolerante, schemaOficialDe, tolerante } from './tolerante';
const U = '11111111-1111-4111-8111-111111111111';
const Item = z.object({ produto_id: z.string().uuid(), quantidade: z.number().int().positive() }).strict();
const Oficial = z
    .object({
    pedido_id: z.string().uuid(),
    status: z.enum(['aprovado', 'cancelado']),
    parcial: z.boolean().default(false),
    itens: z.array(Item).min(1),
    entrega: z.discriminatedUnion('modalidade', [z.object({ modalidade: z.literal('CIF') }).strict(), z.object({ modalidade: z.literal('FOB'), transportadora_id: z.string().uuid() }).strict()]).nullable(),
    extra: z.object({ a: z.number() }).passthrough().optional(),
})
    .strict()
    .superRefine((v, ctx) => {
    if (v.status === 'cancelado' && v.itens.length > 1)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itens'], message: 'RN-X: cancelado com 1 item' });
});
const valido = { pedido_id: U, status: 'aprovado', itens: [{ produto_id: U, quantidade: 2 }], entrega: { modalidade: 'FOB', transportadora_id: U } };
describe('T-0024: tolerante — saída strict, leitura tolerante', () => {
    it('campo novo (aditivo) no topo, em item de array e em ramo de união é descartado na leitura', () => {
        const novo = { ...valido, campo_novo: 1, itens: [{ produto_id: U, quantidade: 2, total_cents: 10 }], entrega: { ...valido.entrega, prazo: 3 } };
        expect(Oficial.safeParse(novo).success).toBe(false);
        const r = tolerante(Oficial).parse(novo);
        expect(r).toEqual({ ...valido, parcial: false });
        expect(r).not.toHaveProperty('campo_novo');
    });
    it('continua validando como o contrato: enum, mínimo do array, default, refinamento', () => {
        const t = tolerante(Oficial);
        expect(t.safeParse({ ...valido, status: 'devolvido' }).success).toBe(false); // vocabulário novo = @2
        expect(t.safeParse({ ...valido, itens: [] }).success).toBe(false); // .min(1) mantido
        expect(t.safeParse({ ...valido, pedido_id: undefined }).success).toBe(false); // obrigatório continua obrigatório
        expect(t.parse(valido).parcial).toBe(false); // default mantido
        const r = t.safeParse({ ...valido, status: 'cancelado', itens: [valido.itens[0], valido.itens[0]] });
        expect(r.success).toBe(false);
        expect(r.success ? '' : r.error.issues[0]?.message).toBe('RN-X: cancelado com 1 item');
    });
    it('não altera o schema oficial e mantém passthrough como está', () => {
        tolerante(Oficial);
        expect(Oficial.safeParse({ ...valido, x: 1 }).success).toBe(false);
        expect(tolerante(Oficial).parse({ ...valido, extra: { a: 1, b: 2 } }).extra).toEqual({ a: 1, b: 2 });
    });
    it('schemaOficialDe aponta para o schema do dono (também depois de converter duas vezes)', () => {
        const t = tolerante(Oficial);
        expect(schemaOficialDe(t)).toBe(Oficial);
        expect(schemaOficialDe(tolerante(t))).toBe(Oficial);
        expect(schemaOficialDe(Oficial)).toBe(Oficial);
    });
    it('lazy, tupla, record e intersecção', () => {
        const NoS = z.lazy(() => z.object({ id: z.string(), filhos: z.array(NoS) }).strict());
        expect(tolerante(NoS).parse({ id: 'a', x: 1, filhos: [{ id: 'b', y: 2, filhos: [] }] })).toEqual({ id: 'a', filhos: [{ id: 'b', filhos: [] }] });
        expect(tolerante(z.tuple([z.object({ a: z.number() }).strict()])).parse([{ a: 1, b: 2 }])).toEqual([{ a: 1 }]);
        expect(tolerante(z.record(z.object({ a: z.number() }).strict())).parse({ k: { a: 1, b: 2 } })).toEqual({ k: { a: 1 } });
        const I = z.intersection(z.object({ a: z.number() }).strict(), z.object({ b: z.number() }).strict());
        expect(tolerante(I).parse({ a: 1, b: 2, c: 3 })).toEqual({ a: 1, b: 2 });
    });
});
describe('T-0024: eventoTolerante e lerPayloadTolerante', () => {
    const EVENTO = definirEvento('vendedor.pedido.aprovado@1', Oficial);
    it('mantém nome, módulo e versão do dono; só o schema fica tolerante', () => {
        const t = eventoTolerante(EVENTO);
        expect({ nome: t.nome, modulo: t.modulo, entidade: t.entidade, fato: t.fato, versao: t.versao }).toEqual({ nome: EVENTO.nome, modulo: 'vendedor', entidade: 'pedido', fato: 'aprovado', versao: 1 });
        expect(schemaOficialDe(t.schema)).toBe(EVENTO.schema);
        expect(t.schema.parse({ ...valido, novo: true })).toEqual({ ...valido, parcial: false });
    });
    it('payload fora do contrato → null (sem lançar)', () => {
        expect(lerPayloadTolerante(EVENTO, { ...valido, novo: 1 })).toEqual({ ...valido, parcial: false });
        expect(lerPayloadTolerante(EVENTO, { pedido_id: 'x' })).toBeNull();
        expect(lerPayloadTolerante(EVENTO, null)).toBeNull();
    });
});
describe('T-0024: conferirEventosPublicados', () => {
    const EVENTO_A = definirEvento('vendedor.pedido.criado@1', z.object({ pedido_id: z.string() }).strict());
    const COPIA = definirEvento('integracao.pedido.retorno_erp@1', z.object({}));
    it('ok quando todo `publica` tem definição exportada e não há definição alheia', () => {
        expect(conferirEventosPublicados({ id: 'vendedor', publica: ['vendedor.pedido.criado@1'] }, { EVENTO_A, PedidoSchema: z.object({}), NOME: 'x' })).toEqual([]);
    });
    it('acusa evento publicado sem definição e cópia de evento de outro módulo', () => {
        const p = conferirEventosPublicados({ id: 'vendedor', publica: ['vendedor.pedido.criado@1', 'vendedor.pedido.faturado@1'] }, { EVENTO_A, COPIA });
        expect(p).toEqual([
            'vendedor.pedido.faturado@1: publicado por vendedor sem DefinicaoEvento exportada no contracts',
            'integracao.pedido.retorno_erp@1: contracts de vendedor exporta definição de evento de integracao (importe do contracts do dono)',
        ]);
    });
});
