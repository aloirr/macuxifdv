import { gestorImediatoDe } from '../domain';
import { lerHierarquiaDoTenant } from './hierarquia-leitura';
export async function gestorImediatoDoUsuario(db, usuarioId) {
    const { equipes, usuarios } = await lerHierarquiaDoTenant(db);
    return { gestor_imediato: gestorImediatoDe(equipes, usuarios, usuarioId) };
}
