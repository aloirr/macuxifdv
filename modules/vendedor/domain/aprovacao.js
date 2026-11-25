/**
 * Recebimento, alçada e decisão de aprovação do pedido (T-0029, ADR 0011). Funções puras: a API do Vendedor e o app
 * usam a mesma regra (RN-VEN-10), e a API sempre revalida.
 */
import { validateOrder } from './order';
import { APLICACAO_MAX_ORCAMENTO_PADRAO, retratoAplicacao } from './aplicacao';
import { decisorEhAutor, MSG_APROVACAO_DO_PROPRIO_PEDIDO } from './pedido-em-nome';
import { aprovacoesFinanceiras } from './credito-pedido';
import { medidaDaFaixa, precoBaseDoItem } from './preco-item';
import { CODIGO_DESCONTO_PEDIDO_ACIMA_LIMITE, limiteDoUsuario, mensagemPedidoAcimaDoLimite, minimoDoItem, pedidoAcimaDoLimite } from './limite-desconto';
import { permilDoDescontoExibido, precoDoItem, totaisDoPedido, validarAcrescimoOuDesconto, itemRespeitaPrecoMinimo, mensagemAcimaDoMaximo, MSG_DESCONTO_E_ACRESCIMO } from './preco-pedido';
// ---------- vocabulário ----------
/** Níveis de alçada (RN-VEN-10); iguais aos `NivelAprovacao` do Gestor. */
export const NIVEIS_APROVACAO = ['supervisor', 'gerente', 'analista'];
/** Motivos de ir para aprovação (T-0184, P3 B: uma aprovação por motivo). `estoque` e `preco_minimo` seguem sem regra de entrada. */
export const MOTIVOS_APROVACAO = ['desconto', 'credito', 'inadimplencia', 'estoque', 'preco_minimo'];
/** Estado de cada aprovação do pedido (`vendedor.pedido_aprovacao`, T-0184 §2). */
export const ESTADOS_APROVACAO_MOTIVO = ['pendente', 'aprovada', 'rejeitada', 'devolvida', 'encerrada'];
/** Decisões do aprovador: `devolver` leva a `rejected` (o vendedor corrige), `recusar` leva a `cancelled` (final), P6 A. */
export const DECISOES_APROVADOR = ['aprovar', 'devolver', 'recusar'];
/** Rótulo curto de cada motivo (tabela do BKO, histórico do Campo, Gestão): um lugar só. */
export const ROTULO_MOTIVO_APROVACAO = { desconto: 'Desconto', credito: 'Crédito', inadimplencia: 'Inadimplente', estoque: 'Estoque', preco_minimo: 'Preço mínimo' };
const ORDEM_NIVEL = { supervisor: 0, gerente: 1, analista: 2 };
/** O maior nível entre as aprovações (o `nivel` do pedido para quem só precisa de um número, T-0184 §1). */
export function maiorNivel(niveis) {
    return niveis.reduce((m, n) => (m === null || ORDEM_NIVEL[n] > ORDEM_NIVEL[m] ? n : m), null);
}
/** RN-VEN-10, RN-VEN-12 e RN-VEN-13: o nível do pedido com as aprovações financeiras somadas à da alçada (o maior; `null` = sem aprovação). */
export function nivelComAprovacoes(nivel, aprovacoes) {
    return maiorNivel([...(nivel ? [nivel] : []), ...aprovacoes.map((a) => a.nivel)]);
}
/**
 * RN-VEN-33 e RN-VEN-30 (T-0184 §2): o que fazer com um envio cujo id o servidor já conhece. O mesmo conteúdo (hash) é idempotente;
 * conteúdo corrigido de pedido devolvido (`rejected`) é reenvio e abre o ciclo seguinte; qualquer outro conteúdo é conflito.
 * `dono_id` é quem criou o pedido (o autor, no pedido em nome).
 */
export function situacaoDoEnvio(i) {
    const e = i.existente;
    if (!e)
        return 'novo';
    if (e.dono_id !== i.eu)
        return 'id_em_uso';
    if (e.hash_envio === null || e.hash_envio === i.hash)
        return 'idempotente';
    return e.status === 'rejected' ? 'reenvio' : 'conflito';
}
/** RN-VEN-12 e RN-VEN-13 (P2 B, P5 B): quem aprova crédito e inadimplência; padrão `gerente`, também com o parâmetro ausente ou inválido. */
export function niveisDosParametros(p) {
    const nivel = (v) => (NIVEIS_APROVACAO.includes(v) ? v : 'gerente');
    return { credito: nivel(p['aprovacao.credito_nivel']), inadimplencia: nivel(p['aprovacao.inadimplencia_nivel']) };
}
/** Vocabulário do doc 03 (RN-VEN-30) usado nos eventos e pelo Gestor/Integração. */
export const STATUS_CONTRATO = [
    'rascunho', 'na_fila', 'recebido', 'em_aprovacao', 'aprovado', 'enviado_erp', 'integrado_erp',
    'faturado_parcial', 'faturado_total', 'rejeitado', 'cancelado',
];
const MAPA_STATUS = {
    draft: 'rascunho',
    queued: 'na_fila',
    received: 'recebido',
    pending_approval: 'em_aprovacao',
    approved: 'aprovado',
    sent_to_erp: 'enviado_erp',
    integrated: 'integrado_erp',
    invoiced_partial: 'faturado_parcial',
    invoiced: 'faturado_total',
    rejected: 'rejeitado',
    cancelled: 'cancelado',
};
/** RN-VEN-30: status do banco (`ORDER_STATUSES`) → vocabulário do contrato dos eventos. */
export function statusDoContrato(status) {
    return MAPA_STATUS[status];
}
/** Códigos de recusa (item do push `rejeitado` ou HTTP). */
export const CARTEIRA_FORA = 'FORA_DA_CARTEIRA';
export const MOTIVO_REJEICAO_MIN = 3;
export const MSG_MOTIVO_REJEICAO = 'RN-GES-08: informe o motivo da rejeição (mínimo 3 caracteres).';
export const DIAS_PRECO_RETROATIVO = 7;
function pct(n) {
    return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
// ---------- alçada ----------
/** RN-VEN-10: `DiscountRole`/`director` da alçada → nível de aprovação. */
export function nivelDaAlcada(aprovador) {
    return aprovador === 'supervisor' ? 'supervisor' : aprovador === 'manager' ? 'gerente' : 'analista';
}
function numero(v, padrao) {
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : padrao;
}
/**
 * Política de desconto a partir dos parâmetros do tenant (doc 03, tabela de parâmetros):
 * `alcada.vendedor_pct` (5), `alcada.supervisor_pct` (10), `alcada.gerente_pct` (15), `alcada.acima_gerente`
 * (`analista` | `bloquear`; padrão analista). Exceção por vendedor fica fora da fatia.
 */
export function politicaDosParametros(parametros) {
    return {
        seller_pct: numero(parametros['alcada.vendedor_pct'], 5),
        supervisor_pct: numero(parametros['alcada.supervisor_pct'], 10),
        manager_pct: numero(parametros['alcada.gerente_pct'], 15),
        above_manager: parametros['alcada.acima_gerente'] === 'bloquear' ? 'block' : 'director',
        exceptions: {},
    };
}
/** Texto do motivo: "Desconto de 8,0% acima da alçada de 5,0%: aguardando supervisor". */
export function textoPendencia(nivel, descontoPct, limitePct) {
    return `Desconto de ${pct(descontoPct)} acima da alçada de ${pct(limitePct)}: aguardando ${nivel}`;
}
/** RN-VEN-01 (P-4): `min(agora, max(data do aparelho, agora − 7 dias))`, em ISO UTC. Relógio do aparelho não é confiável. */
export function dataDoPreco(criadoNoAparelhoEm, agora) {
    const t = criadoNoAparelhoEm ? Date.parse(criadoNoAparelhoEm) : NaN;
    if (!Number.isFinite(t))
        return agora.toISOString();
    const piso = agora.getTime() - DIAS_PRECO_RETROATIVO * 86_400_000;
    return new Date(Math.min(agora.getTime(), Math.max(t, piso))).toISOString();
}
/**
 * T-0138: instante de emissão do pedido para metas e relatórios (evento `vendedor.pedido.criado@1` e consulta `pedidos_da_meta@1`):
 * a hora do aparelho LIMITADA (nunca depois do recebimento, no máximo `DIAS_PRECO_RETROATIVO` dias antes); sem hora do aparelho, o recebimento.
 * Aparelho com o relógio errado não joga a venda para outro mês. A consulta repete esta regra em SQL (`EMITIDO_EM_SQL`).
 */
export function emitidoEm(criadoNoAparelhoEm, recebidoEm) {
    return dataDoPreco(criadoNoAparelhoEm, new Date(recebidoEm));
}
/** RN-VEN-45: motivo do recebimento quando o prazo do pedido mudou no cadastro depois do pedido (sem citar o %). */
export const MOTIVO_PRAZO_MUDOU = 'Prazo de pagamento mudou';
/**
 * RN-VEN-12 e RN-VEN-13 (T-0184): soma as aprovações financeiras ao recebimento. Pedido que sairia aprovado vai para `pending_approval`;
 * o `nivel` do pedido é o maior entre as aprovações e o texto junta os motivos.
 */
export function comAprovacoesFinanceiras(r, extras) {
    if (extras.length === 0)
        return r;
    const aprovacoes = [...r.aprovacoes, ...extras];
    const pending_reason = aprovacoes.map((a) => a.texto).join(' · ');
    const entrada = r.historico.filter((h) => h.para !== 'approved' && h.para !== 'pending_approval');
    return {
        ...r,
        status: 'pending_approval',
        nivel: maiorNivel(aprovacoes.map((a) => a.nivel)),
        motivos: aprovacoes.map((a) => a.motivo),
        aprovacoes,
        aprovacao_automatica: false,
        pending_reason,
        historico: [...entrada, { de: 'received', para: 'pending_approval', motivo: pending_reason }],
    };
}
/**
 * RN-VEN-45 (R-20261115-124833): o % divergente aceito (cadastro mudou depois do pedido) fica FORA da alçada: o status não muda;
 * o recebimento ganha o motivo próprio `MOTIVO_PRAZO_MUDOU`, que aparece na linha do tempo do pedido.
 */
export function comAvisoDoPrazoMudou(r) {
    return { ...r, historico: r.historico.map((h) => (h.de === null && h.para === 'received' ? { ...h, motivo: MOTIVO_PRAZO_MUDOU } : h)) };
}
/** RN-VEN-10 e RN-GES-04 (P4 A): o menor nível que pode decidir o pedido do autor (um acima do dele). Sem autor gestor: `null`. */
export function nivelMinimoDoAutor(perfil) {
    const i = NIVEIS_APROVACAO.indexOf(perfil);
    return i === -1 ? null : (NIVEIS_APROVACAO[i + 1] ?? null);
}
/** RN-GES-04 (P4 A): ninguém aprova o próprio pedido; o motivo que cairia no nível do autor (ou abaixo) sobe um nível. */
export function elevarAoNivelDoAutor(aprovacoes, perfilDoAutor) {
    const minimo = nivelMinimoDoAutor(perfilDoAutor);
    if (!minimo)
        return [...aprovacoes];
    return aprovacoes.map((a) => (ORDEM_NIVEL[a.nivel] < ORDEM_NIVEL[minimo] ? { ...a, nivel: minimo } : a));
}
/** RN-GES-04 (T-0187, P4 A): ninguém aprova o próprio pedido; cada aprovação sobe ao nível mínimo do autor e o `nivel` do pedido acompanha. */
export function comNivelDoAutor(r, perfilDoAutor) {
    if (r.aprovacoes.length === 0)
        return r;
    const aprovacoes = elevarAoNivelDoAutor(r.aprovacoes, perfilDoAutor);
    return { ...r, aprovacoes, nivel: maiorNivel(aprovacoes.map((a) => a.nivel)) };
}
/**
 * Status inicial a partir da validação (P-1): dentro da alçada = `approved` na hora (automático); acima =
 * `pending_approval` com o nível. `received` só existe como passagem (histórico `null → received → …`).
 */
export function resultadoDoRecebimento(v) {
    const bloqueio = v.issues.find((i) => i.blocking);
    if (bloqueio) {
        const codigo = bloqueio.code === 'discount_blocked' ? 'RN-VEN-10' : bloqueio.code === 'price_not_found' ? 'RN-CAT-06' : 'PAYLOAD_INVALIDO';
        return { aceito: false, codigo, http: 422, mensagem: bloqueio.message };
    }
    const entrada = { de: null, para: 'received', motivo: 'Recebido pelo servidor' };
    if (v.discount.level === 'needs_approval' && v.outcome === 'pending_approval') {
        const nivel = nivelDaAlcada(v.discount.approver);
        const pending_reason = textoPendencia(nivel, Math.round((v.discount.limit_pct + v.discount.exceeded_by_pct) * 100) / 100, v.discount.limit_pct);
        return {
            aceito: true,
            status: 'pending_approval',
            nivel,
            motivos: ['desconto'],
            aprovacoes: [{ motivo: 'desconto', nivel, texto: pending_reason }],
            aprovacao_automatica: false,
            pending_reason,
            historico: [entrada, { de: 'received', para: 'pending_approval', motivo: pending_reason }],
        };
    }
    const motivo = `Dentro da alçada (${pct(v.discount.limit_pct)})`;
    return {
        aceito: true,
        status: 'approved',
        nivel: null,
        motivos: [],
        aprovacoes: [],
        aprovacao_automatica: true,
        pending_reason: '',
        historico: [entrada, { de: 'received', para: 'approved', motivo }],
    };
}
const PERFIS_QUE_CRIAM = ['vendedor'];
const pct2 = (n) => Math.round(n * 100) / 100;
/** % com 2 casas de `parte` sobre `base` (centavos); 0 se a base é 0. */
const pctDe = (parte, base) => (base > 0 ? Math.round((parte * 10_000) / base) / 100 : 0);
/**
 * Revalida o pedido recebido do aparelho (RF-VEN-01, RN-VEN-01/02/03/10/11/15/21, RN-CAT-06, RN-CORE-04, RN-PRO-01).
 * Ordem: promotor (403) → perfil → payload → carteira → preço → preço mínimo → alçada. O total do aparelho é ignorado
 * (RN-VEN-02). A alçada olha SÓ o desconto efetivo do pedido (RN-VEN-03/10). Crédito fora da fatia (`credit: null`, P-6).
 */
export function revalidarPedido(e) {
    // RN-PRO-01 e perfil sem acesso: uma checagem só (promotor 403 primeiro)
    const recusa = recusaDePerfil(e.perfil, e.em_nome === true);
    if (recusa)
        return { ok: false, ...recusa };
    const acrescimoPedido = e.acrescimo_pct ?? 0;
    const descValor = e.desconto_valor_cents ?? 0;
    const acreValor = e.acrescimo_valor_cents ?? 0;
    if (validarAcrescimoOuDesconto({ desconto_pct: e.desconto_pct, acrescimo_pct: acrescimoPedido })) {
        return { ok: false, codigo: 'desconto_e_acrescimo', http: 422, mensagem: `Pedido: ${MSG_DESCONTO_E_ACRESCIMO}` };
    }
    // T-0071 (RN-VEN-02): % e R$ juntos, ou desconto e acréscimo em R$ juntos, no pedido
    if ((descValor > 0 && acreValor > 0) || ((descValor > 0 || acreValor > 0) && (e.desconto_pct > 0 || acrescimoPedido > 0))) {
        return { ok: false, codigo: 'ajuste_invalido', http: 422, mensagem: 'Pedido: use % ou R$, e só desconto ou só acréscimo.' };
    }
    // RN-VEN-21: o mesmo produto na mesma medida soma a quantidade (mantém o desconto/acréscimo da primeira linha)
    const somados = new Map();
    for (const it of e.itens) {
        if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
            return { ok: false, codigo: 'PAYLOAD_INVALIDO', http: 422, mensagem: 'Quantidade inválida em um dos itens.' };
        }
        if (validarAcrescimoOuDesconto({ desconto_pct: it.desconto_pct ?? 0, acrescimo_pct: it.acrescimo_pct ?? 0 })) {
            return { ok: false, codigo: 'desconto_e_acrescimo', http: 422, mensagem: `Item ${it.sku}: ${MSG_DESCONTO_E_ACRESCIMO}` };
        }
        const qtdAjustes = [it.desconto_pct, it.acrescimo_pct, it.desconto_unitario_cents, it.acrescimo_unitario_cents].filter((n) => (n ?? 0) > 0).length;
        if (qtdAjustes > 1) {
            return { ok: false, codigo: 'ajuste_invalido', http: 422, mensagem: `Item ${it.sku}: use % ou R$, e só desconto ou só acréscimo.` };
        }
        const chave = `${it.product_id}|${it.unidade ?? ''}`;
        const atual = somados.get(chave);
        if (atual)
            atual.quantity += it.quantity;
        else
            somados.set(chave, { ...it });
    }
    if (somados.size === 0)
        return { ok: false, codigo: 'PAYLOAD_INVALIDO', http: 422, mensagem: 'Inclua ao menos um item no pedido.' };
    if (!e.carteira.includes(e.cliente_id)) {
        return { ok: false, codigo: CARTEIRA_FORA, http: 403, mensagem: 'Este cliente não está na sua carteira.' };
    }
    const itens = [...somados.values()];
    const semPreco = itens.filter((i) => typeof e.precos[i.product_id] !== 'number');
    if (semPreco.length > 0) {
        return { ok: false, codigo: 'RN-CAT-06', http: 422, mensagem: `Sem preço para este cliente: ${semPreco.map((i) => i.sku).join(', ')}.` };
    }
    const limite = limiteDoUsuario(e.limite);
    const paraPreco = itens.map((i) => {
        const emValor = (i.desconto_unitario_cents ?? 0) > 0 || (i.acrescimo_unitario_cents ?? 0) > 0;
        const ajuste = emValor
            ? (i.desconto_unitario_cents ?? 0) > 0
                ? { sentido: 'desconto', em: 'valor', cents: i.desconto_unitario_cents }
                : { sentido: 'acrescimo', em: 'valor', cents: i.acrescimo_unitario_cents }
            : undefined;
        return {
            preco_tabela_unidade_cents: precoBaseDoItem({
                preco_tabela_unidade_cents: e.precos[i.product_id],
                faixas: e.faixas?.[i.product_id],
                medida: medidaDaFaixa(i.unidade ?? '', i.fator ?? 1),
                fator: i.fator ?? 1,
                quantidade: i.quantity,
            }).base_unidade_cents,
            quantidade: i.quantity,
            fator: i.fator ?? 1,
            percentual_ajuste_bp: i.percentual_ajuste_bp ?? e.percentual_ajuste_bp ?? 0,
            desconto_pct: pct2(i.desconto_pct ?? 0),
            acrescimo_pct: pct2(i.acrescimo_pct ?? 0),
            ...(ajuste ? { ajuste } : {}),
            preco_minimo_base_cents: e.tipo === 'orcamento' ? null : minimoDoItem(i.preco_minimo_base_cents ?? null, limite),
        };
    });
    // R$ do desconto acima do preço de tabela da medida: ajuste_invalido (antes de calcular)
    const acimaDaTabela = itens.filter((i, idx) => (i.desconto_unitario_cents ?? 0) > precoDoItem({ ...paraPreco[idx], ajuste: null }).preco_tabela_cents);
    if (acimaDaTabela.length > 0) {
        return { ok: false, codigo: 'ajuste_invalido', http: 422, mensagem: `Desconto em R$ acima do preço de tabela: ${acimaDaTabela.map((i) => i.sku).join(', ')}.` };
    }
    const abaixo = itens.filter((_, idx) => !itemRespeitaPrecoMinimo(paraPreco[idx]));
    if (abaixo.length > 0) {
        return { ok: false, codigo: 'preco_abaixo_minimo', http: 422, mensagem: mensagemAcimaDoMaximo(abaixo.map((i) => i.sku)) };
    }
    const precosItens = paraPreco.map((p) => precoDoItem(p));
    const totalItens = precosItens.reduce((s, p) => s + p.total_cents, 0);
    if (descValor > totalItens) {
        return { ok: false, codigo: 'ajuste_invalido', http: 422, mensagem: 'Desconto em R$ do pedido acima do total dos itens.' };
    }
    const ajustePedido = descValor > 0 ? { sentido: 'desconto', em: 'valor', cents: descValor } : acreValor > 0 ? { sentido: 'acrescimo', em: 'valor', cents: acreValor } : null;
    const emValorPedido = ajustePedido !== null;
    const totais = totaisDoPedido(precosItens.map((p, idx) => ({ preco_tabela_cents: p.preco_tabela_cents, quantidade: itens[idx].quantity, total_cents: p.total_cents, desconto_pct: paraPreco[idx].desconto_pct, acrescimo_pct: paraPreco[idx].acrescimo_pct, ...(paraPreco[idx].ajuste ? { ajuste: paraPreco[idx].ajuste } : {}) })), emValorPedido ? ajustePedido : { desconto_pct: pct2(e.desconto_pct), acrescimo_pct: pct2(acrescimoPedido) });
    // RN-VEN-11a (T-0168): acima do limite do pedido não há alçada; só orçamento. Antes do validateOrder
    if (e.tipo !== 'orcamento' && pedidoAcimaDoLimite(permilDoDescontoExibido(totais), limite)) {
        return { ok: false, codigo: CODIGO_DESCONTO_PEDIDO_ACIMA_LIMITE, http: 422, mensagem: mensagemPedidoAcimaDoLimite(limite.desconto_maximo_pedido_permil) };
    }
    // RN-VEN-10: só o desconto efetivo (valor nominal exato, sem folga: `descontoEfetivoAlcadaPct`)
    const validacao = validateOrder({
        seller_id: e.vendedor_id,
        discount_pct: Math.max(0, totais.desconto_efetivo_alcada_pct),
        lines: itens.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price_cents: e.precos[i.product_id] })),
        policy: e.policy,
        credit: null,
    });
    const r0 = resultadoDoRecebimento(validacao);
    if (!r0.aceito)
        return { ok: false, codigo: r0.codigo, http: r0.http, mensagem: r0.mensagem };
    const { aceito: _aceito, ...resto0 } = r0;
    void _aceito;
    const comFinanceiro = comAprovacoesFinanceiras(resto0, aprovacoesFinanceiras({ prazo_medio_dias: e.prazo_medio_dias, total_cents: totais.total_cents, financeiro: e.financeiro, niveis: e.niveis_financeiros ?? { credito: 'gerente', inadimplencia: 'gerente' } }));
    const elevado = e.autor_perfil ? comNivelDoAutor(comFinanceiro, e.autor_perfil) : comFinanceiro;
    const resto = e.percentual_mudou ? comAvisoDoPrazoMudou(elevado) : elevado;
    return {
        ok: true,
        ...resto,
        desconto_pct: emValorPedido ? pctDe(totais.desconto_cents, totais.total_itens_cents) : pct2(e.desconto_pct),
        acrescimo_pct: emValorPedido ? pctDe(totais.acrescimo_cents, totais.total_itens_cents) : pct2(acrescimoPedido),
        desconto_valor_cents: totais.desconto_cents,
        acrescimo_valor_cents: totais.acrescimo_cents,
        ajuste_em: emValorPedido ? 'valor' : 'pct',
        desconto_efetivo_pct: totais.desconto_efetivo_pct,
        total_tabela_cents: totais.total_tabela_cents,
        total_cents: totais.total_cents,
        itens: itens.map((i, idx) => {
            const p = precosItens[idx];
            const total = totais.linhas_cents[idx];
            const emValor = paraPreco[idx].ajuste !== undefined;
            return {
                product_id: i.product_id,
                sku: i.sku,
                quantity: i.quantity,
                unidade: i.unidade ?? null,
                fator: i.fator ?? 1,
                quantidade_base: p.quantidade_base,
                preco_tabela_cents: p.preco_tabela_cents,
                // T-0071: preço final da medida DEPOIS do ajuste do item e ANTES do ajuste do pedido (o rateio fica só no total da linha)
                preco_unitario_cents: p.preco_unitario_cents,
                desconto_pct: emValor ? pctDe(Math.max(0, p.preco_tabela_cents - p.preco_unitario_cents), p.preco_tabela_cents) : paraPreco[idx].desconto_pct,
                acrescimo_pct: emValor ? pctDe(Math.max(0, p.preco_unitario_cents - p.preco_tabela_cents), p.preco_tabela_cents) : paraPreco[idx].acrescimo_pct,
                desconto_unitario_cents: Math.max(0, p.preco_tabela_cents - p.preco_unitario_cents),
                acrescimo_unitario_cents: Math.max(0, p.preco_unitario_cents - p.preco_tabela_cents),
                ajuste_em: emValor ? 'valor' : 'pct',
                total_cents: total,
                preco_minimo_cents: p.preco_minimo_cents,
                aplicacao: retratoAplicacao(i.aplicacao, true, e.aplicacao_max ?? APLICACAO_MAX_ORCAMENTO_PADRAO),
            };
        }),
    };
}
// ---------- decisão ----------
/** Matriz §2 / RN-GES-04 / P-3: supervisor e gerente decidem até a alçada; analista só acima do gerente. */
export function quemDecide(perfil, nivel) {
    if (perfil === 'supervisor')
        return { pode: nivel === 'supervisor', acima_do_nivel: false };
    if (perfil === 'gerente')
        return { pode: nivel === 'gerente' || nivel === 'supervisor', acima_do_nivel: nivel === 'supervisor' };
    if (perfil === 'analista')
        return { pode: nivel === 'analista', acima_do_nivel: false };
    return { pode: false, acima_do_nivel: false };
}
/**
 * RN-VEN-30 (T-0184, como o backfill da 0088): pedido em `pending_approval` sem linha de aprovação (veio da API antiga) vale como
 * uma aprovação de `desconto` pendente no nível do pedido. Só `decidirAprovacao` aplica a regra; a API persiste o resultado.
 */
function aprovacoesDoPedido(status, aprovacoes, nivelDoPedido) {
    if (status !== 'pending_approval' || aprovacoes.length > 0 || !nivelDoPedido)
        return aprovacoes;
    return [{ motivo: 'desconto', nivel: nivelDoPedido, estado: 'pendente' }];
}
const DESTINO_DA_DECISAO = { aprovar: 'approved', devolver: 'rejected', recusar: 'cancelled' };
const ESTADO_DA_DECISAO = { aprovar: 'aprovada', devolver: 'devolvida', recusar: 'rejeitada' };
/**
 * Decidir a aprovação do pedido (RF-VEN-09, RN-GES-04/08, RN-VEN-10 e RN-VEN-30; T-0184 P6 a P8). Ordem: perfil → repetição
 * idempotente → estado → motivo da devolução/recusa → alçada de cada aprovação. Aprovar vale para as aprovações pendentes que o perfil
 * decide (pedido `approved` quando nenhuma sobra, P7); devolver ou recusar basta uma e encerra as outras pendentes (P8).
 */
export function decidirAprovacao(e) {
    if (e.perfil === 'promotor')
        return { tipo: 'recusa', codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não decide pedidos.' };
    if (e.perfil !== 'supervisor' && e.perfil !== 'gerente' && e.perfil !== 'analista') {
        return { tipo: 'recusa', codigo: 'PERFIL_SEM_ACESSO', http: 403, mensagem: 'Seu perfil não aprova pedidos.' };
    }
    if (e.pedido && e.decisor_id && decisorEhAutor(e.pedido, e.decisor_id)) {
        return { tipo: 'recusa', codigo: 'APROVACAO_DO_PROPRIO_PEDIDO', http: 422, mensagem: MSG_APROVACAO_DO_PROPRIO_PEDIDO };
    }
    if (e.status === DESTINO_DA_DECISAO[e.decisao])
        return { tipo: 'repetida' };
    const aprovacoes = aprovacoesDoPedido(e.status, e.aprovacoes, e.nivel_do_pedido);
    const sintetizada = aprovacoes !== e.aprovacoes;
    const pendentes = aprovacoes.filter((a) => a.estado === 'pendente');
    if (e.motivo && aprovacoes.some((a) => a.motivo === e.motivo && a.estado === ESTADO_DA_DECISAO[e.decisao]))
        return { tipo: 'repetida' };
    if (e.status !== 'pending_approval' || pendentes.length === 0) {
        return { tipo: 'recusa', codigo: 'RN-VEN-30', http: 422, mensagem: 'Este pedido não está aguardando aprovação.' };
    }
    if (e.motivo && !pendentes.some((a) => a.motivo === e.motivo)) {
        return { tipo: 'recusa', codigo: 'RN-VEN-30', http: 422, mensagem: 'Esta aprovação não está pendente.' };
    }
    const texto = (e.texto ?? '').trim();
    if (e.decisao !== 'aprovar' && texto.length < MOTIVO_REJEICAO_MIN) {
        return { tipo: 'recusa', codigo: 'RN-GES-08', http: 422, mensagem: MSG_MOTIVO_REJEICAO };
    }
    const alvo = pendentes.filter((a) => !e.motivo || a.motivo === e.motivo);
    const decidiveis = alvo.filter((a) => quemDecide(e.perfil, a.nivel).pode);
    if (decidiveis.length === 0) {
        // "aprovar tudo" repetido depois de uma aprovação parcial: o perfil já decidiu o que lhe cabia (RN-VEN-33)
        if (e.decisao === 'aprovar' && !e.motivo && aprovacoes.some((a) => a.estado === 'aprovada' && quemDecide(e.perfil, a.nivel).pode))
            return { tipo: 'repetida' };
        return { tipo: 'recusa', codigo: 'RN-VEN-10', http: 422, mensagem: `Este pedido precisa de aprovação do nível ${maiorNivel(alvo.map((a) => a.nivel))}.` };
    }
    const acima = decidiveis.some((a) => quemDecide(e.perfil, a.nivel).acima_do_nivel);
    const motivoTexto = texto === '' ? null : texto;
    const decididas = new Set(decidiveis.map((a) => a.motivo));
    if (e.decisao === 'aprovar') {
        const mudancas = decidiveis.map((a) => ({ motivo: a.motivo, estado: 'aprovada' }));
        const restantes = pendentes.filter((a) => !decididas.has(a.motivo)).map((a) => a.motivo);
        return { tipo: 'ok', para: restantes.length === 0 ? 'approved' : 'pending_approval', acima_do_nivel: acima, motivo: motivoTexto, mudancas, pendentes: restantes, aprovacoes, sintetizada };
    }
    // devolver ou recusar (P8 A): as decididas viram devolvida/rejeitada e as outras pendentes são encerradas
    const mudancas = pendentes.map((a) => ({ motivo: a.motivo, estado: decididas.has(a.motivo) ? ESTADO_DA_DECISAO[e.decisao] : 'encerrada' }));
    return { tipo: 'ok', para: DESTINO_DA_DECISAO[e.decisao], acima_do_nivel: acima, motivo: motivoTexto, mudancas, pendentes: [], aprovacoes, sintetizada };
}
const textoOuNulo = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null);
/**
 * RN-VEN-17 (T-0141): o retrato do endereço gravado no pedido (jsonb) → o endereço do `aprovado@1`. O `origem` sai só quando o
 * retrato diz (linha antiga = sem origem); no editado vão `external_id: null` e `principal: false` (o retrato já os traz assim).
 */
export function enderecoParaEvento(e) {
    if (!e)
        return null;
    return {
        external_id: textoOuNulo(e.external_id),
        logradouro: String(e.logradouro ?? ''),
        numero: textoOuNulo(e.numero),
        complemento: textoOuNulo(e.complemento),
        bairro: textoOuNulo(e.bairro),
        cidade: String(e.cidade ?? ''),
        uf: String(e.uf ?? '').toUpperCase().slice(0, 2),
        cep: textoOuNulo(e.cep),
        principal: e.principal === true,
        ...(e.origem === 'erp' || e.origem === 'editado' ? { origem: e.origem } : {}),
    };
}
/**
 * Payload de `vendedor.pedido.aprovado@1` (RN-INT-08): sequência 1..n igual à do `PedidoParaErp`; desconto = tabela − final,
 * acréscimo = final − tabela (por item, na medida vendida). `preco_unitario_cents` é por unidade BASE (o Conector 1.2.x
 * grava quantidade × preço certo), igual à tabela da UN quando a venda é em UN.
 */
export function montarPedidoAprovado(e) {
    const novo = e.acrescimo_pct !== undefined || e.itens.some((i) => i.fator !== undefined || i.unidade !== undefined || i.quantidade_venda !== undefined || i.acrescimo_pct !== undefined);
    const itens = e.itens.map((i, idx) => {
        const fator = i.fator ?? 1;
        const venda = i.quantidade_venda ?? i.quantidade / fator;
        const tabelaLinha = i.preco_tabela_cents * venda;
        const base = {
            sequencia: idx + 1,
            produto_external_id: i.produto_external_id,
            quantidade: i.quantidade,
            preco_unitario_cents: fator > 1 ? Math.round(i.preco_tabela_cents / fator) : i.preco_tabela_cents,
            desconto_cents: Math.max(0, tabelaLinha - i.total_cents),
            total_cents: i.total_cents,
        };
        if (!novo)
            return base;
        return {
            ...base,
            unidade: i.unidade ?? null,
            fator,
            quantidade_venda: venda,
            preco_tabela_cents: i.preco_tabela_cents,
            ...(i.desconto_pct !== undefined ? { desconto_pct: i.desconto_pct } : {}),
            ...(i.acrescimo_pct !== undefined ? { acrescimo_pct: i.acrescimo_pct } : {}),
            acrescimo_cents: Math.max(0, i.total_cents - tabelaLinha),
            ...(i.aplicacao ? { aplicacao: i.aplicacao } : {}),
        };
    });
    const { itens: _itens, ...resto } = e;
    void _itens;
    const acrescimoTotal = itens.reduce((s, i) => s + ('acrescimo_cents' in i ? (i.acrescimo_cents ?? 0) : 0), 0);
    return {
        ...resto,
        itens,
        desconto_total_cents: itens.reduce((s, i) => s + i.desconto_cents, 0),
        ...(novo ? { acrescimo_total_cents: acrescimoTotal } : {}),
        total_cents: itens.reduce((s, i) => s + i.total_cents, 0),
    };
}
// ---------- gate de perfil e hash do envio ----------
/** RN-PRO-01 / matriz §2: quem pode criar pedido pelo aparelho. `null` = pode. A plataforma já barra o promotor; aqui é a revalidação. */
export function recusaDePerfil(perfil, emNome = false) {
    if (perfil === 'promotor')
        return { codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não cria nem altera pedido.' };
    // RN-VEN-35: em nome, o autor é supervisor/gerente (o escopo é conferido por `verificarPedidoEmNome`)
    if (emNome && (perfil === 'supervisor' || perfil === 'gerente'))
        return null;
    if (!PERFIS_QUE_CRIAM.includes(perfil)) {
        return { codigo: 'PERFIL_SEM_ACESSO', http: 403, mensagem: 'Seu perfil não cria pedidos pelo aplicativo.' };
    }
    return null;
}
/** JSON canônico (chaves ordenadas, sem `undefined`): base do `hash_envio` (RN-VEN-33). O sha256 é calculado na API. */
export function jsonCanonico(valor) {
    if (valor === null || typeof valor !== 'object')
        return JSON.stringify(valor ?? null);
    if (Array.isArray(valor))
        return `[${valor.map((v) => jsonCanonico(v === undefined ? null : v)).join(',')}]`;
    const o = valor;
    const chaves = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${chaves.map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`).join(',')}}`;
}
/** Payload do push sem o que não muda o pedido (total informativo do aparelho): dois envios do mesmo pedido dão o mesmo hash. */
export function conteudoDoEnvio(payload) {
    const { total_cents: _informativo, ...resto } = payload;
    void _informativo;
    return jsonCanonico(resto);
}
