import { criarServicoPacotesMemoria, SERVICO_PACOTES_DESLIGADO, type ContextoRota, type ModuloId } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { LinkDownloadAppSchema } from '../contracts';
import { rotaDownloadApp } from './apps-download';

const CAMPO = { versao: '1.0.19', arquivo: 'Campo-Oficial-v1.0.19.apk', sha256: 'b'.repeat(64), tamanho_bytes: 1000 };

/** `modulos` = módulos ATIVOS DO TENANT; o usuário é admin de fábrica (perfil só com Core). */
function ctx(pacotes: unknown, variante: string, modulos: ModuloId[], auditorias: unknown[] = [], logs: unknown[] = []) {
  return {
    usuario: { id: 'u1', tenant_id: 't1', perfil: 'admin', modulos: ['core'] },
    corpo: { variante },
    pacotes,
    log: { info: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a), error: (...a: unknown[]) => logs.push(a) },
    comTenant: async (fn: (d: unknown, t: unknown) => unknown) => fn({ query: async () => ({ rows: modulos.map((modulo) => ({ modulo })) }) }, { auditar: async (a: unknown) => { auditorias.push(a); } }),
  } as unknown as ContextoRota;
}

describe('T-0190: download do APK (RN-CORE-67)', () => {
  it('RN-CORE-67: só admin (app.baixar), super-admin aceito, no BKO, sem carteira, sem cache', () => {
    expect(rotaDownloadApp).toMatchObject({ metodo: 'POST', caminho: 'apps/download', acao: 'app.baixar', superAdmin: 'aceita', superficie: 'bko', carteira: 'nao_se_aplica', semCache: true });
    expect(manifest.acoes['app.baixar']?.perfis).toEqual(['admin']);
  });

  it('RN-CORE-67: 200 com o link do Campo pelo schema e auditoria sem a URL', async () => {
    const auditorias: unknown[] = [];
    const r = await rotaDownloadApp.executar(ctx(criarServicoPacotesMemoria({ campo: CAMPO }), 'campo', ['core', 'vendedor'], auditorias) as never);
    expect(LinkDownloadAppSchema.parse(r)).toEqual(r);
    expect(r).toMatchObject({ variante: 'campo', versao: '1.0.19', arquivo: CAMPO.arquivo });
    expect(auditorias).toEqual([{ acao: 'core.app_download_link', entidade: 'app_pacote', entidade_id: null, depois: { variante: 'campo', versao: '1.0.19', arquivo: CAMPO.arquivo } }]);
    expect(JSON.stringify(auditorias)).not.toContain('http');
  });

  it('RN-CORE-67: Gestão com o módulo gestor sai; cada variante lê a própria pasta', async () => {
    const pacotes = criarServicoPacotesMemoria({ campo: CAMPO, gestao: { versao: '1.0.19', arquivo: 'Gestao-Oficial-v1.0.19.apk' } });
    const r = await rotaDownloadApp.executar(ctx(pacotes, 'gestao', ['core', 'gestor']) as never);
    expect(r).toMatchObject({ variante: 'gestao', arquivo: 'Gestao-Oficial-v1.0.19.apk' });
  });

  it('RN-CORE-67: sem licença do módulo do app responde 403 APP_SEM_LICENCA e não audita nem assina link', async () => {
    const auditorias: unknown[] = [];
    const pacotes = criarServicoPacotesMemoria({ campo: CAMPO, gestao: { versao: '1.0.19', arquivo: 'Gestao-Oficial-v1.0.19.apk' } });
    await expect(rotaDownloadApp.executar(ctx(pacotes, 'campo', ['core', 'gestor'], auditorias) as never)).rejects.toMatchObject({ status: 403, codigo: 'APP_SEM_LICENCA' });
    await expect(rotaDownloadApp.executar(ctx(pacotes, 'gestao', ['core', 'vendedor'], auditorias) as never)).rejects.toMatchObject({ status: 403, codigo: 'APP_SEM_LICENCA' });
    expect(auditorias).toHaveLength(0);
  });

  it('RN-CORE-67: sem pacote publicado responde 404 APP_SEM_PACOTE e não audita', async () => {
    const auditorias: unknown[] = [];
    await expect(rotaDownloadApp.executar(ctx(criarServicoPacotesMemoria({}), 'campo', ['core', 'promotor'], auditorias) as never)).rejects.toMatchObject({ status: 404, codigo: 'APP_SEM_PACOTE' });
    expect(auditorias).toHaveLength(0);
  });

  it('RN-CORE-67: sem S3 responde 503 ARMAZENAMENTO_INDISPONIVEL', async () => {
    await expect(rotaDownloadApp.executar(ctx(SERVICO_PACOTES_DESLIGADO, 'campo', ['core', 'vendedor']) as never)).rejects.toMatchObject({ status: 503, codigo: 'ARMAZENAMENTO_INDISPONIVEL' });
    await expect(rotaDownloadApp.executar(ctx(undefined, 'campo', ['core', 'vendedor']) as never)).rejects.toMatchObject({ status: 503 });
  });

  it('RN-CORE-67: variante fora da lista é recusada pelo corpo e o contrato é estrito', () => {
    const corpo = rotaDownloadApp.corpo as { safeParse: (v: unknown) => { success: boolean } };
    expect(corpo.safeParse({ variante: 'conector' }).success).toBe(false);
    expect(corpo.safeParse({ variante: 'campo', tenant_id: 'x' }).success).toBe(false);
    expect(corpo.safeParse({ variante: 'gestao' }).success).toBe(true);
  });
});
