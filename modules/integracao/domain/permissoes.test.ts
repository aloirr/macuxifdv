import { PERFIS } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import manifest from '../manifest';
import { autorizarAcaoIntegracao, PERFIS_ACAO_INTEGRACAO, type AcaoIntegracao } from './permissoes';

describe('P-3: quem faz o quê no BKO da Integração', () => {
  it('P-3 / RN-INT-10: gestão de Conector e chaves de API é só do admin', () => {
    expect(autorizarAcaoIntegracao('conector.gerenciar', 'admin')).toEqual({ ok: true });
    for (const perfil of ['analista', 'supervisor', 'vendedor', 'gerente', 'promotor', 'assistente'] as const) {
      const r = autorizarAcaoIntegracao('conector.gerenciar', perfil);
      expect(r).toMatchObject({ ok: false, status: 403, codigo: 'perfil_sem_acesso' });
      if (!r.ok) expect(r.mensagem).toMatch(/Só o administrador/);
    }
  });

  it('P-3 / RN-INT-06: confirmação da inativação em massa é de admin e analista; supervisor e vendedor são negados', () => {
    expect(autorizarAcaoIntegracao('inativacao.decidir', 'admin')).toEqual({ ok: true });
    expect(autorizarAcaoIntegracao('inativacao.decidir', 'analista')).toEqual({ ok: true });
    for (const perfil of ['supervisor', 'vendedor', 'gerente', 'promotor', 'assistente'] as const) {
      expect(autorizarAcaoIntegracao('inativacao.decidir', perfil)).toMatchObject({ ok: false, status: 403, codigo: 'perfil_sem_acesso' });
    }
  });

  it('P-3: a tabela do domain é a mesma do manifesto (a rota e o caso de uso nunca divergem)', () => {
    const doManifesto = Object.fromEntries(Object.entries(manifest.acoes).map(([acao, a]) => [acao, [...a.perfis].sort()]));
    const doDomain = Object.fromEntries(Object.entries(PERFIS_ACAO_INTEGRACAO).map(([acao, p]) => [acao, [...p].sort()]));
    expect(doDomain).toEqual(doManifesto);
  });

  it('RN-PRO-01: nenhum perfil de campo nem o assistente passa em ação alguma do Hub', () => {
    for (const acao of Object.keys(PERFIS_ACAO_INTEGRACAO) as AcaoIntegracao[]) {
      for (const perfil of PERFIS.filter((p) => p !== 'admin' && p !== 'analista')) {
        expect(autorizarAcaoIntegracao(acao, perfil).ok).toBe(false);
      }
    }
  });
});
