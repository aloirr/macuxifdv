/**
 * Acesso a dados da autenticação do Core. Interface + implementação SQL (Postgres, dentro de `comTenant`: RLS).
 * Tabelas: `core.usuario` (+ `tentativas_falhas`, `bloqueio_ate`), `core.sessao` e `core.dispositivo`
 * (migração pedida ao banco-dados no recado da T-0003 Fase 2). Os testes do Core usam a implementação em memória
 * (`teste/memoria.ts`); este SQL é conferido com o banco quando a migração existir.
 * Nada daqui entra em log (e-mail e hash são dado pessoal/segredo).
 */
import { ErroHttpModulo } from '@macuxi/platform-sdk';
/** Aparelho que pertence a outro tenant/usuário (FK 23503, unicidade 23505, RLS 42501): erro de cliente, não 500. */
const CODIGOS_APARELHO_INVALIDO = new Set(['23503', '23505', '42501']);
const aparelhoInvalido = () => new ErroHttpModulo(403, 'DISPOSITIVO_INVALIDO', 'Este aparelho não pode ser usado com este acesso. Fale com o administrador da sua empresa.');
async function comAparelho(consulta) {
    try {
        await consulta;
    }
    catch (e) {
        if (CODIGOS_APARELHO_INVALIDO.has(String(e?.code)))
            throw aparelhoInvalido();
        throw e;
    }
}
const data = (v) => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));
export function repositorioTenantSql(db) {
    return {
        async usuarioPorEmail(email, opcoes) {
            const r = await db.query(`select id, nome, nome_curto, email, perfil, senha_hash, ativo, bloqueado_em, bloqueio_ate, tentativas_falhas, ultimo_login_em,
                trocar_senha, senha_expira_em, senha_temporaria_hash, senha_temporaria_expira_em, senha_temporaria_criada_em, sessao_versao
           from core.usuario
          where lower(email) = lower($1) and deleted_at is null${opcoes?.travar ? '\n            for update' : ''}`, [email]);
            const l = r.rows[0];
            if (!l)
                return null;
            return {
                id: String(l.id),
                nome: String(l.nome),
                nome_curto: l.nome_curto ?? null,
                email: String(l.email),
                perfil: l.perfil,
                senha_hash: l.senha_hash ?? null,
                ativo: Boolean(l.ativo),
                bloqueado_em: data(l.bloqueado_em),
                bloqueio_ate: data(l.bloqueio_ate),
                tentativas_falhas: Number(l.tentativas_falhas ?? 0),
                ultimo_login_em: data(l.ultimo_login_em),
                trocar_senha: Boolean(l.trocar_senha),
                senha_expira_em: data(l.senha_expira_em),
                senha_temporaria_hash: l.senha_temporaria_hash ?? null,
                senha_temporaria_expira_em: data(l.senha_temporaria_expira_em),
                senha_temporaria_criada_em: data(l.senha_temporaria_criada_em),
                sessao_versao: Number(l.sessao_versao ?? 0),
            };
        },
        async usuarioAtual(id) {
            const r = await db.query('select id, perfil, ativo, bloqueado_em, sessao_versao, (filial_cadastro_id is null) as sem_filial from core.usuario where id = $1 and deleted_at is null', [id]);
            const l = r.rows[0];
            return l ? { id: String(l.id), perfil: l.perfil, ativo: Boolean(l.ativo), bloqueado_em: data(l.bloqueado_em), sessao_versao: Number(l.sessao_versao ?? 0), sem_filial: l.sem_filial === true } : null;
        },
        async gravarTentativas(usuarioId, falhas, bloqueioAte) {
            await db.query('update core.usuario set tentativas_falhas = $2, bloqueio_ate = $3 where id = $1', [usuarioId, falhas, bloqueioAte]);
        },
        async registrarLoginOk(usuarioId, agora) {
            await db.query('update core.usuario set tentativas_falhas = 0, bloqueio_ate = null, ultimo_login_em = $2 where id = $1', [usuarioId, agora]);
        },
        async dispositivoBloqueado(dispositivoId) {
            const r = await db.query('select 1 from core.dispositivo where id = $1 and bloqueado_em is not null and deleted_at is null', [dispositivoId]);
            return r.rows.length > 0;
        },
        async upsertDispositivo(usuarioId, dispositivoId, nome, agora) {
            await comAparelho(db.query(`insert into core.dispositivo (id, tenant_id, usuario_id, nome, ultimo_acesso_em)
         values ($1, plataforma.tenant_atual(), $2, $3, $4)
         on conflict (id) do update set ultimo_acesso_em = excluded.ultimo_acesso_em, nome = coalesce(excluded.nome, core.dispositivo.nome),
           push_token = case when core.dispositivo.usuario_id = excluded.usuario_id then core.dispositivo.push_token end,
           push_plataforma = case when core.dispositivo.usuario_id = excluded.usuario_id then core.dispositivo.push_plataforma end,
           usuario_id = excluded.usuario_id
         where core.dispositivo.bloqueado_em is null`, [dispositivoId, usuarioId, nome, agora]));
        },
        async criarSessao(s) {
            await comAparelho(db.query(`insert into core.sessao (id, tenant_id, usuario_id, familia_id, token_hash, dispositivo_id, expira_em)
         values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6)`, [s.id, s.usuario_id, s.familia_id, s.token_hash, s.dispositivo_id, s.expira_em]));
        },
        async sessaoPorHash(hash) {
            const r = await db.query('select id, usuario_id, familia_id, dispositivo_id, expira_em, usado_em, revogado_em from core.sessao where token_hash = $1 and deleted_at is null', [hash]);
            const l = r.rows[0];
            if (!l)
                return null;
            return {
                id: String(l.id),
                usuario_id: String(l.usuario_id),
                familia_id: String(l.familia_id),
                dispositivo_id: l.dispositivo_id ?? null,
                expira_em: data(l.expira_em),
                usado_em: data(l.usado_em),
                revogado_em: data(l.revogado_em),
            };
        },
        async marcarSessaoUsada(id, agora) {
            await db.query('update core.sessao set usado_em = $2 where id = $1', [id, agora]);
        },
        async revogarFamilia(familiaId, agora) {
            await db.query('update core.sessao set revogado_em = $2 where familia_id = $1 and revogado_em is null', [familiaId, agora]);
        },
        async trocarSenha(usuarioId, senhaHash, agora) {
            const r = await db.query(`update core.usuario
            set senha_hash = $2, trocar_senha = false, senha_expira_em = null,
                senha_temporaria_hash = null, senha_temporaria_expira_em = null, senha_temporaria_criada_em = null,
                tentativas_falhas = 0, bloqueio_ate = null, sessao_versao = sessao_versao + 1
          where id = $1
        returning sessao_versao`, [usuarioId, senhaHash]);
            await db.query('update core.sessao set revogado_em = $2 where usuario_id = $1 and revogado_em is null', [usuarioId, agora]);
            return Number(r.rows[0]?.sessao_versao ?? 0);
        },
        async gravarSenhaTemporaria(usuarioId, hash, criadaEm, expiraEm) {
            await db.query('update core.usuario set senha_temporaria_hash = $2, senha_temporaria_criada_em = $3, senha_temporaria_expira_em = $4 where id = $1', [usuarioId, hash, criadaEm, expiraEm]);
        },
        async descartarSenhaTemporaria(usuarioId) {
            await db.query('update core.usuario set senha_temporaria_hash = null, senha_temporaria_criada_em = null, senha_temporaria_expira_em = null where id = $1 and senha_temporaria_hash is not null', [usuarioId]);
        },
    };
}
export function repositorioPublicoSql(banco) {
    return {
        async tenantPorCodigo(codigo) {
            // só id e status: nome e fuso do tenant NÃO são lidos antes de a senha ser validada
            const r = await banco.semTenant((db) => db.query('select id, status from plataforma.tenant_por_codigo($1)', [codigo]));
            return r.rows[0] ?? null;
        },
        async tenantParaExibicao(codigo, tenantId) {
            // 0052 (T-0122 N5): depois da senha validada, nome e fuso vêm do tenant DA SESSÃO (RLS), não de tenant_por_codigo
            const r = await banco.comTenant(tenantId, (db) => db.query('select id, nome, fuso from plataforma.tenant_da_sessao()'));
            const l = r.rows[0];
            return l ? { id: l.id, codigo, nome: l.nome, fuso: l.fuso } : null;
        },
    };
}
export const fabricaSql = { doTenant: repositorioTenantSql, publico: repositorioPublicoSql };
