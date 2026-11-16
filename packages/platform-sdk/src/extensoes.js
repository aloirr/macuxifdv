import { EXTENSAO_RE } from './nomes';
/**
 * Cria o registro. `S` mapeia slot → tipo do payload para dar tipo forte:
 * `criarRegistroExtensoes<{ 'cliente.abas': AbaCliente }>()`.
 */
export function criarRegistroExtensoes() {
    const donos = new Map();
    const itens = new Map();
    return {
        declararSlot(slot, dono) {
            if (!EXTENSAO_RE.test(slot))
                throw new Error(`Slot de extensão inválido: ${slot}`);
            const atual = donos.get(slot);
            if (atual && atual !== dono)
                throw new Error(`Slot ${slot} já pertence a ${atual}`);
            donos.set(slot, dono);
        },
        registrar(slot, item) {
            if (!donos.has(slot))
                throw new Error(`Slot ${slot} não declarado; o módulo dono precisa declará-lo antes`);
            const lista = itens.get(slot) ?? [];
            if (lista.some((i) => i.modulo === item.modulo && i.id === item.id)) {
                throw new Error(`Item ${item.modulo}/${item.id} já registrado em ${slot}`);
            }
            lista.push(item);
            itens.set(slot, lista);
        },
        listar(slot, filtro) {
            const ativos = new Set(filtro.modulosAtivos);
            const dono = donos.get(slot);
            if (!dono || !ativos.has(dono))
                return [];
            return (itens.get(slot) ?? [])
                .filter((i) => ativos.has(i.modulo))
                .filter((i) => !filtro.app || !i.apps || i.apps.includes(filtro.app))
                .filter((i) => !filtro.perfil || !i.perfis || i.perfis.includes(filtro.perfil))
                .filter((i) => !i.acao || (filtro.pode ? filtro.pode(i.acao) : false))
                .sort((a, b) => (a.ordem ?? 100) - (b.ordem ?? 100) || a.modulo.localeCompare(b.modulo) || a.id.localeCompare(b.id))
                .map((i) => i);
        },
        donoDoSlot(slot) {
            return donos.get(slot);
        },
    };
}
