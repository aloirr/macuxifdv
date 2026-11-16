import { lerNomeEvento } from './nomes';
export function definirEvento(nome, schema) {
    const n = lerNomeEvento(nome);
    if (!n)
        throw new Error(`Nome de evento inválido: ${nome} (use <modulo>.<entidade>.<fato>@vN)`);
    return { nome, ...n, schema };
}
export class ErroEvento extends Error {
    constructor(message) {
        super(message);
        this.name = 'ErroEvento';
    }
}
/** UUID v4 do ambiente (Node 20+, navegadores e Hermes com polyfill expo-crypto). */
export function uuidDoAmbiente() {
    const c = globalThis.crypto;
    if (!c?.randomUUID)
        throw new Error('crypto.randomUUID indisponível: informe gerarId');
    return c.randomUUID();
}
export function criarBarramento(op) {
    const porId = new Map(op.manifestos.map((m) => [m.id, m]));
    const assinaturas = new Map();
    const gerarId = op.gerarId ?? uuidDoAmbiente;
    const agora = op.agora ?? (() => new Date());
    const manifestoDe = (modulo) => {
        const m = porId.get(modulo);
        if (!m)
            throw new ErroEvento(`Módulo ${modulo} não está instalado`);
        return m;
    };
    return {
        async publicar(modulo, def, payload, ctx) {
            if (def.modulo !== modulo)
                throw new ErroEvento(`${modulo} não pode publicar ${def.nome} (evento de ${def.modulo})`);
            if (!manifestoDe(modulo).publica.includes(def.nome)) {
                throw new ErroEvento(`${def.nome} não está em "publica" do manifesto de ${modulo}`);
            }
            if (!ctx.tenant_id)
                throw new ErroEvento('tenant_id obrigatório no evento');
            const valido = def.schema.safeParse(payload);
            if (!valido.success)
                throw new ErroEvento(`Payload inválido para ${def.nome}: ${valido.error.issues.map((i) => i.message).join('; ')}`);
            const envelope = {
                evento_id: gerarId(),
                nome: def.nome,
                origem: modulo,
                tenant_id: ctx.tenant_id,
                usuario_id: ctx.usuario_id ?? null,
                request_id: ctx.request_id ?? null,
                ocorrido_em: agora().toISOString(),
                payload: valido.data,
            };
            await op.outbox.gravar(envelope);
            return envelope;
        },
        assinar(modulo, def, fn) {
            if (!manifestoDe(modulo).consome.includes(def.nome)) {
                throw new ErroEvento(`${def.nome} não está em "consome" do manifesto de ${modulo}`);
            }
            const lista = assinaturas.get(def.nome) ?? [];
            if (lista.some((a) => a.modulo === modulo))
                throw new ErroEvento(`${modulo} já assina ${def.nome}`);
            lista.push({ modulo, def, fn: fn });
            assinaturas.set(def.nome, lista);
        },
        /** Chamado pelo worker da fila para cada envelope lido da outbox. */
        async entregar(envelope) {
            const r = { entregues: [], ignorados: [], falhas: [] };
            for (const a of assinaturas.get(envelope.nome) ?? []) {
                if (op.estaAtivo && !(await op.estaAtivo(envelope.tenant_id, a.modulo))) {
                    r.ignorados.push({ modulo: a.modulo, motivo: 'modulo_inativo' });
                    continue;
                }
                if (await op.consumo.jaProcessado(a.modulo, envelope.evento_id)) {
                    r.ignorados.push({ modulo: a.modulo, motivo: 'ja_processado' });
                    continue;
                }
                try {
                    const payload = a.def.schema.parse(envelope.payload);
                    await a.fn(payload, { ...envelope, payload });
                    await op.consumo.marcarProcessado(a.modulo, envelope.evento_id);
                    r.entregues.push(a.modulo);
                }
                catch (e) {
                    r.falhas.push({ modulo: a.modulo, erro: e instanceof Error ? e.message : String(e) });
                }
            }
            return r;
        },
        assinantes(nome) {
            return (assinaturas.get(nome) ?? []).map((a) => a.modulo);
        },
    };
}
/** Outbox em memória (testes e dev). */
export function criarOutboxEmMemoria() {
    const fila = [];
    return {
        async gravar(envelope) {
            fila.push(envelope);
        },
        pendentes() {
            return fila;
        },
        retirar() {
            return fila.splice(0, fila.length);
        },
    };
}
/** Registro de consumo em memória (testes e dev). */
export function criarConsumoEmMemoria() {
    const feitos = new Set();
    return {
        async jaProcessado(consumidor, eventoId) {
            return feitos.has(`${consumidor}:${eventoId}`);
        },
        async marcarProcessado(consumidor, eventoId) {
            feitos.add(`${consumidor}:${eventoId}`);
        },
    };
}
