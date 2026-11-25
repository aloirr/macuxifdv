/**
 * Busca e período da lista de Pedidos (T-0077, RF-VEN-05): texto sem acento/maiúscula, número sem zeros à esquerda, período
 * Dia | Mês | Ano no fuso do tenant, "emitido OU mudou de status no período" e contagem por situação. Funções puras, sem
 * relógio: o instante de "agora" e o fuso chegam por parâmetro. Dinheiro em centavos.
 */
import { localIsoDate } from '@macuxi/comum/fuso';
import { somarDiasCivis as somarDias } from '@macuxi/comum/relogio';
// ---------- texto ----------
/** Sem acento, sem maiúscula, sem espaços nas pontas. */
export function normalizarTexto(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
/** "000011" -> "11"; só zeros -> "0". */
export function numeroSemZeros(n) {
    const t = n.trim().replace(/^0+/, '');
    return t === '' && n.trim() !== '' ? '0' : t;
}
/** RF-VEN-05: acha por fantasia, razão social ou número (com ou sem zeros à esquerda). Busca vazia casa tudo. */
export function casaComBusca(i, busca) {
    const q = normalizarTexto(busca);
    if (!q)
        return true;
    if (normalizarTexto(i.nome_fantasia).includes(q) || normalizarTexto(i.razao_social).includes(q))
        return true;
    if (/^\d+$/.test(q) && i.numero) {
        return numeroSemZeros(i.numero).includes(numeroSemZeros(q)) || i.numero.includes(q);
    }
    return false;
}
/** Quebra `texto` em trechos marcando a primeira ocorrência de `busca` (sem acento/maiúscula), preservando o original. */
export function destacarTrecho(texto, busca) {
    const q = normalizarTexto(busca);
    if (!q)
        return [{ texto, destaque: false }];
    // normaliza caractere a caractere para manter o mapa de posições com o original
    const chars = Array.from(texto);
    let norm = '';
    const inicio = [];
    chars.forEach((c, idx) => {
        const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        for (let k = 0; k < n.length; k++)
            inicio.push(idx);
        norm += n;
    });
    const achou = norm.indexOf(q);
    if (achou < 0)
        return [{ texto, destaque: false }];
    const de = inicio[achou];
    const ate = (inicio[achou + q.length - 1] ?? chars.length - 1) + 1;
    const partes = [
        { texto: chars.slice(0, de).join(''), destaque: false },
        { texto: chars.slice(de, ate).join(''), destaque: true },
        { texto: chars.slice(ate).join(''), destaque: false },
    ];
    return partes.filter((p) => p.texto !== '');
}
const pad = (n) => String(n).padStart(2, '0');
/** Data civil ± n dias (a conta única é `somarDiasCivis` do @macuxi/comum, RD-0042). */
export { somarDias };
/** O período que contém o instante `agora`, no fuso do tenant (padrão da tela: `periodoDe('mes', agora, tz)`). */
export function periodoDe(tipo, agora, tz) {
    const dia = localIsoDate(agora, tz);
    if (tipo === 'semana')
        return { tipo, valor: somarDias(dia, -new Date(`${dia}T00:00:00Z`).getUTCDay()) };
    return { tipo, valor: tipo === 'dia' ? dia : tipo === 'mes' ? dia.slice(0, 7) : dia.slice(0, 4) };
}
/** Passo do ‹ › (±1 dia, mês ou ano), na data civil. */
export function deslocarPeriodo(p, passo) {
    if (p.tipo === 'ano')
        return { tipo: 'ano', valor: String(Number(p.valor) + passo) };
    if (p.tipo === 'semana')
        return { tipo: 'semana', valor: somarDias(p.valor, 7 * passo) };
    if (p.tipo === 'mes') {
        const [a, m] = p.valor.split('-').map(Number);
        const d = new Date(Date.UTC(a, m - 1 + passo, 1));
        return { tipo: 'mes', valor: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` };
    }
    const [a, m, dd] = p.valor.split('-').map(Number);
    return { tipo: 'dia', valor: new Date(Date.UTC(a, m - 1, dd + passo)).toISOString().slice(0, 10) };
}
const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
/** Nome do mês (1 a 12) com inicial maiúscula. */
export function nomeDoMes(mes) {
    return MESES[mes - 1] ?? '';
}
/** "Seg, 02/11/2026" · "Novembro 2026" · "2026". */
export function rotuloDoPeriodo(p) {
    if (p.tipo === 'semana')
        return `Semana de ${p.valor.slice(8, 10)}/${p.valor.slice(5, 7)}/${p.valor.slice(0, 4)}`;
    if (p.tipo === 'ano')
        return p.valor;
    if (p.tipo === 'mes') {
        const [a, m] = p.valor.split('-').map(Number);
        return `${nomeDoMes(m)} ${a}`;
    }
    const [a, m, d] = p.valor.split('-').map(Number);
    return `${DIAS_CURTOS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]}, ${pad(d)}/${pad(m)}/${a}`;
}
/** Os 12 meses (AAAA-MM) de um ano, para a lista de meses. */
export function mesesDoPeriodo(ano) {
    return Array.from({ length: 12 }, (_, i) => `${ano}-${pad(i + 1)}`);
}
/** Datas civis (no fuso) em que o item "aconteceu": emissão e última mudança de status. */
const datasEmCache = new WeakMap();
function datasDoItem(i, tz) {
    // a data civil (Intl, caro) é calculada uma vez por pedido: trocar Dia/Mês/Ano ou a situação reaproveita a conta
    const c = datasEmCache.get(i);
    if (c && c.tz === tz && c.emitido === i.emitido_em && c.alterado === (i.status_alterado_em ?? null))
        return c.datas;
    const out = [localIsoDate(i.emitido_em, tz)];
    if (i.status_alterado_em)
        out.push(localIsoDate(i.status_alterado_em, tz));
    datasEmCache.set(i, { tz, emitido: i.emitido_em, alterado: i.status_alterado_em ?? null, datas: out });
    return out;
}
/** RF-VEN-05: entra se foi emitido no período OU mudou de status nele. */
export function itemNoPeriodo(i, p, tz) {
    if (p.tipo === 'semana') {
        const fim = ultimoDia(p);
        return datasDoItem(i, tz).some((d) => d >= p.valor && d <= fim);
    }
    return datasDoItem(i, tz).some((d) => d.startsWith(p.valor));
}
/**
 * A lista: com texto na busca ignora o período (procura em tudo que o aparelho tem); sem texto, vale o período.
 * Mantém a ordem recebida.
 */
export function filtrarLista(itens, o) {
    if (normalizarTexto(o.busca))
        return itens.filter((i) => casaComBusca(i, o.busca));
    return itens.filter((i) => itemNoPeriodo(i, o.periodo, o.tz));
}
/** Dias (AAAA-MM-DD, ordenados) do mês que têm pedido, para a marca no calendário. */
export function diasComPedido(itens, mes, tz) {
    const s = new Set();
    for (const i of itens)
        for (const d of datasDoItem(i, tz))
            if (d.startsWith(mes))
                s.add(d);
    return [...s].sort();
}
export const ROTULO_SITUACAO = {
    todos: 'Todos',
    aguardando: 'Aguardando',
    aprovados: 'Aprovados',
    rejeitados: 'Rejeitados',
    orcamentos: 'Orçamentos',
    na_fila: 'Na fila',
};
const APROVADOS = ['approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced'];
/** A situação (um chip) a que o item pertence. Cancelado só aparece em Todos. */
export function situacaoDoItem(i) {
    if (i.tipo === 'orcamento')
        return 'orcamentos';
    if (i.local || i.status === 'queued')
        return 'na_fila';
    if (i.status === 'pending_approval')
        return 'aguardando';
    if (APROVADOS.includes(i.status))
        return 'aprovados';
    if (i.status === 'rejected')
        return 'rejeitados';
    return null;
}
export function itemNaSituacao(i, s) {
    return s === 'todos' || situacaoDoItem(i) === s;
}
/** Ordem fixa da linha de chips. */
const ORDEM_DOS_CHIPS = ['todos', 'aguardando', 'aprovados', 'rejeitados', 'orcamentos', 'na_fila'];
/** Contagem para a linha única de chips; `chips` traz só as situações que têm itens (e Todos). */
export function contarPorSituacao(itens) {
    const c = { todos: itens.length, aguardando: 0, aprovados: 0, rejeitados: 0, orcamentos: 0, na_fila: 0 };
    for (const i of itens) {
        const s = situacaoDoItem(i);
        if (s)
            c[s] += 1;
    }
    const chips = ORDEM_DOS_CHIPS.filter((id) => id === 'todos' || c[id] > 0).map((id) => ({ id, rotulo: ROTULO_SITUACAO[id], quantidade: c[id] }));
    return { ...c, chips };
}
/** "9 pedidos · R$ 4.023": pedidos que valem (sem orçamento e sem cancelado; RN-VEN-18, RN-CORE-21). */
export function resumoDaLista(itens) {
    const v = itens.filter((i) => i.tipo !== 'orcamento' && i.status !== 'cancelled');
    return { quantidade: v.length, total_cents: v.reduce((s, i) => s + i.total_cents, 0) };
}
/** Janela de pedidos que o aparelho guarda (dias). */
export const JANELA_DIAS = 90;
/** Primeiro dia (AAAA-MM-DD) do período. */
function primeiroDia(p) {
    return p.tipo === 'dia' || p.tipo === 'semana' ? p.valor : p.tipo === 'mes' ? `${p.valor}-01` : `${p.valor}-01-01`;
}
/** Último dia (AAAA-MM-DD) do período. */
function ultimoDia(p) {
    if (p.tipo === 'dia')
        return p.valor;
    if (p.tipo === 'semana')
        return somarDias(p.valor, 6);
    if (p.tipo === 'ano')
        return `${p.valor}-12-31`;
    const [a, m] = p.valor.split('-').map(Number);
    return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}
/**
 * RF-VEN-05: o período inteiro é anterior à janela do aparelho (mais de 90 dias): só o servidor tem; sem sinal a tela diz
 * "Disponível com conexão".
 */
export function periodoForaDaJanela(p, agora, tz, dias = JANELA_DIAS) {
    const t = typeof agora === 'string' ? new Date(agora).getTime() : agora.getTime();
    return ultimoDia(p) < localIsoDate(new Date(t - dias * 86_400_000), tz);
}
/**
 * RF-VEN-05: o período começa antes da janela do aparelho e termina dentro dela (ex.: agosto): a lista mostra só o que o
 * aparelho tem e a tela avisa.
 */
export function periodoParcialNaJanela(p, agora, tz, dias = JANELA_DIAS) {
    if (periodoForaDaJanela(p, agora, tz, dias))
        return false;
    const t = typeof agora === 'string' ? new Date(agora).getTime() : agora.getTime();
    const limite = localIsoDate(new Date(t - dias * 86_400_000), tz);
    return primeiroDia(p) < limite;
}
/** Situação da lista que a tela escolhida (chip, card do Início) vale: com texto na busca vale sempre Todos. */
export function situacaoEfetiva(escolhida, buscando) {
    return buscando ? 'todos' : escolhida;
}
/** Linha de chips com o chip ativo sempre presente, mesmo com 0 itens (não some sob o dedo). */
export function chipsComAtivo(chips, ativo) {
    if (chips.some((c) => c.id === ativo) || !(ativo in ROTULO_SITUACAO))
        return chips;
    const id = ativo;
    const novo = { id, rotulo: ROTULO_SITUACAO[id], quantidade: 0 };
    const posicao = (x) => ORDEM_DOS_CHIPS.indexOf(x);
    const depois = chips.findIndex((c) => posicao(c.id) > posicao(id));
    return depois < 0 ? [...chips, novo] : [...chips.slice(0, depois), novo, ...chips.slice(depois)];
}
/**
 * T-0077 D1 (RF-VEN-05): data da última mudança de status do pedido, a partir dos eventos do aparelho (`pedido_evento`,
 * `de` ≠ nulo = troca de status). Só o evento de criação = nunca mudou (null). Sem nenhum evento no aparelho, cai no
 * `updated_at` da linha (aproximação); vazio = null.
 */
export function ultimaMudancaDeStatus(eventos, updatedAt) {
    if (eventos.length === 0)
        return updatedAt || null;
    let ultima = null;
    for (const e of eventos)
        if (e.de !== null && (ultima === null || e.ocorrido_em > ultima))
            ultima = e.ocorrido_em;
    return ultima;
}
/** Primeiro e último dia (AAAA-MM-DD) do período: o `from`/`to` da consulta ao servidor (T-0077 item 6). */
export function intervaloDoPeriodo(p) {
    return { from: primeiroDia(p), to: ultimoDia(p) };
}
