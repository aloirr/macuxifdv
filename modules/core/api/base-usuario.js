import { PARAMETRO_DIAS_UTEIS, PARAMETRO_FERIADOS } from '../contracts';
import { baseResolvida, calendarioDoTenant, casaDoUsuario, feriadosDasLinhas } from '../domain';
import { lerParametrosCore } from './parametro-tenant';
const COLUNAS = `id, perfil, base_tipo, casa_cep, casa_logradouro, casa_numero, casa_bairro, casa_cidade, casa_uf, casa_lat::float8 as casa_lat, casa_lng::float8 as casa_lng,
  base_cep, base_logradouro, base_numero, base_bairro, base_cidade, base_uf, base_lat::float8 as base_lat, base_lng::float8 as base_lng`;
const cru = (l, p) => ({
    cep: l[`${p}_cep`],
    logradouro: l[`${p}_logradouro`],
    numero: l[`${p}_numero`],
    bairro: l[`${p}_bairro`],
    cidade: l[`${p}_cidade`],
    uf: l[`${p}_uf`],
    lat: l[`${p}_lat`],
    lng: l[`${p}_lng`],
});
export function casaDaLinha(l) {
    return casaDoUsuario(cru(l, 'casa'));
}
export function baseDaLinha(l) {
    return baseResolvida({ base_tipo: l.base_tipo, casa: cru(l, 'casa'), base: cru(l, 'base') });
}
/** A linha de endereço do usuário vivo (RLS limita ao tenant); `null` se não existe. */
export async function lerEnderecoDoUsuario(db, usuarioId) {
    return (await db.query(`select ${COLUNAS} from core.usuario where id = $1 and deleted_at is null`, [usuarioId])).rows[0] ?? null;
}
/** RN-CORE-75: a base de cada usuário pedido (`null` = sem base). */
export async function basesDosUsuarios(db, ids) {
    if (ids.length === 0)
        return {};
    const linhas = (await db.query(`select ${COLUNAS} from core.usuario where id = any($1::uuid[]) and deleted_at is null`, [[...ids]])).rows;
    // só tipo e ponto: o endereço completo pode ser a casa (dado pessoal) e só sai em `GET usuarios/:id/base`
    return Object.fromEntries(linhas.map((l) => {
        const b = baseDaLinha(l);
        return [l.id, b ? { tipo: b.tipo, lat: b.lat, lng: b.lng } : null];
    }));
}
/** RN-CORE-76 (D3): semana útil e feriados do tenant (`metas.dias_uteis_semana`, `metas.feriados`); padrão segunda a sábado. */
export async function calendarioDoTenantNaTransacao(db) {
    const linhas = await lerParametrosCore(db, [PARAMETRO_DIAS_UTEIS, PARAMETRO_FERIADOS]);
    return { dias_uteis_semana: [...calendarioDoTenant(linhas).dias_uteis_semana], feriados: feriadosDasLinhas(linhas) };
}
