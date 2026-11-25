/**
 * Perfis de acesso de um usuário no login (RN-CORE-01/35; ADR 0033): lê `plataforma.perfis_do_usuario` (0041) na transação do tenant e
 * resolve com o motor do SDK. Um perfil por usuário (RN-CORE-54): perfil de base vendedor/promotor/supervisor fecha o BKO.
 * Sem nenhuma linha (usuário antigo, banco sem a 0041 semeada) cai em `perfisDeFabrica` (domain/matriz.ts).
 * As chaves `acesso.*` são só da plataforma, então a matriz sem manifestos basta para as linhas numa rota pública.
 */
import { matrizDeFabrica, PERFIS, resolverPerfil, NIVEIS_ALCADA, NIVEIS_ESCOPO } from '@macuxi/platform-sdk';
import { perfisDeFabrica } from '../domain';
const MATRIZ = matrizDeFabrica([]);
const ehNivel = (n) => typeof n === 'string' && [...NIVEIS_ESCOPO, ...NIVEIS_ALCADA].includes(n);
function sobreposicoesDe(bruto) {
    if (!Array.isArray(bruto))
        return [];
    const saida = [];
    for (const i of bruto) {
        if (typeof i?.chave !== 'string' || typeof i.concedida !== 'boolean')
            continue;
        const alvos = Array.isArray(i.alvos) ? i.alvos.filter((a) => typeof a === 'string') : null;
        saida.push({ chave: i.chave, concedida: i.concedida, nivel: ehNivel(i.nivel) ? i.nivel : null, alvos });
    }
    return saida;
}
/** Mesma resolução do login e da API. `matriz` = a de fábrica COMPLETA (ações dos módulos) quando quem chama a tem; sem ela, as linhas usam só a da plataforma. */
export function resolverLinhasDePerfil(linhas, principal, matriz) {
    const validas = linhas.filter((l) => PERFIS.includes(l.base));
    if (validas.length === 0)
        return perfisDeFabrica(principal, matriz);
    return validas.map((l) => resolverPerfil({ codigo: l.codigo, base: l.base, ativo: true, fabrica: l.fabrica, sobreposicoes: sobreposicoesDe(l.sobreposicoes) }, matriz ?? MATRIZ));
}
export async function perfisEfetivosDoUsuario(db, usuarioId, principal, matriz) {
    const r = await db.query('select codigo, base, fabrica, sobreposicoes from plataforma.perfis_do_usuario($1)', [usuarioId]);
    return resolverLinhasDePerfil(r.rows, principal, matriz);
}
export const perfisDoUsuarioNoLogin = (db, usuarioId, principal) => perfisEfetivosDoUsuario(db, usuarioId, principal);
