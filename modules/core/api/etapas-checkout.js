/**
 * Verificação das etapas obrigatórias de outros módulos no `visita_checkout` (RN-CORE-12, T-0039).
 * Cada módulo com etapa obrigatória oferece `<modulo>.etapas_checkout@1` (schemas em `contracts/etapas-checkout.ts`);
 * a definição entra em `CONSULTAS_ETAPAS_CHECKOUT` (e em `usaConsultasOpcionais` do manifesto) quando o dono publicar.
 * Hoje só a Pesquisa publicou. Etapa obrigatória não concluída vira PENDÊNCIA, não recusa (tolerância, T-0039 §2).
 */
import { ConsultaIndisponivel } from '@macuxi/platform-sdk';
import { EtapasCheckoutSaidaSchema } from '../contracts';
import { CONSULTA_ETAPAS_CHECKOUT_PESQUISA } from '../../pesquisa/contracts';
export const CONSULTAS_ETAPAS_CHECKOUT = [CONSULTA_ETAPAS_CHECKOUT_PESQUISA];
/** Evento de outro módulo que pode cumprir uma etapa pendente → módulo dono da consulta (baixa por evento, T-0039 §2.3). */
export const MODULO_DO_EVENTO_DE_BAIXA = { 'pesquisa.resposta.registrada@1': 'pesquisa' };
/** Chama as consultas dos módulos ativos; `ConsultaIndisponivel` (módulo desligado ou ausente) = sem etapas daquele módulo. */
export const verificadorPorConsulta = (tx, consultas = CONSULTAS_ETAPAS_CHECKOUT) => async (entrada) => {
    if (consultas.length === 0 || typeof tx?.consultar !== 'function')
        return [];
    const saida = [];
    for (const def of consultas) {
        try {
            const r = EtapasCheckoutSaidaSchema.parse(await tx.consultar(def, entrada));
            for (const e of r.etapas)
                saida.push({ modulo: def.modulo, etapa: e.etapa, rotulo: e.rotulo, obrigatoria: e.obrigatoria, concluida: e.concluida });
        }
        catch (e) {
            if (!(e instanceof ConsultaIndisponivel))
                throw e;
        }
    }
    return saida;
};
