/**
 * Apoio dos testes do Core: repositórios em memória (mesma interface do SQL), banco falso e contexto público.
 * Não é importado pelo código de produção.
 */
import * as crypto from 'node:crypto';
import { verificarSenha } from './seguranca';
export const TENANT_A = '0a000000-0000-4000-8000-0000000000aa';
export const TENANT_B = '0a000000-0000-4000-8000-0000000000bb';
export const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres!!';
/** Hash argon2id PHC com custo mínimo (m=8, t=1): só para os testes; o verificarSenha de produção lê os parâmetros do próprio hash. */
export function hashBarato(senha) {
    const fn = crypto.argon2;
    const sal = crypto.randomBytes(16);
    const b64 = (b) => b.toString('base64').replace(/=+$/, '');
    return new Promise((ok, falha) => fn('argon2id', { message: senha, nonce: sal, parallelism: 1, tagLength: 32, memory: 8, passes: 1 }, (e, tag) => (e ? falha(e) : ok(`$argon2id$v=19$m=8,t=1,p=1$${b64(sal)}$${b64(tag)}`))));
}
/** Senhas com argon2 barato e contagem das conferências (o tempo constante do login = sempre 2 conferências). */
export function senhasDeTeste() {
    const contagem = { verificar: 0, gastar: 0, hash: 0 };
    let falso = null;
    return {
        contagem,
        verificar: async (s, phc) => {
            contagem.verificar += 1;
            return verificarSenha(s, phc);
        },
        gastar: async (s) => {
            contagem.gastar += 1;
            falso ??= hashBarato('senha-falsa');
            await verificarSenha(s, await falso);
        },
        hash: async (s) => {
            contagem.hash += 1;
            return hashBarato(s);
        },
    };
}
export async function estadoInicial() {
    const e = { tenants: new Map(), usuarios: new Map(), sessoes: [], dispositivos: new Map(), leituraDeExibicao: [] };
    e.tenants.set('alfa', { id: TENANT_A, codigo: 'alfa', nome: 'Distribuidora Alfa', fuso: 'America/Manaus', status: 'ativo' });
    e.tenants.set('beta', { id: TENANT_B, codigo: 'beta', nome: 'Comercial Beta', fuso: 'America/Sao_Paulo', status: 'ativo' });
    const hash = await hashBarato('Teste@1234');
    const base = {
        nome_curto: null,
        senha_hash: hash,
        ativo: true,
        bloqueado_em: null,
        bloqueio_ate: null,
        tentativas_falhas: 0,
        ultimo_login_em: null,
        trocar_senha: false,
        senha_expira_em: null,
        senha_temporaria_hash: null,
        senha_temporaria_expira_em: null,
        senha_temporaria_criada_em: null,
        sessao_versao: 0,
    };
    e.usuarios.set('u-vend', { ...base, id: '0b000000-0000-4000-8000-000000000001', tenant_id: TENANT_A, nome: 'Vera Vendedora', email: 'vendedor@exemplo.com.br', perfil: 'vendedor' });
    e.usuarios.set('u-prom', { ...base, id: '0b000000-0000-4000-8000-000000000002', tenant_id: TENANT_A, nome: 'Paulo Promotor', email: 'promotor@exemplo.com.br', perfil: 'promotor' });
    e.usuarios.set('u-beta', { ...base, id: '0b000000-0000-4000-8000-000000000003', tenant_id: TENANT_B, nome: 'Beto Beta', email: 'vendedor@exemplo.com.br', perfil: 'vendedor' });
    return e;
}
export function fabricaEmMemoria(e) {
    return {
        doTenant(db) {
            const tenantId = db.tenantId;
            const meus = () => [...e.usuarios.values()].filter((u) => u.tenant_id === tenantId);
            const sessoes = () => e.sessoes.filter((s) => s.tenant_id === tenantId);
            return {
                usuarioPorEmail: async (email) => meus().find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null,
                usuarioAtual: async (id) => meus().find((u) => u.id === id) ?? null,
                gravarTentativas: async (id, falhas, ate) => {
                    const u = meus().find((x) => x.id === id);
                    u.tentativas_falhas = falhas;
                    u.bloqueio_ate = ate;
                },
                registrarLoginOk: async (id, agora) => {
                    const u = meus().find((x) => x.id === id);
                    u.tentativas_falhas = 0;
                    u.bloqueio_ate = null;
                    u.ultimo_login_em = agora;
                },
                trocarSenha: async (id, senhaHash, agora) => {
                    const u = meus().find((x) => x.id === id);
                    Object.assign(u, { senha_hash: senhaHash, trocar_senha: false, senha_expira_em: null, senha_temporaria_hash: null, senha_temporaria_expira_em: null, senha_temporaria_criada_em: null, tentativas_falhas: 0, bloqueio_ate: null });
                    u.sessao_versao += 1;
                    for (const s of sessoes())
                        if (s.usuario_id === id && !s.revogado_em)
                            s.revogado_em = agora;
                    return u.sessao_versao;
                },
                gravarSenhaTemporaria: async (id, hash, criadaEm, expiraEm) => {
                    Object.assign(meus().find((x) => x.id === id), { senha_temporaria_hash: hash, senha_temporaria_criada_em: criadaEm, senha_temporaria_expira_em: expiraEm });
                },
                descartarSenhaTemporaria: async (id) => {
                    Object.assign(meus().find((x) => x.id === id), { senha_temporaria_hash: null, senha_temporaria_criada_em: null, senha_temporaria_expira_em: null });
                },
                dispositivoBloqueado: async (d) => e.dispositivos.get(d)?.bloqueado ?? false,
                upsertDispositivo: async (usuarioId, d) => {
                    if (!e.dispositivos.has(d))
                        e.dispositivos.set(d, { usuario_id: usuarioId, bloqueado: false });
                },
                criarSessao: async (s) => {
                    e.sessoes.push({ ...s, tenant_id: tenantId, usado_em: null, revogado_em: null });
                },
                sessaoPorHash: async (hash) => sessoes().find((s) => s.token_hash === hash) ?? null,
                marcarSessaoUsada: async (id, agora) => {
                    sessoes().find((s) => s.id === id).usado_em = agora;
                },
                revogarFamilia: async (familia, agora) => {
                    for (const s of sessoes())
                        if (s.familia_id === familia && !s.revogado_em)
                            s.revogado_em = agora;
                },
            };
        },
        publico() {
            return {
                tenantPorCodigo: async (codigo) => {
                    const t = e.tenants.get(codigo.toLowerCase());
                    return t ? { id: t.id, status: t.status } : null;
                },
                tenantParaExibicao: async (codigo, _tenantId) => {
                    e.leituraDeExibicao.push(codigo);
                    const t = e.tenants.get(codigo.toLowerCase());
                    return t ? { id: t.id, codigo: t.codigo, nome: t.nome, fuso: t.fuso } : null;
                },
            };
        },
    };
}
/** Banco falso: `comTenant` entrega um "db" que só carrega o tenant (o repositório em memória lê dele). */
export function bancoDeTeste() {
    const tenantsUsados = [];
    const consultas = [];
    const banco = {
        comTenant: async (tenantId, fn) => {
            tenantsUsados.push(tenantId);
            return fn({
                tenantId,
                query: async (sql, valores = []) => {
                    consultas.push({ sql, valores });
                    return { rows: [], rowCount: 0 };
                },
            });
        },
        semTenant: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
    };
    return { banco, tenantsUsados, consultas };
}
export const logSilencioso = {
    linhas: [],
    info(o, m) {
        this.linhas.push(JSON.stringify({ o, m }));
    },
    warn(o, m) {
        this.linhas.push(JSON.stringify({ o, m }));
    },
    error(o, m) {
        this.linhas.push(JSON.stringify({ o, m }));
    },
};
export function contextoPublico(corpo, banco, agora, ip = '127.0.0.1') {
    logSilencioso.linhas.length = 0;
    return { corpo, query: {}, params: {}, requestId: 'req-1', ip, agora, banco, log: logSilencioso };
}
