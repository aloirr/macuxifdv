import { estadoDoLogin } from './auth';
export function decidirCredencial(e) {
    if (!e.usuario || !e.senhaConfere)
        return 'incorreta';
    if (e.usuario.excluido)
        return 'bloqueado';
    if (estadoDoLogin({ ativo: e.usuario.ativo, bloqueadoEm: e.usuario.bloqueadoEm, bloqueioAte: e.usuario.bloqueioAte, agora: e.agora }) !== 'ok')
        return 'bloqueado';
    return e.permitido ? 'ok' : 'sem_permissao';
}
