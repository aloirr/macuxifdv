import { criarPortaVersaoAppMemoria, criarServicoPacotesMemoria, ROTA_CORE_APP_APK, ROTA_CORE_APP_AVISO_VERSAO } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { LinkApkProprioSchema } from '../contracts';
import { manifest } from '../manifest';
import { rotaApkProprio, rotaAvisoVersaoApp } from './app-atualizacao';
const CAMPO = { versao: '1.0.34', arquivo: 'Campo-Oficial-v1.0.34.apk', sha256: 'c'.repeat(64), tamanho_bytes: 1000 };
const GESTAO = { versao: '1.0.34', arquivo: 'Gestao-Oficial-v1.0.34.apk' };
function ctx(o, auditorias = [], consultas = [], logs = []) {
    const modulos = o.modulos ?? ['core', 'vendedor', 'gestor'];
    return {
        usuario: { id: 'u1', tenant_id: 't1', perfil: o.perfil ?? 'vendedor', modulos: ['core'] },
        corpo: {},
        pacotes: 'pacotes' in o ? o.pacotes : criarServicoPacotesMemoria({ campo: CAMPO, gestao: GESTAO }),
        versaoApp: o.versaoApp,
        agora: () => o.agora ?? new Date('2026-11-24T20:00:00.000Z'),
        log: { info: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a) },
        comTenant: async (fn) => fn({
            query: async (sql, valores = []) => {
                consultas.push([sql, valores]);
                return sql.includes('tenant_modulo') ? { rows: modulos.map((modulo) => ({ modulo })) } : { rows: [] };
            },
        }, { auditar: async (a) => { auditorias.push(a); }, publicar: async () => ({}) }),
    };
}
describe('T-0195: link do APK do próprio app (ADR 0070 §D6, RN-CORE-80)', () => {
    it('RN-CORE-80: rota do app (sem superfície BKO), ação app.atualizar só dos perfis com app, sem corpo, sem carteira, sem cache', () => {
        expect(`/v1/core/${rotaApkProprio.caminho}`).toBe(ROTA_CORE_APP_APK);
        expect(`/v1/core/${rotaAvisoVersaoApp.caminho}`).toBe(ROTA_CORE_APP_AVISO_VERSAO);
        for (const r of [rotaApkProprio, rotaAvisoVersaoApp]) {
            expect(r).toMatchObject({ metodo: 'POST', acao: 'app.atualizar', carteira: 'nao_se_aplica', semCache: true });
            expect(r.superficie).toBeUndefined();
            expect(r.superAdmin).toBeUndefined();
            const corpo = r.corpo;
            expect(corpo.safeParse({}).success).toBe(true);
            expect(corpo.safeParse({ variante: 'gestao' }).success).toBe(false);
        }
        expect(manifest.acoes['app.atualizar']?.perfis).toEqual(['vendedor', 'promotor', 'supervisor', 'gerente']);
    });
    it('RN-CORE-80: vendedor recebe o link do Campo e supervisor o do Gestão; auditoria e log sem a URL', async () => {
        const auditorias = [];
        const logs = [];
        const r = await rotaApkProprio.executar(ctx({ perfil: 'vendedor' }, auditorias, [], logs));
        expect(LinkApkProprioSchema.parse(r)).toEqual(r);
        expect(r).toMatchObject({ variante: 'campo', versao: '1.0.34', arquivo: CAMPO.arquivo });
        expect(auditorias).toEqual([{ acao: 'core.app_apk_link', entidade: 'app_pacote', entidade_id: null, depois: { variante: 'campo', versao: '1.0.34', arquivo: CAMPO.arquivo } }]);
        expect(JSON.stringify([auditorias, logs])).not.toContain('http');
        const g = await rotaApkProprio.executar(ctx({ perfil: 'supervisor' }));
        expect(g).toMatchObject({ variante: 'gestao', arquivo: GESTAO.arquivo });
    });
    it('RN-CORE-80: perfil sem app (admin, analista, assistente) responde 403 APP_PERFIL_SEM_APP e não assina link', async () => {
        for (const perfil of ['admin', 'analista', 'assistente']) {
            const auditorias = [];
            await expect(rotaApkProprio.executar(ctx({ perfil }, auditorias))).rejects.toMatchObject({ status: 403, codigo: 'APP_PERFIL_SEM_APP' });
            expect(auditorias).toHaveLength(0);
        }
    });
    it('RN-CORE-67: empresa sem o módulo do app responde 403 APP_SEM_LICENCA e não audita', async () => {
        const auditorias = [];
        await expect(rotaApkProprio.executar(ctx({ perfil: 'promotor', modulos: ['core', 'gestor'] }, auditorias))).rejects.toMatchObject({ status: 403, codigo: 'APP_SEM_LICENCA' });
        await expect(rotaApkProprio.executar(ctx({ perfil: 'gerente', modulos: ['core', 'vendedor'] }, auditorias))).rejects.toMatchObject({ status: 403, codigo: 'APP_SEM_LICENCA' });
        expect(auditorias).toHaveLength(0);
    });
    it('RN-CORE-80: sem pacote publicado 404 APP_SEM_PACOTE; sem S3 503 ARMAZENAMENTO_INDISPONIVEL', async () => {
        await expect(rotaApkProprio.executar(ctx({ pacotes: criarServicoPacotesMemoria({}) }))).rejects.toMatchObject({ status: 404, codigo: 'APP_SEM_PACOTE' });
        await expect(rotaApkProprio.executar(ctx({ pacotes: undefined }))).rejects.toMatchObject({ status: 503, codigo: 'ARMAZENAMENTO_INDISPONIVEL' });
    });
});
describe('T-0195: aviso de versão nova no sininho (ADR 0070 §D7, RN-CORE-80)', () => {
    const PUB = { campo: { versao: '1.0.34', publicada_em: '2026-11-24T12:00:00.000Z' } };
    const inserts = (c) => c.filter(([sql]) => String(sql).includes('insert into core.notificacao'));
    it('RN-CORE-80: no aviso grava uma notificação sistema/app_versao_nova sem link, com envio_id determinístico, e responde a situação', async () => {
        const consultas = [];
        const versaoApp = criarPortaVersaoAppMemoria(PUB, { variante: 'campo', versao: '1.0.33' });
        const r = await rotaAvisoVersaoApp.executar(ctx({ versaoApp }, [], consultas));
        expect(r).toEqual({ variante: 'campo', situacao: 'aviso', versao_publicada: '1.0.34', prazo_ate: '2026-11-25T12:00:00.000Z' });
        const [[sql, valores]] = inserts(consultas);
        expect(sql).toContain("'sistema'");
        expect(sql).toContain('on conflict (tenant_id, usuario_id, envio_id)');
        expect(valores.slice(0, 4)).toEqual(['u1', 'app_versao_nova', 'Versão 1.0.34 disponível', 'Instale por cima da versão atual, sem desinstalar o app.']);
        expect(valores[5]).toBe('2026-11-25T12:00:00.000Z');
        const outra = [];
        await rotaAvisoVersaoApp.executar(ctx({ versaoApp }, [], outra));
        expect(inserts(outra)[0][1][4]).toBe(valores[4]);
    });
    it('RN-CORE-67: empresa sem o módulo do app: situação aviso, mas nenhuma notificação é gravada (o toque daria 403)', async () => {
        const consultas = [];
        const versaoApp = criarPortaVersaoAppMemoria({ gestao: PUB.campo }, { variante: 'gestao', versao: '1.0.33' });
        const r = await rotaAvisoVersaoApp.executar(ctx({ perfil: 'gerente', modulos: ['core', 'vendedor'], versaoApp }, [], consultas));
        expect(r).toMatchObject({ variante: 'gestao', situacao: 'aviso', versao_publicada: '1.0.34' });
        expect(inserts(consultas)).toHaveLength(0);
    });
    it('RN-CORE-80: atual, bloqueada ou sem cabeçalho não grava nada', async () => {
        for (const [versaoApp, agora, situacao] of [
            [criarPortaVersaoAppMemoria(PUB, { variante: 'campo', versao: '1.0.34' }), undefined, 'atual'],
            [criarPortaVersaoAppMemoria(PUB, null), undefined, 'atual'],
            [undefined, undefined, 'atual'],
            [criarPortaVersaoAppMemoria(PUB, { variante: 'campo', versao: '1.0.33' }), new Date('2026-11-25T12:00:00.000Z'), 'bloqueada'],
        ]) {
            const consultas = [];
            const r = await rotaAvisoVersaoApp.executar(ctx({ versaoApp, agora }, [], consultas));
            expect(r).toMatchObject({ variante: 'campo', situacao });
            expect(inserts(consultas)).toHaveLength(0);
        }
    });
    it('RN-CORE-80: perfil sem app 403 APP_PERFIL_SEM_APP; cabeçalho de outra variante 403 APP_VARIANTE_DIFERENTE', async () => {
        const versaoApp = criarPortaVersaoAppMemoria(PUB, { variante: 'campo', versao: '1.0.33' });
        await expect(rotaAvisoVersaoApp.executar(ctx({ perfil: 'admin', versaoApp }))).rejects.toMatchObject({ status: 403, codigo: 'APP_PERFIL_SEM_APP' });
        await expect(rotaAvisoVersaoApp.executar(ctx({ perfil: 'gerente', versaoApp }))).rejects.toMatchObject({ status: 403, codigo: 'APP_VARIANTE_DIFERENTE' });
    });
});
