/**
 * Status do lote na tela do BKO (T-0173; RN-INT-15, RN-INT-16): 5 status para quem opera, mapeados do estado técnico do lote
 * (`EstadoLoteBko`, RN-INT-08); ações válidas por status; linhas integradas; autorização do reprocessamento.
 * Funções puras: a API grava/lê, a tela só compõe o texto.
 */
import type { EstadoLote, EstadoLoteBko } from '../contracts';
import { transicionarLote } from './estados';

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

/** RN-INT-15: Cancelar só em andamento — a regra é a aresta `→ cancelado` de `TRANSICOES_LOTE`. */
export const podeCancelarLote = (estado: EstadoLoteBko): boolean => transicionarLote(estado, 'cancelado').ok;

/** RN-INT-15: Reprocessar só em Com falha e Concluído com avisos — a aresta `→ recebido` de `TRANSICOES_LOTE`. */
export const podeReprocessarLote = (estado: EstadoLoteBko): boolean => transicionarLote(estado, 'recebido').ok;

/** RN-INT-15: lote que falhou não aplicou nada; nos demais, recebidas menos as com erro. */
export const integradasDoLote = (estado: EstadoLoteBko, recebidas: number, comErro: number): number => (estado === 'falhou' ? 0 : Math.max(0, recebidas - comErro));

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

/** RN-INT-16: recusa da senha do autorizador (a API responde 422 com esta frase; a tela mostra a frase da API). */
export const MSG_SENHA_INCORRETA = 'Senha incorreta.';

/** RN-INT-16: tentativas de senha erradas por autorizador na janela. */
export const MAX_TENTATIVAS_AUTORIZACAO = 5;
export const JANELA_TENTATIVAS_AUTORIZACAO_MS = 15 * 60_000;

export function limiteTentativasAutorizacao(falhasNaJanela: number): { bloqueado: false } | { bloqueado: true; mensagem: string } {
  return falhasNaJanela >= MAX_TENTATIVAS_AUTORIZACAO ? { bloqueado: true, mensagem: 'Muitas tentativas. Tente de novo em alguns minutos.' } : { bloqueado: false };
}
