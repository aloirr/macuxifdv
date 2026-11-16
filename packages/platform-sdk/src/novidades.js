/**
 * Novidades da sincronização (RN-CORE-23, T-0065; ADR 0018): `GET /v1/sync/novidades?desde=<cursor>`.
 *
 * Consulta barata que diz ao aparelho QUAIS entidades mudaram para o usuário desde o último cursor (escopo de
 * carteira/equipe e módulos efetivos já considerados) e se os módulos efetivos mudaram. O motor puxa só essas
 * entidades (`motor.sincronizarNovidades()`): sem mudança, a atualização automática custa 1 requisição.
 *
 * Cursor opaco para o aparelho (só o servidor lê): `n1|<horizonte ISO>|<versao_licencas>|<versao_escopo ou ->`.
 * - horizonte: o mesmo horizonte seguro do pull (ADR 0006); a próxima consulta olha linhas com `updated_at >= ele`;
 * - versao_licencas: a de `GET /v1/me/modulos`; mudou = `modulos_mudaram` + todas as entidades (módulo novo traz
 *   linhas antigas, que só o pull completo da entidade vê);
 * - versao_escopo: hash da carteira e da equipe visíveis (ADR 0009 §4); mudou = todas as entidades (o pull de cada
 *   uma decide a ressincronização pela própria `versao_escopo`).
 * Cursor ausente, de outra versão ou ilegível = todas as entidades (nunca 400: o app antigo segue funcionando).
 */
import { z } from 'zod';
import { MODULOS } from './nomes';
export const ROTA_SYNC_NOVIDADES = '/v1/sync/novidades';
/**
 * Parâmetro do tenant `core.sync_auto_min` (RN-CORE-23): intervalo da atualização automática leve, em minutos.
 * A API o devolve sempre em `/v1/me/modulos` (padrão 30, mínimo 15); o app usa `intervaloSyncAutoMs` (@macuxi/ui).
 */
export const PARAMETRO_SYNC_AUTO_MIN = 'sync_auto_min';
export const SYNC_AUTO_MIN_PADRAO = 30;
export const SYNC_AUTO_MIN_MINIMO = 15;
/** Teto (1 dia), o mesmo do app: valores maiores não têm uso e estouram o temporizador do JavaScript. */
export const SYNC_AUTO_MIN_MAXIMO = 24 * 60;
/** Valor efetivo em minutos: inválido, ausente, 0 ou negativo → 30; abaixo de 15 → 15; acima de 1440 → 1440. */
export function syncAutoMinEfetivo(valor) {
    const n = typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : NaN;
    if (!Number.isFinite(n) || n <= 0)
        return SYNC_AUTO_MIN_PADRAO;
    return Math.round(Math.min(SYNC_AUTO_MIN_MAXIMO, Math.max(SYNC_AUTO_MIN_MINIMO, n)));
}
/** Prefixo da versão do cursor; trocar o formato = novo prefixo (o cursor antigo vira "todas as entidades"). */
const VERSAO_CURSOR = 'n1';
const SEP = '|';
const SEM_ESCOPO = '-';
export function codificarCursorNovidades(c) {
    return [VERSAO_CURSOR, c.horizonte, c.licencas, c.escopo ?? SEM_ESCOPO].join(SEP);
}
/** `null` = ausente, de outra versão ou ilegível (o servidor trata como "todas as entidades"). */
export function decodificarCursorNovidades(s) {
    if (!s)
        return null;
    const partes = s.split(SEP);
    if (partes.length !== 4 || partes[0] !== VERSAO_CURSOR)
        return null;
    const [, horizonte, licencas, escopo] = partes;
    if (Number.isNaN(Date.parse(horizonte)) || !licencas || !escopo)
        return null;
    return { horizonte, licencas, escopo: escopo === SEM_ESCOPO ? null : escopo };
}
/** Menor UUID: a consulta de novidades pede ao provedor as linhas com `(updated_at, id) > (horizonte, NIL)`. */
export const UUID_NIL = '00000000-0000-0000-0000-000000000000';
export const NovidadesQuerySchema = z.object({ desde: z.string().max(200).optional() });
/**
 * Módulos efetivos na mesma forma de `GET /v1/me/modulos` (contrato estrito em `@macuxi/core/contracts`,
 * `MeusModulosRespostaSchema`); aqui só o que o motor usa, tolerante a campos novos.
 */
export const ModulosNovidadesSchema = z
    .object({
    modulos: z.array(z.object({ id: z.enum(MODULOS), parametros: z.record(z.unknown()).default({}) }).passthrough()),
    versao_licencas: z.string().min(1),
})
    .passthrough();
export const NovidadesRespostaSchema = z.object({
    /** Entidades (nomes de sync) com mudança para o usuário desde o cursor, só de módulos efetivos e com provedor. */
    entidades: z.array(z.string()),
    /** Cursor da próxima consulta. O aparelho só o grava depois de puxar todas as `entidades` com sucesso. */
    cursor: z.string().min(1),
    /** Horizonte seguro usado (ISO UTC). */
    horizonte: z.string(),
    /** Os módulos efetivos (licença/perfil/exceção ou parâmetros) mudaram desde o cursor; sem cursor = `true`. */
    modulos_mudaram: z.boolean(),
    /** Presente quando `modulos_mudaram`: a resposta de `/v1/me/modulos`, para o aparelho aplicar sem outra requisição. */
    modulos: ModulosNovidadesSchema.optional(),
    /** Geração da base do tenant (ADR 0021), a mesma do pull. Aditivo: servidor sem a coluna não manda. */
    geracao_base: z.string().min(1).max(100).optional(),
});
