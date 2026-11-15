import { describe, expect, it } from 'vitest';
import { chaveMiniatura, criarCacheMiniaturas, estaNaJanela, miniaturaNoTeto } from './miniatura';
import { miniaturasLocais } from './miniatura-local';
const mini = (versao = 'v1', extra = {}) => ({ arquivo_id: null, url: 'https://cdn.exemplo.com/a.jpg', largura: 320, altura: 320, bytes_max: 30720, versao, ...extra });
/** Baixador controlável: cada chamada fica pendente até `liberar`. */
function baixadorManual() {
    const chamadas = [];
    let ativos = 0;
    let pico = 0;
    const baixar = (id) => new Promise((ok) => {
        ativos++;
        pico = Math.max(pico, ativos);
        chamadas.push({ id, fim: (r) => (ativos--, ok(r)) });
    });
    return { baixar, chamadas, pico: () => pico };
}
const vez = () => new Promise((r) => setTimeout(r, 0));
describe('T-0097: regras puras da miniatura', () => {
    it('T-0097: miniaturaNoTeto aceita até 320 px e 30 KB e recusa acima (ou nula)', () => {
        expect(miniaturaNoTeto(mini())).toBe(true);
        expect(miniaturaNoTeto(mini('v', { bytes_max: 40000 }))).toBe(false);
        expect(miniaturaNoTeto(mini('v', { largura: 400 }))).toBe(false);
        expect(miniaturaNoTeto(null)).toBe(false);
        expect(miniaturaNoTeto(undefined)).toBe(false);
    });
    it('T-0097: a chave muda com a versão da foto', () => {
        expect(chaveMiniatura('p1', mini('a'))).not.toBe(chaveMiniatura('p1', mini('b')));
        expect(chaveMiniatura('p1', mini('a'))).toBe(chaveMiniatura('p1', mini('a')));
    });
    it('T-0097: estaNaJanela respeita a folga e ignora o item ainda não medido', () => {
        expect(estaNaJanela({ y: 100, altura: 80 }, 800, 0)).toBe(true);
        expect(estaNaJanela({ y: 900, altura: 80 }, 800, 0)).toBe(false);
        expect(estaNaJanela({ y: 900, altura: 80 }, 800, 200)).toBe(true);
        expect(estaNaJanela({ y: -300, altura: 80 }, 800, 0)).toBe(false);
        expect(estaNaJanela({ y: -250, altura: 80 }, 800, 200)).toBe(true);
        expect(estaNaJanela({ y: 0, altura: 0 }, 800, 200)).toBe(false);
    });
});
describe('T-0097: cache e fila de miniaturas', () => {
    it('T-0097: baixa, marca pronta e avisa quem assinou', async () => {
        const b = baixadorManual();
        const c = criarCacheMiniaturas({ baixar: b.baixar, online: () => true });
        let avisos = 0;
        c.assinar(() => avisos++);
        expect(c.estado('p1', mini())).toBe('vazia');
        c.pedir('p1', mini());
        expect(c.estado('p1', mini())).toBe('baixando');
        b.chamadas[0].fim('ok');
        await vez();
        expect(c.estado('p1', mini())).toBe('pronta');
        expect(avisos).toBeGreaterThanOrEqual(2);
    });
    it('T-0097: sem sinal não toca a rede e fica vazia', () => {
        const b = baixadorManual();
        const c = criarCacheMiniaturas({ baixar: b.baixar, online: () => false });
        c.pedir('p1', mini());
        expect(b.chamadas).toHaveLength(0);
        expect(c.estado('p1', mini())).toBe('vazia');
    });
    it('T-0097: pedido repetido é deduplicado (na fila, baixando e pronta)', async () => {
        const b = baixadorManual();
        const c = criarCacheMiniaturas({ baixar: b.baixar, online: () => true });
        c.pedir('p1', mini());
        c.pedir('p1', mini());
        expect(b.chamadas).toHaveLength(1);
        b.chamadas[0].fim('ok');
        await vez();
        c.pedir('p1', mini());
        expect(b.chamadas).toHaveLength(1);
    });
    it('T-0097: respeita a concorrência e continua a fila quando um termina', async () => {
        const b = baixadorManual();
        const c = criarCacheMiniaturas({ baixar: b.baixar, online: () => true, concorrencia: 3 });
        for (let i = 0; i < 8; i++)
            c.pedir(`p${i}`, mini());
        expect(b.chamadas).toHaveLength(3);
        expect(c.pendentes()).toBe(5);
        while (b.chamadas.some((x) => x.id !== 'feito')) {
            const x = b.chamadas.find((y) => y.id !== 'feito');
            x.fim('ok');
            x.id = 'feito';
            await vez();
        }
        expect(b.chamadas).toHaveLength(8);
        expect(b.pico()).toBe(3);
    });
    it('T-0097: acima do teto não baixa e o estado é grande', () => {
        const b = baixadorManual();
        const c = criarCacheMiniaturas({ baixar: b.baixar, online: () => true });
        const grande = mini('v', { bytes_max: 99999 });
        c.pedir('p1', grande);
        expect(b.chamadas).toHaveLength(0);
        expect(c.estado('p1', grande)).toBe('grande');
    });
    it('T-0097: se o baixador acusa grande, guarda grande e não tenta de novo', async () => {
        const b = baixadorManual();
        const c = criarCacheMiniaturas({ baixar: b.baixar, online: () => true });
        c.pedir('p1', mini());
        b.chamadas[0].fim('grande');
        await vez();
        expect(c.estado('p1', mini())).toBe('grande');
        c.pedir('p1', mini());
        expect(b.chamadas).toHaveLength(1);
    });
    it('T-0097: falha (ou exceção) volta a vazia e permite nova tentativa', async () => {
        let n = 0;
        const c = criarCacheMiniaturas({
            baixar: async () => {
                if (n++ === 0)
                    throw new Error('rede');
                return 'ok';
            },
            online: () => true,
        });
        c.pedir('p1', mini());
        await vez();
        expect(c.estado('p1', mini())).toBe('vazia');
        c.pedir('p1', mini());
        await vez();
        expect(c.estado('p1', mini())).toBe('pronta');
    });
    it('T-0097: esquecer tira da fila o que saiu da tela, sem cancelar o que já baixa', async () => {
        const b = baixadorManual();
        const c = criarCacheMiniaturas({ baixar: b.baixar, online: () => true, concorrencia: 1 });
        c.pedir('p1', mini());
        c.pedir('p2', mini());
        c.pedir('p3', mini());
        c.esquecer('p2');
        c.esquecer('p1');
        expect(c.pendentes()).toBe(1);
        expect(c.estado('p2', mini())).toBe('vazia');
        expect(c.estado('p1', mini())).toBe('baixando');
        b.chamadas[0].fim('ok');
        await vez();
        expect(b.chamadas.map((x) => x.id)).toEqual(['p1', 'p3']);
    });
    it('T-0097: LRU descarta a mais antiga além da capacidade; ler renova', async () => {
        const c = criarCacheMiniaturas({ baixar: async () => 'ok', online: () => true, capacidade: 2 });
        for (const id of ['a', 'b']) {
            c.pedir(id, mini());
            await vez();
        }
        expect(c.estado('a', mini())).toBe('pronta'); // renova 'a'
        c.pedir('c', mini());
        await vez();
        expect(c.estado('a', mini())).toBe('pronta');
        expect(c.estado('b', mini())).toBe('vazia'); // saiu
    });
    it('T-0097: nova versão da foto é outro item (baixa de novo)', async () => {
        const b = baixadorManual();
        const c = criarCacheMiniaturas({ baixar: b.baixar, online: () => true });
        c.pedir('p1', mini('v1'));
        b.chamadas[0].fim('ok');
        await vez();
        expect(c.estado('p1', mini('v2'))).toBe('vazia');
        c.pedir('p1', mini('v2'));
        expect(b.chamadas).toHaveLength(2);
    });
});
describe('T-0097: miniaturasLocais', () => {
    it('T-0097: lê só os ids pedidos, ignora removida e miniatura inválida', async () => {
        const linhas = [
            { id: 'c1', produto_id: 'p1', deleted_at: null, miniatura: mini('a') },
            { id: 'c2', produto_id: 'p2', deleted_at: null, miniatura: null },
            { id: 'c3', produto_id: 'p3', deleted_at: '2026-11-07T00:00:00Z', miniatura: mini('c') },
            { id: 'c4', produto_id: 'p4', deleted_at: null, miniatura: mini('d', { bytes_max: 99999 }) },
        ];
        const pedidos = [];
        const leitor = { linhasPorCampo: async (e, campo, v) => (pedidos.push([e, campo, v]), linhas.filter((l) => v.includes(l.produto_id))) };
        const r = await miniaturasLocais(leitor, ['p1', 'p2', 'p3', 'p4', 'p1']);
        expect([...r.keys()]).toEqual(['p1']);
        expect(pedidos).toEqual([['produto_conteudo', 'produto_id', ['p1', 'p2', 'p3', 'p4']]]);
        expect((await miniaturasLocais(leitor, [])).size).toBe(0);
        expect(pedidos).toHaveLength(1);
    });
    it('T-0097: sem linhasPorCampo no leitor devolve vazio (não lê a tabela inteira)', async () => {
        expect((await miniaturasLocais({}, ['p1'])).size).toBe(0);
    });
});
