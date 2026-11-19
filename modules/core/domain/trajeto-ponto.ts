/**
 * Triagem do ponto do trajeto que chega no push (T-0156; desenho `tracking.md` §5.2). RN-CORE-13: a API revalida o portão
 * (`podeRastrear`) para cada ponto e descarta, sem gravar, o que está fora dele. Função pura; sem coordenada em mensagem.
 */
import { PARAMETRO_RASTREAMENTO, PARAMETROS_RASTREAMENTO_PADRAO, ParametrosRastreamentoSchema, TRAJETO_DIAS_MAX, type MotivoSemRastreio, type ParametrosRastreamento } from '../contracts';
import { PARAMETRO_FERIADOS } from '../contracts/inicio-parametros';
import { CARGOS_RASTREADOS, podeRastrear, type EntradaRastreio } from './rastreamento';

/** Tolerância do relógio do aparelho para o futuro (§5.2). */
export const FUTURO_MAX_MIN = 5;
export type MotivoDescarte = MotivoSemRastreio | 'cargo' | 'futuro' | 'antigo' | 'coordenada';

/** Cadastro do usuário no instante da triagem: o que o portão precisa além do ponto. */
/** `cargo` (perfil base) fica fora do `podeRastrear`: só quem é de campo manda ponto. */
export type BaseTriagem = Omit<EntradaRastreio, 'instante'> & { cargo: string };

interface PontoRecebido {
  capturado_em: string;
  latitude: number;
  longitude: number;
}

/** `null` = o ponto passa; senão o motivo do descarte. `agora` = relógio do servidor (ISO UTC). */
export function triarPontoRecebido(p: PontoRecebido, agora: string, base: BaseTriagem): MotivoDescarte | null {
  const ms = Date.parse(p.capturado_em);
  const agoraMs = Date.parse(agora);
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180 || !Number.isFinite(ms)) return 'coordenada';
  if (ms > agoraMs + FUTURO_MAX_MIN * 60_000) return 'futuro';
  if (ms < agoraMs - TRAJETO_DIAS_MAX * 86_400_000) return 'antigo';
  if (!CARGOS_RASTREADOS.includes(base.cargo)) return 'cargo';
  const { cargo: _cargo, ...cadastro } = base;
  const r = podeRastrear({ ...cadastro, instante: p.capturado_em });
  return r.pode ? null : r.motivo;
}

type Linha = Readonly<{ modulo: string; chave: string; valor?: unknown; deleted_at?: string | null }>;

/** `rastreamento` do tenant; ausente ou inválido = padrão de fábrica (DESLIGADO). */
export function parametrosRastreamentoDasLinhas(linhas: readonly Linha[]): ParametrosRastreamento {
  const v = linhas.find((l) => l.modulo === 'core' && l.chave === PARAMETRO_RASTREAMENTO && !l.deleted_at)?.valor;
  const r = ParametrosRastreamentoSchema.safeParse(v);
  return r.success ? r.data : PARAMETROS_RASTREAMENTO_PADRAO;
}

/** Feriados cadastrados do tenant (`metas.feriados`): só datas AAAA-MM-DD; os nacionais o portão acrescenta sozinho. */
export function feriadosDasLinhas(linhas: readonly Linha[]): string[] {
  const f = linhas.find((l) => l.modulo === 'core' && l.chave === PARAMETRO_FERIADOS && !l.deleted_at)?.valor;
  return Array.isArray(f) ? f.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
}
