/**
 * Relatórios do BKO de trade (RF-PRO-12, T-0056): share × meta por loja/categoria e ruptura do mix por loja.
 * Funções puras sobre as coletas já aceitas; a API só busca as linhas e chama estas funções.
 * RN-PRO-07: só entram coletas de visitas que contam (permanência mínima); visitas curtas e abertas ficam fora.
 */
import { visitaConta } from './permanencia';
import { PARAMETROS_PADRAO } from './parametros';
import { resumirRuptura, type ResumoRuptura, type StatusPresenca } from './ruptura';
import { atingimentoShare, mediaShare, type MediaShare, type SituacaoShare } from './share';

/** RN-PRO-07: ids das visitas de loja com permanência mínima (encerradas). */
export function visitasQueContam(visitas: readonly { id: string; permanencia_min: number | null }[], minimo_min: number = PARAMETROS_PADRAO.permanencia_min_min): Set<string> {
  return new Set(visitas.filter((v) => visitaConta(v.permanencia_min, minimo_min)).map((v) => v.id));
}

export interface MedicaoParaRelatorio {
  cliente_id: string;
  categoria_gondola_id: string;
  visita_loja_id: string;
  share_pct: number | null;
  meta_pct: number | null;
  medido_em: string;
}

export interface LinhaShareMeta {
  cliente_id: string;
  categoria_gondola_id: string;
  share_pct: number | null;
  meta_pct: number | null;
  atingimento_pct: number | null;
  desvio_pp: number | null;
  situacao: SituacaoShare;
  medido_em: string;
}

export interface RelatorioShareMeta {
  linhas: LinhaShareMeta[];
  resumo: MediaShare;
}

/**
 * RN-PRO-03: por loja e categoria vale a ÚLTIMA medição de visita que conta; atingimento e desvio recalculados aqui
 * (`atingimentoShare`). Resumo (RF-PRO-12) = `mediaShare` das linhas. Ordem: loja, depois categoria.
 */
export function relatorioShareMeta(medicoes: readonly MedicaoParaRelatorio[], validas: ReadonlySet<string>): RelatorioShareMeta {
  const ultima = new Map<string, MedicaoParaRelatorio>();
  for (const m of medicoes) {
    if (!validas.has(m.visita_loja_id)) continue;
    const chave = `${m.cliente_id}|${m.categoria_gondola_id}`;
    const atual = ultima.get(chave);
    if (!atual || Date.parse(m.medido_em) > Date.parse(atual.medido_em)) ultima.set(chave, m);
  }
  const linhas = [...ultima.values()]
    .sort((a, b) => a.cliente_id.localeCompare(b.cliente_id) || a.categoria_gondola_id.localeCompare(b.categoria_gondola_id))
    .map((m): LinhaShareMeta => {
      const a = atingimentoShare(m.share_pct, m.meta_pct);
      return {
        cliente_id: m.cliente_id,
        categoria_gondola_id: m.categoria_gondola_id,
        share_pct: m.share_pct,
        meta_pct: a.meta_pct,
        atingimento_pct: a.atingimento_pct,
        desvio_pp: a.desvio_pp,
        situacao: a.situacao,
        medido_em: m.medido_em,
      };
    });
  return { linhas, resumo: mediaShare(linhas) };
}

export interface LinhaRupturaLoja extends ResumoRuptura {
  cliente_id: string;
  visita_loja_id: string;
  checkin_em: string;
}

/**
 * RN-PRO-05: ruptura do mix na ÚLTIMA visita que conta de cada loja (com ao menos um item conferido), com a falha de
 * reposição à parte (`resumirRuptura`). Ordem: maior % de ruptura primeiro.
 */
export function relatorioRupturaPorLoja(
  itens: readonly { visita_loja_id: string; status: StatusPresenca; quantidade_reposta: number }[],
  visitas: readonly { id: string; cliente_id: string; checkin_em: string }[],
  validas: ReadonlySet<string>,
): LinhaRupturaLoja[] {
  const porVisita = new Map<string, { status: StatusPresenca; quantidade_reposta: number }[]>();
  for (const i of itens) {
    if (!validas.has(i.visita_loja_id)) continue;
    const l = porVisita.get(i.visita_loja_id) ?? [];
    l.push(i);
    porVisita.set(i.visita_loja_id, l);
  }
  const ultimaDaLoja = new Map<string, { id: string; cliente_id: string; checkin_em: string }>();
  for (const v of visitas) {
    if (!porVisita.has(v.id)) continue;
    const atual = ultimaDaLoja.get(v.cliente_id);
    if (!atual || Date.parse(v.checkin_em) > Date.parse(atual.checkin_em)) ultimaDaLoja.set(v.cliente_id, v);
  }
  return [...ultimaDaLoja.values()]
    .map((v) => ({ cliente_id: v.cliente_id, visita_loja_id: v.id, checkin_em: v.checkin_em, ...resumirRuptura(porVisita.get(v.id)!) }))
    .sort((a, b) => (b.ruptura_pct ?? -1) - (a.ruptura_pct ?? -1) || a.cliente_id.localeCompare(b.cliente_id));
}
