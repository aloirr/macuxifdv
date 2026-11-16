import { ordenarPorDependencia } from './manifesto';
/** RN-CORE-01 (multiperfil, T-0112): união dos módulos padrão dos perfis do usuário, sem repetir. */
export function uniaoDosModulosDosPerfis(porPerfil) {
    return [...new Set(porPerfil.flat())];
}
/**
 * RN-CORE-01: efetivos = ativos do tenant ∩ módulos do perfil − exceções do usuário; core sempre ativo.
 * RN-CORE-03: módulo cuja dependência obrigatória não está efetiva sai também (em cascata).
 * Devolve em ordem de dependência (core primeiro). A licença é checada a cada requisição
 * (não congelar o resultado no JWT).
 */
export function modulosEfetivos(e) {
    const instalados = new Map(e.manifestos.map((m) => [m.id, m]));
    const tenant = new Set(e.ativosNoTenant);
    const doUsuario = new Set(e.doPerfil);
    for (const m of e.removidosDoUsuario ?? [])
        doUsuario.delete(m);
    const efetivos = new Set();
    for (const id of instalados.keys()) {
        if (id === 'core' || (tenant.has(id) && doUsuario.has(id)))
            efetivos.add(id);
    }
    let mudou = true;
    while (mudou) {
        mudou = false;
        for (const id of [...efetivos]) {
            const m = instalados.get(id);
            if (m.depende.some((d) => !efetivos.has(d))) {
                efetivos.delete(id);
                mudou = true;
            }
        }
    }
    return ordenarPorDependencia(e.manifestos.filter((m) => efetivos.has(m.id))).map((m) => m.id);
}
