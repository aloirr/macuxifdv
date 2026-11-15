import { describe, expect, it } from 'vitest';
import { consultaNoTitulo, vazioDaBusca } from './vazio-busca';
const base = { consulta: 'refrijerante', filtroLigado: false, semInternet: false, dentroDoPedido: false };
describe('vazio da busca do Catálogo (T-0052)', () => {
    it('RF-CAT-01: filtro ligado vence todos os outros casos e a ação limpa os filtros', () => {
        const v = vazioDaBusca({ ...base, filtroLigado: true, semInternet: true, dentroDoPedido: true });
        expect(v.caso).toBe('filtro');
        expect(v.rotuloAcao).toBe('Limpar filtros');
        expect(v.apoio).toBe('Há filtro ligado. Tire o filtro para procurar em todo o catálogo.');
    });
    it('RF-CAT-01: sem filtro e sem internet vale o caso offline, mesmo dentro do pedido', () => {
        const v = vazioDaBusca({ ...base, semInternet: true, dentroDoPedido: true });
        expect(v.caso).toBe('offline');
        expect(v.rotuloAcao).toBe('Limpar a busca');
        expect(v.apoio).toBe('Confira a grafia, tente o código ou só o começo do nome. Com internet, a busca entende mais erros de digitação.');
    });
    it('RF-CAT-01: dentro do pedido explica que só aparecem os produtos do cliente', () => {
        const v = vazioDaBusca({ ...base, dentroDoPedido: true });
        expect(v.caso).toBe('pedido');
        expect(v.apoio).toBe('Confira a grafia, tente o código ou só o começo do nome. Aqui aparecem só os produtos que este cliente pode comprar.');
    });
    it('RF-CAT-01: nos demais casos só a orientação base', () => {
        const v = vazioDaBusca(base);
        expect(v.caso).toBe('demais');
        expect(v.apoio).toBe('Confira a grafia, tente o código ou só o começo do nome.');
        expect(v.titulo).toBe('Nada encontrado para "refrijerante"');
    });
    it('RF-CAT-01: consulta acima de 30 caracteres é cortada em 29 com reticências; 30 fica inteira', () => {
        expect(consultaNoTitulo('a'.repeat(30))).toBe('a'.repeat(30));
        expect(consultaNoTitulo('a'.repeat(31))).toBe(`${'a'.repeat(29)}…`);
        expect(consultaNoTitulo('  café  ')).toBe('café');
    });
});
