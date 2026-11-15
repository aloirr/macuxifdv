/**
 * Parâmetros dos alertas de produtividade (T-0180, D4/D6; RF-CORE-17, RN-CORE-26, RN-CORE-44): parâmetro `alertas.produtividade`
 * (JSON em `plataforma.parametro`, modulo `core`, um por tenant). `GET|PUT /v1/core/parametros/alertas-produtividade`
 * (ação `parametro.alertas_produtividade`, auditado, idempotente). O pull `parametro` leva o valor ao Campo e ao Gestão; o Campo agenda
 * os lembretes locais com ele. O limite do "parado" NÃO mora aqui: é `inicio.parado_min` (um valor num lugar só), gravado por
 * `PUT /v1/core/parametros/parado-min` (`CAMINHO_PARAMETRO_PARADO_MIN`). Horários ("10:00", "16:00") são minutos do dia no fuso do tenant.
 */
import { z } from 'zod';
export const PARAMETRO_ALERTAS_PRODUTIVIDADE = 'alertas.produtividade';
/** Caminho (sem `/v1/core/`) das rotas dos parâmetros dos alertas de produtividade. */
export const CAMINHO_PARAMETROS_ALERTAS_PRODUTIVIDADE = 'parametros/alertas-produtividade';
/** O "parado" (`inicio.parado_min`, RN-CORE-26): `GET|PUT /v1/core/parametros/parado-min` com `{ parado_min }` (padrão 60), ação `parametro.alertas_produtividade`. */
export const CAMINHO_PARAMETRO_PARADO_MIN = 'parametros/parado-min';
export const CHAVES_REGRA_PRODUTIVIDADE = [
    'fim_almoco',
    'parado_entre_visitas',
    'sem_checkin_inicio',
    'rota_incompleta',
    'visita_aberta',
    'envio_pendente',
];
/** Nome de cada regra, igual ao da spec e ao do Gestor (uma cópia só: o Gestor importa daqui). */
export const NOME_REGRA_PRODUTIVIDADE = {
    fim_almoco: 'Fim do almoço',
    parado_entre_visitas: 'Parado entre visitas',
    sem_checkin_inicio: 'Sem check-in no início do dia',
    rota_incompleta: 'Rota do dia incompleta',
    visita_aberta: 'Visita aberta',
    envio_pendente: 'Envio pendente',
};
/** Horário comercial do Campo e do Gestão (minutos do dia, 08:00 às 18:00): o lembrete só sai dentro dele. Uma definição só (RD-0338). */
export const HORARIO_COMERCIAL_PADRAO = { inicio_min: 8 * 60, fim_min: 18 * 60 };
const Minuto = z.number().int().min(0).max(1439);
/** Faixas aceitas (a tela e a API leem daqui). */
export const FAIXAS_ALERTAS_PRODUTIVIDADE = {
    antecedencia_min: { min: 5, max: 30 },
    gestor_depois_min: { min: 5, max: 240 },
    visita_aberta_min: { min: 30, max: 480 },
    envio_pendente_h: { min: 1, max: 48 },
    teto_lembretes_dia: { min: 1, max: 10 },
};
const Faixa = (f) => z.number().int().min(f.min).max(f.max);
export const ParametrosAlertasProdutividadeSchema = z
    .object({
    fim_almoco: z.object({ ativa: z.boolean(), antecedencia_min: Faixa(FAIXAS_ALERTAS_PRODUTIVIDADE.antecedencia_min), vendedor: z.boolean() }).strict(),
    parado_entre_visitas: z
        .object({ ativa: z.boolean(), vendedor: z.boolean(), gestor: z.boolean(), gestor_depois_min: Faixa(FAIXAS_ALERTAS_PRODUTIVIDADE.gestor_depois_min) })
        .strict(),
    sem_checkin_inicio: z.object({ ativa: z.boolean(), ate_min: Minuto, vendedor: z.boolean(), gestor: z.boolean() }).strict(),
    rota_incompleta: z.object({ ativa: z.boolean(), as_min: Minuto, vendedor: z.boolean() }).strict(),
    visita_aberta: z.object({ ativa: z.boolean(), apos_min: Faixa(FAIXAS_ALERTAS_PRODUTIVIDADE.visita_aberta_min), vendedor: z.boolean() }).strict(),
    envio_pendente: z.object({ ativa: z.boolean(), apos_h: Faixa(FAIXAS_ALERTAS_PRODUTIVIDADE.envio_pendente_h), vendedor: z.boolean() }).strict(),
    teto_lembretes_dia: Faixa(FAIXAS_ALERTAS_PRODUTIVIDADE.teto_lembretes_dia),
})
    .strict();
/** Padrões D6 (T-0180): valem enquanto o tenant não salvou. */
export const PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO = {
    fim_almoco: { ativa: true, antecedencia_min: 10, vendedor: true },
    parado_entre_visitas: { ativa: true, vendedor: true, gestor: true, gestor_depois_min: 30 },
    sem_checkin_inicio: { ativa: true, ate_min: 10 * 60, vendedor: true, gestor: true },
    rota_incompleta: { ativa: true, as_min: 16 * 60, vendedor: true },
    visita_aberta: { ativa: true, apos_min: 120, vendedor: true },
    envio_pendente: { ativa: true, apos_h: 4, vendedor: true },
    teto_lembretes_dia: 4,
};
/** Corpo de `PUT /core/parametros/parado-min` (a faixa 15..480 é `paradoMinValido`, RN-CORE-26). */
export const ParametroParadoMinSchema = z.object({ parado_min: z.number() }).strict();
export const ErroParametroAlertasSchema = z.object({ campo: z.string().min(1), mensagem: z.string().min(1) }).strict();
