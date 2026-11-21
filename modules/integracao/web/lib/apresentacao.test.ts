import { describe, expect, it } from 'vitest';
import { ENTIDADES, ESTADOS_LOTE_BKO } from '../../contracts';
import { ROTULO_ENTIDADE, rotuloDoLote, perfilDaSessao, podeExecutar, textoDoFimDoLote } from './apresentacao';

describe('rótulos do monitor (todo valor do contrato tem texto em português)', () => {
  it('cobre o status do lote e a entidade', () => {
    for (const s of ESTADOS_LOTE_BKO) expect(rotuloDoLote(s), s).toBeTruthy();
    for (const e of ENTIDADES) expect(ROTULO_ENTIDADE[e], e).toBeTruthy();
  });
});

describe('perfil da sessão', () => {
  it('aceita só perfis conhecidos', () => {
    expect(perfilDaSessao('admin')).toBe('admin');
    expect(perfilDaSessao('analista')).toBe('analista');
    expect(perfilDaSessao('')).toBeNull();
    expect(perfilDaSessao('root')).toBeNull();
    expect(perfilDaSessao(undefined)).toBeNull();
  });
});

describe('P-3: permissões refletidas na UI (a proteção real é na API)', () => {
  it('P-3: monitor e inativação para admin e analista; Conector e chave só admin', () => {
    expect(podeExecutar('monitor.ver', 'admin')).toBe(true);
    expect(podeExecutar('monitor.ver', 'analista')).toBe(true);
    expect(podeExecutar('inativacao.decidir', 'analista')).toBe(true);
    expect(podeExecutar('conector.gerenciar', 'analista')).toBe(false);
    expect(podeExecutar('conector.gerenciar', 'admin')).toBe(true);
  });

  it('P-3 / RN-PRO-01: perfis de campo e o assistente nunca agem no Hub; sem perfil, nada', () => {
    for (const p of ['vendedor', 'promotor', 'supervisor', 'gerente', 'assistente'] as const) {
      expect(podeExecutar('monitor.ver', p), p).toBe(false);
      expect(podeExecutar('inativacao.decidir', p), p).toBe(false);
    }
    expect(podeExecutar('monitor.ver', null)).toBe(false);
  });
});

describe('texto do fim do lote no popup (fuso do tenant)', () => {
  const tz = 'America/Manaus';
  it('lote que falhou mostra "falhou em dd/mm/aaaa hh:mm"', () => {
    const t = textoDoFimDoLote({ status: 'falhou', concluido_em: '2026-11-20T18:31:00Z' }, tz);
    expect(t).toBe('falhou em 20/11/2026 14:31');
  });
  it('virada do dia e do ano UTC → Manaus: 03:59Z de 01/01 vira 23:59 de 31/12', () => {
    expect(textoDoFimDoLote({ status: 'falhou', concluido_em: '2027-01-01T03:59:00Z' }, tz)).toBe('falhou em 31/12/2026 23:59');
  });
  it('os demais ficam como antes', () => {
    expect(textoDoFimDoLote({ status: 'concluido', concluido_em: '2026-11-20T18:31:00Z' }, tz)).toBe('concluído 20/11 às 14:31');
    expect(textoDoFimDoLote({ status: 'concluido', concluido_em: null }, tz)).toBe('ainda não concluído');
    expect(textoDoFimDoLote({ status: 'falhou', concluido_em: null }, tz)).toBe('ainda não concluído');
  });
});
