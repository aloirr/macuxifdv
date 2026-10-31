/**
 * Reconciliação diária por entidade (RN-INT-07): compara contagem de ativos e soma de controle
 * (centavos ou quantidades) informadas pelo ERP com as do Macuxi. Acima da tolerância = divergente
 * (gera `integracao.reconciliacao.divergente@1` e alerta no monitor).
 */
import { CAMPO_SOMA_CONTROLE, type Entidade } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';

export interface LadoReconciliacao {
  contagem: number;
  soma: number | null;
}

export interface TolerasReconciliacao {
  toleranciaContagem?: number;
  toleranciaSomaPct?: number;
}

export interface OpcoesReconciliacao extends TolerasReconciliacao {
  porEntidade?: Partial<Record<Entidade, TolerasReconciliacao>>;
}

export type MotivoDivergencia = 'contagem_divergente' | 'soma_divergente' | 'soma_ausente';

export interface ResultadoReconciliacao {
  entidade: Entidade;
  divergente: boolean;
  contagem: { erp: number; macuxi: number; diferenca: number; dentro: boolean };
  /** `null` quando a entidade só tem contagem. `diferenca_pct` é `null` quando a base (ERP) é zero e há diferença. */
  soma: { erp: number | null; macuxi: number | null; diferenca: number; diferenca_pct: number | null; dentro: boolean } | null;
  motivos: MotivoDivergencia[];
}

const EPS = 1e-9;

export function reconciliar(
  entrada: { entidade: Entidade; erp: LadoReconciliacao; macuxi: LadoReconciliacao },
  opcoes: OpcoesReconciliacao = {},
): ResultadoReconciliacao {
  const esp = opcoes.porEntidade?.[entrada.entidade];
  const tolContagem = esp?.toleranciaContagem ?? opcoes.toleranciaContagem ?? PARAMETROS_PADRAO.toleranciaContagem;
  const tolSomaPct = esp?.toleranciaSomaPct ?? opcoes.toleranciaSomaPct ?? PARAMETROS_PADRAO.toleranciaSomaPct;
  const { erp, macuxi } = entrada;
  const motivos: MotivoDivergencia[] = [];

  const difContagem = macuxi.contagem - erp.contagem;
  const contagemDentro = Math.abs(difContagem) <= tolContagem;
  if (!contagemDentro) motivos.push('contagem_divergente');

  let soma: ResultadoReconciliacao['soma'] = null;
  if (CAMPO_SOMA_CONTROLE[entrada.entidade] !== null) {
    if (erp.soma === null || macuxi.soma === null) {
      motivos.push('soma_ausente');
      soma = { erp: erp.soma, macuxi: macuxi.soma, diferenca: 0, diferenca_pct: null, dentro: false };
    } else {
      const dif = macuxi.soma - erp.soma;
      // compara sem dividir: |dif| * 100 <= tolerância% * |base|
      const dentro = Math.abs(dif) * 100 <= tolSomaPct * Math.abs(erp.soma) + EPS;
      const pct = erp.soma === 0 ? (dif === 0 ? 0 : null) : (Math.abs(dif) / Math.abs(erp.soma)) * 100;
      soma = { erp: erp.soma, macuxi: macuxi.soma, diferenca: dif, diferenca_pct: pct, dentro };
      if (!dentro) motivos.push('soma_divergente');
    }
  }

  return {
    entidade: entrada.entidade,
    divergente: motivos.length > 0,
    contagem: { erp: erp.contagem, macuxi: macuxi.contagem, diferenca: difContagem, dentro: contagemDentro },
    soma,
    motivos,
  };
}
