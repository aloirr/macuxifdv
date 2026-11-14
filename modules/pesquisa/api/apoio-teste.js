import { criarApiPesquisa } from './index';
import { criarRepositorioEmMemoria } from './repositorio-memoria';
export const uu = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const TENANT_A = uu(9001);
export const TENANT_B = uu(9002);
export function criarAmbienteDeTeste() {
    const fabrica = criarRepositorioEmMemoria();
    const api = criarApiPesquisa(fabrica);
    const efeitos = { eventos: [], auditorias: [], arquivos: [] };
    const db = { query: async () => ({ rows: [], rowCount: 0 }) };
    const contexto = (o) => {
        const tx = {
            publicar: async (def, payload, agregado) => {
                efeitos.eventos.push({ nome: def.nome, payload, agregado });
                return {};
            },
            auditar: async (r) => {
                efeitos.auditorias.push(r);
            },
            registrarArquivo: async (a) => {
                efeitos.arquivos.push(a);
                return { criado: true };
            },
            consultar: async () => {
                throw new Error('sem consultas na Pesquisa');
            },
        };
        const usuario = { id: o.id, tenant_id: o.tenant ?? TENANT_A, perfil: o.perfil, modulos: ['core', 'pesquisa'] };
        const padrao = ['analista', 'admin', 'assistente'].includes(o.perfil) ? 'tenant' : new Set([o.id]);
        return {
            usuario,
            dependencias: {},
            requestId: 'req-teste',
            agora: o.agora,
            comTenant: (fn) => fn(db, tx),
            carteira: async () => o.carteira ?? 'tenant',
            usuariosVisiveis: async () => o.visiveis ?? padrao,
            parametros: () => o.parametros ?? {},
            fuso: () => 'America/Manaus',
            log: { info() { }, warn() { }, error() { } },
        };
    };
    const rota = (metodo, caminho) => {
        const r = api.rotas?.find((x) => x.metodo === metodo && x.caminho === caminho);
        if (!r)
            throw new Error(`rota ${metodo} ${caminho} não existe`);
        return r;
    };
    /** Executa como o `createApp` faria depois das checagens (o corpo/query/params passam pelo Zod da rota). */
    const chamar = async (ctx, metodo, caminho, e = {}) => {
        const r = rota(metodo, caminho);
        const corpo = r.corpo ? r.corpo.parse(e.corpo ?? {}) : (e.corpo ?? {});
        const query = r.query ? r.query.parse(e.query ?? {}) : (e.query ?? {});
        const params = r.params ? r.params.parse(e.params ?? {}) : (e.params ?? {});
        return (await r.executar({ ...ctx, corpo, query, params }));
    };
    const provedor = (entidade) => {
        const p = api.sync?.find((s) => s.entidade.nome === entidade);
        if (!p)
            throw new Error(`sem provedor ${entidade}`);
        return p;
    };
    const push = (ctx, itens) => provedor('resposta_pesquisa').receber(ctx, itens);
    const pull = (ctx, entidade, ate, desde = null) => provedor(entidade).puxar(ctx, { desde, ate, limite: 1000 });
    return { api, fabrica, efeitos, contexto, rota, chamar, push, pull, provedor };
}
