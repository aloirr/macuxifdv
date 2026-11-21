/**
 * `core.inicio_bko@1` (T-0189; RN-CORE-64/65/66): `GET /v1/core/inicio-bko` e o parâmetro `integracao.horario_carga`
 * (`GET|PUT /v1/core/parametros/horario-carga`, ação `parametro.inicio`). O Início do BKO traz só o que é do Core (saudação, usuários com senha
 * vencida, cadastro incompleto, o "Hoje" e a configuração da carga); os dados da Integração e do Gestor a tela busca nos endpoints
 * deles, que já checam perfil, escopo e licença. Dinheiro em centavos; instantes em UTC; datas civis no fuso do tenant.
 */
import { z } from 'zod';
import { HoraHHMM } from './hora';

/** Chave do parâmetro do tenant em `plataforma.parametro` (modulo `core`): horário esperado da carga por entidade (RN-CORE-65). */
export const PARAMETRO_HORARIO_CARGA = 'integracao.horario_carga';
/** Padrão do horário esperado, no fuso do tenant, em dia útil (RN-CORE-65). */
export const HORARIO_CARGA_PADRAO = '06:00';

/** Valor efetivo: `entidades[x]` = HH:MM próprio ou `null` (sem horário, sem alerta); ausente = `padrao`. */
export const HorarioCargaSchema = z.object({ padrao: HoraHHMM, entidades: z.record(z.string(), HoraHHMM.nullable()) }).strict();
export type HorarioCarga = z.infer<typeof HorarioCargaSchema>;
/** Corpo do PUT (só o formato; a regra é do domain: `validarHorarioCarga`). */
export const HorarioCargaPutSchema = z.object({ padrao: z.string(), entidades: z.record(z.string(), z.string().nullable()) }).strict();
export type HorarioCargaPut = z.infer<typeof HorarioCargaPutSchema>;
export const CAMPOS_HORARIO_CARGA = ['padrao', 'entidades'] as const;
export const ErroHorarioCargaSchema = z.object({ campo: z.enum(CAMPOS_HORARIO_CARGA), mensagem: z.string().min(1) }).strict();
export type ErroHorarioCarga = z.infer<typeof ErroHorarioCargaSchema>;

const Inteiro = z.number().int().nonnegative();

export const InicioBkoSchema = z
  .object({
    /** Instante do cálculo e fuso do tenant; a tela formata as datas com o mesmo fuso. */
    agora: z.string(),
    fuso: z.string(),
    saudacao: z.string(),
    data_extenso: z.string(),
    /** `null` = o perfil não vê o assunto (sem a ação de ver usuários). */
    usuarios_senha_vencida: Inteiro.nullable(),
    /** Clientes ativos do escopo com cadastro incompleto (RN-CORE-66); `campo` = rótulo do campo que mais falta. */
    cadastro_incompleto: z.object({ quantidade: Inteiro, campo: z.string().nullable() }).strict(),
    /** Só com a Integração licenciada no tenant; a tela cruza com a última carga por entidade (RN-CORE-65). */
    carga: z.object({ dia_util: z.boolean(), horario: HorarioCargaSchema }).strict().nullable(),
    hoje: z
      .object({
        /** Vendas do dia em centavos; `pct` = % da meta do dia. Sem Vendedor, nulo. */
        vendas: z.object({ cents: Inteiro, pct: Inteiro.nullable() }).strict().nullable(),
        pedidos: Inteiro.nullable(),
        /** Positivação do mês: `pct` sobre os clientes ativos do escopo; `meta_pct` = meta do mês sobre a mesma base. */
        positivacao: z.object({ pct: Inteiro, meta_pct: Inteiro.nullable() }).strict().nullable(),
        visitas: z.object({ feitas: Inteiro, planejadas: Inteiro, na_rota: Inteiro }).strict(),
      })
      .strict(),
  })
  .strict();
export type InicioBko = z.infer<typeof InicioBkoSchema>;
