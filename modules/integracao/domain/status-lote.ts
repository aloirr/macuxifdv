/**
 * Status do lote na tela do BKO (T-0173; RN-INT-15, RN-INT-16): 5 status para quem opera, mapeados do estado técnico do lote
 * (`EstadoLoteBko`, RN-INT-08); ações válidas por status; duração e linhas integradas; autorização do reprocessamento.
 * Funções puras: a API grava/lê, a tela só compõe o texto.
 */
import type { EstadoLote, EstadoLoteBko } from '../contracts';

/** RN-INT-15: os 5 status que a pessoa vê (Em andamento, Concluído, Concluído com avisos, Com falha, Cancelado). */
export const STATUS_LOTE = ['em_andamento', 'concluido', 'concluido_com_avisos', 'com_falha', 'cancelado'] as const;
export type StatusLote = (typeof STATUS_LOTE)[number];

export function statusDoLote(estado: EstadoLoteBko): StatusLote {
  switch (estado) {
    case 'recebido':
    case 'processando':
      return 'em_andamento';
    case 'concluido':
      return 'concluido';
    case 'concluido_com_erros':
      return 'concluido_com_avisos';
    case 'falhou':
      return 'com_falha';
    case 'cancelado':
      return 'cancelado';
  }
}

/**
 * O Conector instalado valida a resposta de `GET /integracao/v1/lotes/{id}` com `LoteResultado`, que não tem `cancelado`:
 * em `/integracao/v1` o lote cancelado no BKO sai como `falhou`. Só o contrato do BKO expõe `cancelado`.
 */
export const estadoLoteNoHubV1 = (estado: EstadoLoteBko): EstadoLote => (estado === 'cancelado' ? 'falhou' : estado);

/** Estados técnicos que formam cada status (o filtro Status da tela e da API usam isto). */
export function estadosDoStatus(status: StatusLote): EstadoLoteBko[] {
  switch (status) {
    case 'em_andamento':
      return ['recebido', 'processando'];
    case 'concluido':
      return ['concluido'];
    case 'concluido_com_avisos':
      return ['concluido_com_erros'];
    case 'com_falha':
      return ['falhou'];
    case 'cancelado':
      return ['cancelado'];
  }
}

export type AcaoLote = 'cancelar' | 'reprocessar';

/** RN-INT-15: Cancelar só em andamento. */
export const podeCancelarLote = (estado: EstadoLoteBko): boolean => statusDoLote(estado) === 'em_andamento';

/** RN-INT-15: Reprocessar só em Com falha e Concluído com avisos. */
export const podeReprocessarLote = (estado: EstadoLoteBko): boolean => {
  const s = statusDoLote(estado);
  return s === 'com_falha' || s === 'concluido_com_avisos';
};

/** RN-INT-15: ações do menu "⋯" da linha; a que não vale não aparece. Vazio = a linha não tem "⋯". */
export function acoesDoLote(estado: EstadoLoteBko): AcaoLote[] {
  return [...(podeCancelarLote(estado) ? (['cancelar'] as const) : []), ...(podeReprocessarLote(estado) ? (['reprocessar'] as const) : [])];
}

/** RN-INT-15: segundos do início à conclusão; em andamento, até agora; sem início, nulo. Nunca negativo. */
export function duracaoLoteSegundos(inicio: string | null | undefined, conclusao: string | null | undefined, agora: Date): number | null {
  if (!inicio) return null;
  const fim = conclusao ? Date.parse(conclusao) : agora.getTime();
  const seg = Math.floor((fim - Date.parse(inicio)) / 1000);
  return Number.isFinite(seg) ? Math.max(0, seg) : null;
}

/** RN-INT-15: `45 s`, `2 min 10 s`, `3 min` (segundos zerados somem), `1 h 05 min`; nulo = texto vazio (a tabela não usa travessão). */
export function formatarDuracaoLote(segundos: number | null): string {
  if (segundos === null) return '';
  const s = Math.max(0, Math.floor(segundos));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (s < 3600) return s % 60 === 0 ? `${min} min` : `${min} min ${s % 60} s`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

export interface LinhasIntegradas {
  integradas: number;
  total: number;
  comErro: boolean;
}

/** RN-INT-15: linhas integradas = recebidas menos as com erro; `comErro` diz se a tela mostra "x de y". */
export function linhasIntegradas(recebidas: number, comErro: number): LinhasIntegradas {
  return { integradas: Math.max(0, recebidas - comErro), total: recebidas, comErro: comErro > 0 };
}

export type ResultadoAutorizacaoReprocessar =
  | { ok: true; via: 'direto' | 'autorizado' }
  | { ok: false; codigo: 'autorizador_necessario' | 'autorizador_invalido' | 'autorizador_sem_permissao'; mensagem: string };

/**
 * RN-INT-16: quem tem `lote.reprocessar` reprocessa direto. Quem não tem informa outro autorizador (e a senha, conferida pelo Core);
 * o autorizador não pode ser o próprio solicitante e precisa ter `lote.reprocessar` pela permissão efetiva (`autorizadorPode`,
 * vindo do Core), nunca pelo perfil base. A senha em si nunca passa por aqui.
 */
export function autorizacaoReprocessar(p: { solicitantePode: boolean; solicitanteId: string; autorizadorId: string | null; autorizadorPode: boolean }): ResultadoAutorizacaoReprocessar {
  if (p.solicitantePode) return { ok: true, via: 'direto' };
  if (!p.autorizadorId) return { ok: false, codigo: 'autorizador_necessario', mensagem: 'Escolha quem autoriza o reprocessamento e digite a senha dessa pessoa.' };
  if (p.autorizadorId === p.solicitanteId) return { ok: false, codigo: 'autorizador_invalido', mensagem: 'Escolha outra pessoa para autorizar.' };
  if (!p.autorizadorPode) return { ok: false, codigo: 'autorizador_sem_permissao', mensagem: 'A pessoa escolhida não pode autorizar o reprocessamento. Escolha outra pessoa.' };
  return { ok: true, via: 'autorizado' };
}

/** RN-INT-16: tentativas de senha erradas por autorizador na janela. */
export const MAX_TENTATIVAS_AUTORIZACAO = 5;
export const JANELA_TENTATIVAS_AUTORIZACAO_MS = 15 * 60_000;

export function limiteTentativasAutorizacao(falhasNaJanela: number): { bloqueado: false } | { bloqueado: true; mensagem: string } {
  return falhasNaJanela >= MAX_TENTATIVAS_AUTORIZACAO ? { bloqueado: true, mensagem: 'Muitas tentativas. Tente de novo em alguns minutos.' } : { bloqueado: false };
}
