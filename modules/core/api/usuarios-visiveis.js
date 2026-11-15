/**
 * Usuários visíveis (RN-CORE-04; ADR 0009 §6): de quem o usuário vê visitas, rotas, metas e pedidos.
 * Irmão da `carteiraDoUsuario`: a decisão por perfil é do domínio (`escopoDeUsuarios`); aqui só se buscam os
 * conjuntos dentro de `comTenant` (RLS, RN-CORE-05).
 * - vendedor/promotor → só ele; supervisor → ele + a(s) equipe(s) que ele responde;
 * - gerente → + as equipes abaixo (recursivo); analista/assistente/admin → tenant (nenhuma consulta).
 */
import { escopoDoPerfil } from '@macuxi/platform-sdk';
import { escopoDeUsuarios } from '../domain';
import { EQUIPES_DO_RESPONSAVEL } from './carteira';
export async function usuariosVisiveisDoUsuario(usuario, banco) {
    const escopo = escopoDoPerfil(usuario.perfil);
    if (escopo === 'tenant')
        return 'tenant';
    const vazio = new Set();
    if (escopo === 'carteira')
        return escopoDeUsuarios(usuario.perfil, { proprio: usuario.id, equipe: vazio, equipesAbaixo: vazio });
    return banco.comTenant(usuario.tenant_id, async (db) => {
        const r = await db.query(`${EQUIPES_DO_RESPONSAVEL}
       select u.id as usuario_id, eq.nivel from core.usuario u join eq on eq.id = u.equipe_id where u.deleted_at is null`, [usuario.id]);
        const equipe = new Set(r.rows.filter((l) => l.nivel === 0).map((l) => l.usuario_id));
        const abaixo = new Set(r.rows.filter((l) => l.nivel > 0).map((l) => l.usuario_id));
        return escopoDeUsuarios(usuario.perfil, { proprio: usuario.id, equipe, equipesAbaixo: abaixo });
    });
}
