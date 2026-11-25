/**
 * Triagem do ponto do trajeto que chega no push (T-0156; desenho `tracking.md` §5.2). RN-CORE-13: a API revalida o portão
 * (`podeRastrear`) para cada ponto e descarta, sem gravar, o que está fora dele. Função pura; sem coordenada em mensagem.
 */
import { PARAMETRO_RASTREAMENTO, PARAMETROS_RASTREAMENTO_PADRAO, ParametrosRastreamentoSchema, TRAJETO_DIAS_MAX } from '../contracts';
import { PARAMETRO_FERIADOS } from '../contracts/inicio-parametros';
import { APP_RASTREADO_DO_CARGO, podeRastrear } from './rastreamento';
/** Tolerância do relógio do aparelho para o futuro (§5.2). */
export const FUTURO_MAX_MIN = 5;
/** `null` = o ponto passa; senão o motivo do descarte. `agora` = relógio do servidor (ISO UTC). */
export function triarPontoRecebido(p, agora, base) {
    const ms = Date.parse(p.capturado_em);
    const agoraMs = Date.parse(agora);
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180 || !Number.isFinite(ms))
        return 'coordenada';
    if (ms > agoraMs + FUTURO_MAX_MIN * 60_000)
        return 'futuro';
    if (ms < agoraMs - TRAJETO_DIAS_MAX * 86_400_000)
        return 'antigo';
    const r = podeRastrear({ ...base, app: base.app ?? APP_RASTREADO_DO_CARGO[base.cargo] ?? 'campo', instante: p.capturado_em });
    return r.pode ? null : r.motivo;
}
/** `rastreamento` do tenant; ausente ou inválido = padrão de fábrica (DESLIGADO). */
export function parametrosRastreamentoDasLinhas(linhas) {
    const v = linhas.find((l) => l.modulo === 'core' && l.chave === PARAMETRO_RASTREAMENTO && !l.deleted_at)?.valor;
    const r = ParametrosRastreamentoSchema.safeParse(v);
    return r.success ? r.data : PARAMETROS_RASTREAMENTO_PADRAO;
}
/** Feriados cadastrados do tenant (`metas.feriados`): só datas AAAA-MM-DD; os nacionais o portão acrescenta sozinho. */
export function feriadosDasLinhas(linhas) {
    const f = linhas.find((l) => l.modulo === 'core' && l.chave === PARAMETRO_FERIADOS && !l.deleted_at)?.valor;
    return Array.isArray(f) ? f.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
}
