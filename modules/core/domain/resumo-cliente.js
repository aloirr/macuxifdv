/**
 * Resumo do Cliente 360 v2 (T-0186; spec §3): bloco Performance (curvas, indicadores de compra e visitas).
 * Funções puras; as mesmas na API e no aparelho. Sem alerta financeiro na ficha (R-20261119-0440).
 */
import { compraMediaMesCents, resumoCompras, resumoSemCompras } from './cliente360';
const ROTULOS = { faturamento: 'Curva Faturamento', frequencia: 'Curva Frequência', volume: 'Curva Volume' };
const ORDEM = ['faturamento', 'frequencia', 'volume'];
/** R-20261119-0530: o rótulo da linha da curva na tabela rótulo-valor do bloco Performance. */
export const rotuloCurva = (d) => ROTULOS[d];
/**
 * Bloco Performance. `comAcessoACompras` falso (promotor sem `promotor_ve_pedidos`, RN-PRO-01/P12) tira as curvas e os indicadores
 * de compra; as visitas ficam. "Última compra" não existe mais aqui (R-20261119-0440).
 */
export function performanceDoCliente(e) {
    let compras = null;
    if (e.comAcessoACompras) {
        const r = resumoCompras([...e.historico], e.hoje);
        compras = { compra_media_mes_cents: compraMediaMesCents([...e.historico], e.hoje), ticket_medio_cents: r.ticket_medio_cents, frequencia_media_dias: r.frequencia_media_dias, sem_compras: resumoSemCompras(r) };
    }
    const curvas = e.comAcessoACompras
        ? [...e.curvas].sort((a, b) => ORDEM.indexOf(a.dimensao) - ORDEM.indexOf(b.dimensao)).map((c) => ({ dimensao: c.dimensao, curva: c.curva, rotulo: rotuloCurva(c.dimensao) }))
        : [];
    return { curvas, compras, visitas_total: e.visitas.total, ultima_visita_em: e.visitas.ultima_data, ultima_visita_por: e.visitadaPor };
}
