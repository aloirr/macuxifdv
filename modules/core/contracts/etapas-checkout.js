/**
 * Etapas obrigatórias do checkout verificadas NO SERVIDOR (RN-CORE-12, T-0039).
 *
 * Padrão para os módulos que registram `visita.etapas_checkout` com etapa obrigatória e estado no servidor
 * (Pesquisa, Promotor...): oferecer a consulta `<modulo>.etapas_checkout@1` com ESTES schemas
 * (`definirConsulta({ nome, entrada: EtapasCheckoutEntradaSchema, saida: EtapasCheckoutSaidaSchema })`), listá-la em
 * `ofereceConsultas` do próprio manifesto e pedir ao Core (recado) para incluí-la em `usaConsultasOpcionais` e em
 * `api/etapas-checkout.ts`. O Core chama cada uma no `visita_checkout` e NÃO confia nas etapas que o aparelho informa.
 * Módulo desligado no tenant/usuário (`ConsultaIndisponivel`) = sem etapa a cumprir.
 */
import { z } from 'zod';
export const EtapasCheckoutEntradaSchema = z
    .object({
    visita_id: z.string().uuid(),
    cliente_id: z.string().uuid(),
    usuario_id: z.string().uuid(),
    /** RN-CORE-14: checkout de cliente fechado (o módulo pode devolver tudo como não obrigatório, o Core dispensa). */
    cliente_fechado: z.boolean(),
})
    .strict();
export const EtapaCheckoutVerificadaSchema = z
    .object({
    /** Id da etapa no slot (`pesquisa.preco`); vira `core.visita_etapa.etapa`. */
    etapa: z.string().min(1).max(80),
    /** Texto em português para a mensagem de pendência. */
    rotulo: z.string().min(1).max(120),
    obrigatoria: z.boolean(),
    concluida: z.boolean(),
})
    .strict();
export const EtapasCheckoutSaidaSchema = z.object({ etapas: z.array(EtapaCheckoutVerificadaSchema).max(20) }).strict();
