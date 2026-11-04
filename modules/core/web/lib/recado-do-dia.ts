/**
 * Lógica pura do "recado do dia" no BKO de Recados (RN-CORE-26; T-0073 §3.3). A marcação é por ENVIO (todas as linhas do mesmo
 * `envio_id`) e vale só no dia civil gravado, no fuso do tenant; o servidor decide o dia, o BKO só compara com "hoje".
 */
import type { RecadoEnviado } from '../../contracts';
import { hojeNoFuso } from './hoje';

/** Ação que libera o botão e o chip (supervisor e gerente; a API revalida e responde 403 sem ela). */
export const ACAO_RECADO_DO_DIA = 'notificacao.recado_do_dia';

export interface EnvioDeRecado {
  envio_id: string;
  titulo: string;
  enviada_em: string;
  destinatarios: number;
  lidas: number;
  /** Algum destinatário do envio tem a marcação de hoje. */
  recado_do_dia_hoje: boolean;
}

/** "É recado do dia hoje": a marcação gravada é a data de hoje no fuso do tenant (ontem ou amanhã não valem). */
export function ehRecadoDoDiaHoje(recadoDoDia: string | null | undefined, agora: Date, fuso: string): boolean {
  return Boolean(recadoDoDia) && recadoDoDia === hojeNoFuso(agora, fuso);
}

/** Só quem tem a ação vê marcar/tirar, e só em envio com `envio_id` (recado antigo sem envio não dá para marcar). */
export function podeMarcarRecadoDoDia(temAcao: boolean, envio: Pick<EnvioDeRecado, 'envio_id'> | null): boolean {
  return temAcao && Boolean(envio?.envio_id);
}

/** Junta as linhas por destinatário em um item por envio (linhas sem `envio_id` ficam de fora: não dá para marcá-las). Mais novo primeiro. */
export function agruparPorEnvio(itens: readonly RecadoEnviado[], agora: Date, fuso: string): EnvioDeRecado[] {
  const mapa = new Map<string, EnvioDeRecado>();
  for (const i of itens) {
    if (!i.envio_id) continue;
    const e = mapa.get(i.envio_id) ?? { envio_id: i.envio_id, titulo: i.titulo, enviada_em: i.enviada_em, destinatarios: 0, lidas: 0, recado_do_dia_hoje: false };
    e.destinatarios += 1;
    if (i.lida_em) e.lidas += 1;
    if (ehRecadoDoDiaHoje(i.recado_do_dia, agora, fuso)) e.recado_do_dia_hoje = true;
    if (i.enviada_em > e.enviada_em) e.enviada_em = i.enviada_em;
    mapa.set(i.envio_id, e);
  }
  return [...mapa.values()].sort((a, b) => (a.enviada_em < b.enviada_em ? 1 : a.enviada_em > b.enviada_em ? -1 : a.envio_id.localeCompare(b.envio_id)));
}

/** Texto claro para o erro de marcar: a frase da API no 422 RN-CORE-26 (recado com mais de 30 dias); senão `padrao` (o `errorMessage` da plataforma). */
export function mensagemDoRecadoDoDia(erro: unknown, padrao: string): string {
  const e = erro as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (e?.status === 422 && e.code === 'RN-CORE-26') {
    return typeof e.message === 'string' && e.message.trim() ? e.message : 'Este recado é antigo demais para virar recado do dia. Envie um recado novo.';
  }
  if (e?.status === 404) return 'Este recado não está mais na sua equipe. Atualize a página.';
  return padrao;
}
