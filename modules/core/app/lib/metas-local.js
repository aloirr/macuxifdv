import { aplicarPendentesVisita, calendarioDoTenant, dataLocal, painelDoUsuario } from '../../domain';
import { pendentesDaFila } from './rota-local';
export function painelLocal(l, fila, o) {
    const hoje = dataLocal(o.agora, o.fuso);
    const periodo = o.periodo ?? hoje.slice(0, 7);
    const minhas = l.visitas.filter((v) => !v.deleted_at && v.usuario_id === o.usuarioId);
    const visitas = aplicarPendentesVisita([...minhas], pendentesDaFila(fila), { usuario_id: o.usuarioId, fuso: o.fuso });
    const p = painelDoUsuario({
        periodo,
        usuario_id: o.usuarioId,
        hoje,
        paradas: l.paradas,
        visitas,
        diarios: l.diarios,
        metas: l.metas,
        calendario: calendarioDoTenant((l.parametros ?? []).map((p) => ({ ...p, valor: p.valor }))),
    });
    return { ...p, periodo };
}
