/**
 * Miniatura do produto no aparelho (RF-CAT-03/09, T-0097). Puro (sem react-native): a foto NÃO vem no pull; o pull traz só a
 * referência (`MiniaturaProduto`) e o aparelho baixa sob demanda, só dos itens visíveis, com fila de concorrência limitada,
 * cache LRU em memória do estado e sem tocar a rede quando não há sinal. Quem baixa de fato (cache de disco) é a porta
 * `baixar`, injetada pela tela. Acima do teto (`BYTES_MAX_MINIATURA`) nunca baixa.
 */
import { BYTES_MAX_MINIATURA, LADO_MAX_MINIATURA_PX, MiniaturaProdutoSchema } from '../../contracts';
/** A miniatura respeita os tetos do contrato (320 px, 30 KB)? Acima, o aparelho não baixa. */
export function miniaturaNoTeto(m) {
    if (!m)
        return false;
    return MiniaturaProdutoSchema.safeParse(m).success && m.largura <= LADO_MAX_MINIATURA_PX && m.altura <= LADO_MAX_MINIATURA_PX && m.bytes_max <= BYTES_MAX_MINIATURA;
}
/** Chave do cache: produto + versão da foto (mudou a foto, muda a chave). */
export const chaveMiniatura = (produtoId, m) => `${produtoId}@${m.versao}`;
/** O retângulo (topo `y` e `altura`, relativos à janela) cruza a janela [0, alturaJanela] com `folga` de cada lado? */
export function estaNaJanela(r, alturaJanela, folga = 0) {
    if (r.altura <= 0 && r.y === 0)
        return false; // ainda não medido
    return r.y + r.altura >= -folga && r.y <= alturaJanela + folga;
}
export function criarCacheMiniaturas(opcoes) {
    const limite = Math.max(1, opcoes.concorrencia ?? 3);
    const capacidade = Math.max(1, opcoes.capacidade ?? 300);
    /** LRU de resultados finais (Map mantém a ordem de inserção; reinserir = mais recente). */
    const prontos = new Map();
    const baixando = new Set();
    const fila = [];
    const ouvintes = new Set();
    let ativos = 0;
    const avisar = () => ouvintes.forEach((o) => o());
    const guardar = (chave, r) => {
        prontos.delete(chave);
        prontos.set(chave, r);
        while (prontos.size > capacidade)
            prontos.delete(prontos.keys().next().value);
    };
    function andar() {
        while (ativos < limite && fila.length > 0) {
            const t = fila.shift();
            ativos++;
            baixando.add(t.chave);
            let tentativa;
            try {
                tentativa = opcoes.baixar(t.produtoId, t.m);
            }
            catch {
                tentativa = Promise.resolve('falhou');
            }
            void tentativa
                .catch(() => 'falhou')
                .then((r) => {
                baixando.delete(t.chave);
                ativos--;
                if (r === 'ok')
                    guardar(t.chave, 'pronta');
                else if (r === 'grande')
                    guardar(t.chave, 'grande');
                avisar(); // 'falhou': volta a 'vazia' e pode ser pedida de novo
                andar();
            });
        }
    }
    return {
        estado(produtoId, m) {
            if (!m)
                return 'vazia';
            if (!miniaturaNoTeto(m))
                return 'grande';
            const chave = chaveMiniatura(produtoId, m);
            const p = prontos.get(chave);
            if (p) {
                prontos.delete(chave);
                prontos.set(chave, p); // leitura renova o LRU
                return p;
            }
            return baixando.has(chave) || fila.some((f) => f.chave === chave) ? 'baixando' : 'vazia';
        },
        pedir(produtoId, m) {
            if (!miniaturaNoTeto(m))
                return;
            const chave = chaveMiniatura(produtoId, m);
            if (prontos.has(chave) || baixando.has(chave) || fila.some((f) => f.chave === chave))
                return;
            if (!opcoes.online())
                return;
            fila.push({ chave, produtoId, m });
            avisar();
            andar();
        },
        esquecer(produtoId) {
            const antes = fila.length;
            for (let i = fila.length - 1; i >= 0; i--)
                if (fila[i].produtoId === produtoId)
                    fila.splice(i, 1);
            if (fila.length !== antes)
                avisar();
        },
        assinar(ouvinte) {
            ouvintes.add(ouvinte);
            return () => ouvintes.delete(ouvinte);
        },
        pendentes: () => fila.length,
    };
}
