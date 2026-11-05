/**
 * Verificação das etapas obrigatórias de outros módulos no `visita_checkout` (RN-CORE-12, T-0039).
 * Cada módulo com etapa obrigatória oferece `<modulo>.etapas_checkout@1` (schemas em `contracts/etapas-checkout.ts`);
 * a definição entra em `CONSULTAS_ETAPAS_CHECKOUT` (e em `usaConsultasOpcionais` do manifesto) quando o dono publicar.
 * Hoje nenhum módulo publicou: a lista é vazia e só valem as regras do Core.
 */
import { ConsultaIndisponivel, type DefinicaoConsulta, type TransacaoTenant } from '@macuxi/platform-sdk';
import { EtapasCheckoutSaidaSchema, type EtapasCheckoutEntrada } from '../contracts';
import type { VerificacaoEtapaServidor } from '../domain';

export const CONSULTAS_ETAPAS_CHECKOUT: readonly DefinicaoConsulta[] = [];

export type VerificarEtapas = (entrada: EtapasCheckoutEntrada) => Promise<VerificacaoEtapaServidor[]>;

/** Chama as consultas dos módulos ativos; `ConsultaIndisponivel` (módulo desligado ou ausente) = sem etapas daquele módulo. */
export const verificadorPorConsulta =
  (tx: Partial<Pick<TransacaoTenant, 'consultar'>>, consultas: readonly DefinicaoConsulta[] = CONSULTAS_ETAPAS_CHECKOUT): VerificarEtapas =>
  async (entrada) => {
    if (consultas.length === 0 || typeof tx?.consultar !== 'function') return [];
    const saida: VerificacaoEtapaServidor[] = [];
    for (const def of consultas) {
      try {
        const r = EtapasCheckoutSaidaSchema.parse(await tx.consultar(def, entrada));
        for (const e of r.etapas) saida.push({ modulo: def.modulo, etapa: e.etapa, rotulo: e.rotulo, obrigatoria: e.obrigatoria, concluida: e.concluida });
      } catch (e) {
        if (!(e instanceof ConsultaIndisponivel)) throw e;
      }
    }
    return saida;
  };
