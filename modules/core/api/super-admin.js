import { chaveBloqueada, decidirAcessoDoLogin, expiracaoDoTokenPlataforma } from '../domain/super-admin';
import { CODIGOS_PORTAL, MENSAGEM_PORTAL_SENHA_A_TROCAR } from '../contracts/plataforma';
import { erroHttp } from './erros';
import { fabricaSuperAdminSql } from './super-admin-repositorio';
import { gastarTempoDeSenha, tokenDoCabecalho, verificarSenha } from './seguranca';
import { ConfiguracaoPlataformaInvalida, assinarTokenPlataforma, chaveDeTentativa, exigirSegredoPlataforma, verificarTokenPlataforma } from './seguranca-plataforma';
const MENSAGEM_CREDENCIAIS = 'E-mail ou senha incorretos. Confira e tente de novo.';
const MENSAGEM_BLOQUEADO = 'Acesso bloqueado por tentativas erradas. Tente de novo em 15 minutos.';
const MENSAGEM_SESSAO = 'Sua sessão do portal expirou. Entre de novo.';
const MENSAGEM_EMPRESA = 'Você não tem acesso a esta empresa. Escolha uma da lista.';
/** Prefixo do IP para a auditoria (LGPD): IPv4 /24, IPv6 /48. */
export function prefixoDoIp(ip) {
    if (!ip)
        return null;
    const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
    if (v4)
        return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
    if (ip.includes(':')) {
        const grupos = (ip.split('::')[0] ?? '').split(':').filter(Boolean).slice(0, 3);
        while (grupos.length < 3)
            grupos.push('0');
        return `${grupos.join(':').toLowerCase()}::/48`;
    }
    return null;
}
const ANONIMO = { super_admin_id: null, sessao_id: null, ator_tipo: null, usuario_id: null };
/** Os claims do token batem com a sessão viva (tipo, `sub` e `tid`)? Token sem empresa só serve a sessão sem empresa atual. */
export function claimsBatemComSessao(c, s) {
    if (c.typ === 'sa')
        return s.tipo === 'super_admin' && s.super_admin_id === c.sub && c.tid === undefined;
    if (s.tipo !== 'admin_cliente')
        return false;
    if (c.tid === undefined)
        return s.tenant_id === null && c.sub === c.sid;
    return s.tenant_id === c.tid && s.usuario_id === c.sub;
}
export function criarSuperAdmin(deps) {
    const fabrica = deps.repo ?? fabricaSuperAdminSql;
    const conferir = deps.senha?.verificar ?? verificarSenha;
    const gastar = deps.senha?.gastar ?? gastarTempoDeSenha;
    /** Confere o segredo; sem ele, 503 antes de qualquer consulta. */
    const config = () => {
        try {
            return exigirSegredoPlataforma(deps.segredo());
        }
        catch (e) {
            if (e instanceof ConfiguracaoPlataformaInvalida)
                throw erroHttp(503, CODIGOS_PORTAL.indisponivel, 'O acesso ao portal está indisponível no momento. Avise o suporte da Macuxi.');
            throw e;
        }
    };
    const auditar = async (repo, ctx, acao, status, rota, quem, detalhes) => {
        await repo.auditar({
            ...quem,
            acao,
            metodo: 'POST',
            rota,
            status,
            request_id: ctx.requestId,
            ip_prefixo: prefixoDoIp(ctx.ip),
            ...(detalhes ? { detalhes } : {}),
        });
    };
    /** Monta a resposta e o token do estado da sessão: super-admin, admin sem empresa (escolher) ou admin com empresa. */
    async function sessaoDoPortal(repo, sid, viva, agora, segredo) {
        const expiraEm = expiracaoDoTokenPlataforma(agora, viva.expira_em);
        const base = { expira_em: expiraEm.toISOString(), sessao_expira_em: viva.expira_em.toISOString() };
        if (viva.tipo === 'super_admin') {
            if (!viva.super_admin_id)
                throw erroHttp(401, CODIGOS_PORTAL.sessao, MENSAGEM_SESSAO);
            return { ...base, token: assinarTokenPlataforma({ sub: viva.super_admin_id, sid, typ: 'sa' }, agora, expiraEm, segredo), tipo: 'super_admin', empresa: null, empresas: [] };
        }
        const empresas = await repo.listarEmpresas(sid);
        if (viva.tenant_id === null) {
            return { ...base, token: assinarTokenPlataforma({ sub: sid, sid, typ: 'cli' }, agora, expiraEm, segredo), tipo: 'admin_cliente', empresa: null, empresas };
        }
        const empresa = empresas.find((e) => e.id === viva.tenant_id);
        if (!empresa || !viva.usuario_id)
            throw erroHttp(401, CODIGOS_PORTAL.sessao, MENSAGEM_SESSAO);
        return { ...base, token: assinarTokenPlataforma({ sub: viva.usuario_id, sid, typ: 'cli', tid: empresa.id }, agora, expiraEm, segredo), tipo: 'admin_cliente', empresa, empresas };
    }
    async function login(ctx) {
        const segredo = config();
        const repo = fabrica(ctx.banco);
        const rota = '/v1/plataforma/auth/login';
        const agora = ctx.agora();
        const chave = chaveDeTentativa(segredo, ctx.corpo.email);
        // RN-CORE-31: bloqueado = 423 para QUALQUER senha e QUALQUER e-mail (existente ou não), sem conferir nem contar
        const estado = await repo.tentativaEstado(chave);
        if (chaveBloqueada(estado.bloqueado_ate, agora)) {
            await gastar(ctx.corpo.senha);
            await auditar(repo, ctx, 'sa.login.falha', 423, rota, ANONIMO, { motivo: 'bloqueado' });
            throw erroHttp(423, CODIGOS_PORTAL.bloqueado, MENSAGEM_BLOQUEADO);
        }
        const contas = await repo.contasParaLogin(ctx.corpo.email);
        // em paralelo: 0, 1 ou poucas contas custam o tempo de uma conferência
        if (contas.length === 0)
            await gastar(ctx.corpo.senha);
        const conferidas = await Promise.all(contas.map(async (c) => ({ ...c, conferiu: await conferir(ctx.corpo.senha, c.senha_hash) })));
        const decidido = decidirAcessoDoLogin(conferidas);
        if (decidido?.tipo === 'senha_a_trocar') {
            // senha certa, mas só em conta com senha temporária (T-0094): a troca é no BKO; o portal não ganha tela de troca
            await repo.tentativaSucesso(chave);
            await auditar(repo, ctx, 'sa.login.falha', 403, rota, ANONIMO, { motivo: 'senha_a_trocar' });
            throw erroHttp(403, CODIGOS_PORTAL.senhaATrocar, MENSAGEM_PORTAL_SENHA_A_TROCAR);
        }
        if (!decidido) {
            const r = await repo.tentativaFalha(chave);
            const bloqueou = chaveBloqueada(r.bloqueado_ate, agora);
            await auditar(repo, ctx, 'sa.login.falha', bloqueou ? 423 : 401, rota, ANONIMO, { motivo: 'credenciais', falhas: r.falhas });
            if (bloqueou)
                throw erroHttp(423, CODIGOS_PORTAL.bloqueado, MENSAGEM_BLOQUEADO);
            throw erroHttp(401, CODIGOS_PORTAL.credenciais, MENSAGEM_CREDENCIAIS);
        }
        await repo.tentativaSucesso(chave);
        const aberta = await repo.abrirSessao(decidido.tipo === 'super_admin'
            ? { tipo: 'super_admin', super_admin_id: decidido.conta_id }
            : { tipo: 'admin_cliente', empresas: decidido.empresas.map((e) => ({ tenant_id: e.tenant_id, usuario_id: e.usuario_id, sessao_versao: e.sessao_versao })) });
        // o banco reconfere a conta; se ela deixou de valer entre a conferência e a abertura, é credencial inválida
        if (!aberta)
            throw erroHttp(401, CODIGOS_PORTAL.credenciais, MENSAGEM_CREDENCIAIS);
        const viva = await repo.sessaoValida(aberta.sessao_id);
        if (!viva)
            throw erroHttp(401, CODIGOS_PORTAL.credenciais, MENSAGEM_CREDENCIAIS);
        const sessao = await sessaoDoPortal(repo, aberta.sessao_id, viva, agora, segredo);
        await auditar(repo, ctx, 'sa.login.ok', 200, rota, { super_admin_id: viva.super_admin_id, sessao_id: aberta.sessao_id, ator_tipo: viva.tipo, usuario_id: viva.tipo === 'admin_cliente' ? viva.usuario_id : null }, { empresas: decidido.tipo === 'admin_cliente' ? decidido.empresas.length : 0 });
        return sessao;
    }
    /** Token do `Authorization` de uma rota pública (empresa, renovar, sair): assinatura, `aud`, `typ`, prazo e sessão viva igual ao token. */
    async function sessaoDoCabecalho(ctx, segredo) {
        const token = tokenDoCabecalho(ctx.cabecalhos?.authorization);
        const claims = token ? verificarTokenPlataforma(token, ctx.agora(), segredo) : null;
        const viva = claims ? await fabrica(ctx.banco).sessaoValida(claims.sid) : null;
        if (!claims || !viva || !claimsBatemComSessao(claims, viva))
            throw erroHttp(401, CODIGOS_PORTAL.sessao, MENSAGEM_SESSAO);
        return { claims, viva };
    }
    const quemDe = (c, viva) => ({
        super_admin_id: viva.super_admin_id,
        sessao_id: c.sid,
        ator_tipo: viva.tipo,
        usuario_id: viva.tipo === 'admin_cliente' ? viva.usuario_id : null,
    });
    /** Escolhe ou troca a empresa (admin do cliente): o token anterior morre (o `tid`/`sub` dele deixa de bater com a sessão). */
    async function escolherEmpresa(ctx) {
        const segredo = config();
        const { claims, viva } = await sessaoDoCabecalho(ctx, segredo);
        const repo = fabrica(ctx.banco);
        const rota = '/v1/plataforma/auth/empresa';
        if (viva.tipo !== 'admin_cliente')
            throw erroHttp(403, CODIGOS_PORTAL.empresaNaoPermitida, 'O acesso do time da Macuxi já vê todas as empresas. Escolha a empresa na lista.');
        const escolhida = await repo.escolherEmpresa(claims.sid, ctx.corpo.tenant_id);
        if (!escolhida) {
            await auditar(repo, ctx, 'sa.empresa.escolher', 403, rota, quemDe(claims, viva), { motivo: 'fora_da_lista' });
            throw erroHttp(403, CODIGOS_PORTAL.empresaNaoPermitida, MENSAGEM_EMPRESA);
        }
        const nova = await repo.sessaoValida(claims.sid);
        if (!nova)
            throw erroHttp(401, CODIGOS_PORTAL.sessao, MENSAGEM_SESSAO);
        return sessaoDoPortal(repo, claims.sid, nova, ctx.agora(), segredo);
    }
    async function renovar(ctx) {
        const segredo = config();
        const { claims, viva } = await sessaoDoCabecalho(ctx, segredo);
        return sessaoDoPortal(fabrica(ctx.banco), claims.sid, viva, ctx.agora(), segredo);
    }
    async function sair(ctx) {
        const segredo = config();
        const { claims, viva } = await sessaoDoCabecalho(ctx, segredo);
        const repo = fabrica(ctx.banco);
        await repo.revogarSessao(claims.sid);
        await auditar(repo, ctx, 'sa.sair', 204, '/v1/plataforma/auth/sair', quemDe(claims, viva));
    }
    /**
     * `servicos.autenticarPortal`: assinatura (segredo próprio), `aud`, `typ`, `exp` E sessão viva no banco com o mesmo tipo,
     * `sub` e `tid`. Qualquer outra coisa (token de tenant, token sem `typ`, token antigo de outra empresa, segredo ausente) = `null`.
     */
    async function autenticarPortal(cabecalhos, banco, agora = new Date()) {
        const segredo = deps.segredo();
        if (!segredo || segredo.length < 32)
            return null;
        const token = tokenDoCabecalho(cabecalhos.authorization);
        const claims = token ? verificarTokenPlataforma(token, agora, segredo) : null;
        if (!claims)
            return null;
        const viva = await fabrica(banco).sessaoValida(claims.sid);
        if (!viva || !claimsBatemComSessao(claims, viva))
            return null;
        if (viva.tipo === 'super_admin')
            return { tipo: 'super_admin', id: claims.sub, sessao_id: claims.sid };
        if (viva.tenant_id === null || !viva.usuario_id)
            return { tipo: 'admin_cliente', sessao_id: claims.sid, empresa: null };
        return { tipo: 'admin_cliente', sessao_id: claims.sid, empresa: { tenant_id: viva.tenant_id, usuario_id: viva.usuario_id, ...(viva.sem_filial === true ? { sem_filial: true } : {}) } };
    }
    return { login, escolherEmpresa, renovar, sair, autenticarPortal };
}
