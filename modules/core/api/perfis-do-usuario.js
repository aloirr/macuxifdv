/**
 * Perfis de acesso de um usuário no login (RN-CORE-01/35; ADR 0033): lê `plataforma.perfis_do_usuario` (0041) na transação do tenant e
 * resolve com o motor do SDK. Um perfil por usuário (RN-CORE-54): perfil de base vendedor/promotor/supervisor fecha o BKO.
 * Sem nenhuma linha (usuário antigo, banco sem a 0041 semeada) cai no perfil de fábrica do principal: falha fechada para o que a fábrica fecha.
 * As chaves `acesso.*` são só da plataforma, então a matriz sem manifestos basta numa rota pública.
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
export async function perfisDoUsuarioNoLogin(db, usuarioId, principal) {
    const r = await db.query('select codigo, base, fabrica, sobreposicoes from plataforma.perfis_do_usuario($1)', [usuarioId]);
    const linhas = r.rows.filter((l) => PERFIS.includes(l.base));
    if (linhas.length === 0)
        return perfisDeFabrica(principal);
    return linhas.map((l) => resolverPerfil({ codigo: l.codigo, base: l.base, ativo: true, fabrica: l.fabrica, sobreposicoes: sobreposicoesDe(l.sobreposicoes) }, MATRIZ));
}
