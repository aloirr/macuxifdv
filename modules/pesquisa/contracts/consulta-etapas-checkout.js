/**
 * Consulta que a Pesquisa oferece ao Core (ADR 0012; T-0039): `pesquisa.etapas_checkout@1`. Padrão do Core
 * (`modules/core/contracts/etapas-checkout.ts`): o Core chama no `visita_checkout` e não confia nas etapas que o aparelho informa.
 * Uma única etapa agregada, `pesquisa.obrigatoria` (a mesma do item `pesquisa-obrigatoria` do slot no app), que cobre todas as
 * pesquisas obrigatórias aplicáveis à visita (RN-PES-03).
 */
import { definirConsulta } from '@macuxi/platform-sdk';
import { EtapasCheckoutEntradaSchema, EtapasCheckoutSaidaSchema } from '@macuxi/core/contracts';
export const ETAPA_PESQUISA_OBRIGATORIA = 'pesquisa.obrigatoria';
export const CONSULTA_ETAPAS_CHECKOUT_PESQUISA = definirConsulta({
    nome: 'pesquisa.etapas_checkout@1',
    entrada: EtapasCheckoutEntradaSchema,
    saida: EtapasCheckoutSaidaSchema,
});
