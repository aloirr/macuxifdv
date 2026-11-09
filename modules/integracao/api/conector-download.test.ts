import { describe, expect, it } from 'vitest';
import { criarServicoPacotesMemoria, SERVICO_PACOTES_DESLIGADO, type ContextoRota } from '@macuxi/platform-sdk';
import { rotaDownloadConector } from './conector-download';
import { LinkDownloadConectorSchema } from '../contracts';

const PACOTE = { versao: '1.2.3', arquivo: 'macuxi-conector-1.2.3-win-x64.zip', sha256: 'a'.repeat(64), tamanho_bytes: 1000, publicado_em: '2026-11-09T10:00:00Z' };

function ctx(pacotes: unknown, auditorias: unknown[] = [], logs: unknown[] = []) {
  return {
    usuario: { id: 'u1', tenant_id: 't1', perfil: 'admin' },
    pacotes,
    log: { info: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a), error: (...a: unknown[]) => logs.push(a), debug: (...a: unknown[]) => logs.push(a) },
    comTenant: async (fn: (d: unknown, t: unknown) => unknown) => fn({}, { auditar: async (a: unknown) => { auditorias.push(a); } }),
  } as unknown as ContextoRota;
}

describe('T-0098: download do Conector', () => {
  it('T-0098: só admin (conector.gerenciar), super-admin aceito, sem carteira', () => {
    expect(rotaDownloadConector).toMatchObject({ metodo: 'POST', caminho: 'conector/download', acao: 'conector.gerenciar', superAdmin: 'aceita', carteira: 'nao_se_aplica' });
  });

  it('T-0098: devolve o link pelo schema do contrato (sem publicado_em) e audita só versão e arquivo, sem a URL', async () => {
    const auditorias: unknown[] = [];
    const r = await rotaDownloadConector.executar(ctx(criarServicoPacotesMemoria({ conector: PACOTE }), auditorias) as never);
    expect(LinkDownloadConectorSchema.parse(r)).toEqual(r);
    expect(r).not.toHaveProperty('publicado_em');
    expect(r).toMatchObject({ versao: '1.2.3', arquivo: PACOTE.arquivo });
    expect(auditorias).toEqual([{ acao: 'conector.download_link', entidade: 'conector_pacote', entidade_id: null, depois: { versao: '1.2.3', arquivo: PACOTE.arquivo } }]);
    expect(JSON.stringify(auditorias)).not.toContain('https://');
  });

  it('T-0098: sem pacote publicado responde 404 CONECTOR_SEM_PACOTE e não audita', async () => {
    const auditorias: unknown[] = [];
    await expect(rotaDownloadConector.executar(ctx(criarServicoPacotesMemoria({}), auditorias) as never)).rejects.toMatchObject({ status: 404, codigo: 'CONECTOR_SEM_PACOTE' });
    expect(auditorias).toHaveLength(0);
  });

  it('T-0098: sem S3 responde 503 ARMAZENAMENTO_INDISPONIVEL', async () => {
    await expect(rotaDownloadConector.executar(ctx(SERVICO_PACOTES_DESLIGADO) as never)).rejects.toMatchObject({ status: 503, codigo: 'ARMAZENAMENTO_INDISPONIVEL' });
    await expect(rotaDownloadConector.executar(ctx(undefined) as never)).rejects.toMatchObject({ status: 503 });
  });
});
