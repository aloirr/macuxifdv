import { describe, expect, it } from 'vitest';
import { AvisoVersaoAppRespostaSchema, CORPO_AVISO_VERSAO_APP } from '../contracts';
import { avisoDeVersaoApp, chaveDoAvisoDeVersaoApp } from './aviso-versao-app';

const PUBLICADA = { versao: '1.0.34', publicada_em: '2026-11-24T12:00:00.000Z' };
const AGORA = new Date('2026-11-24T20:00:00.000Z');
const campo = (versao: string) => ({ variante: 'campo' as const, versao });

describe('T-0195: aviso de versão nova do app (RN-CORE-80)', () => {
  it('RN-CORE-80: perfil sem app Android é recusado (admin, analista, assistente)', () => {
    for (const perfil of ['admin', 'analista', 'assistente'] as const) {
      expect(avisoDeVersaoApp({ perfil, doCliente: campo('1.0.33'), publicada: PUBLICADA, agora: AGORA })).toEqual({ tipo: 'perfil_sem_app' });
    }
  });

  it('RN-CORE-80: cabeçalho de outra variante que não a do perfil é recusado', () => {
    expect(avisoDeVersaoApp({ perfil: 'supervisor', doCliente: campo('1.0.33'), publicada: PUBLICADA, agora: AGORA })).toEqual({ tipo: 'variante_diferente', variante: 'gestao' });
  });

  it('RN-CORE-80: sem cabeçalho (app antigo, BKO) a situação é atual e nada é criado', () => {
    const r = avisoDeVersaoApp({ perfil: 'vendedor', doCliente: null, publicada: PUBLICADA, agora: AGORA });
    expect(r).toEqual({ tipo: 'situacao', resposta: { variante: 'campo', situacao: 'atual', versao_publicada: null, prazo_ate: null }, aviso: null });
  });

  it('RN-CORE-80: nas primeiras 24 h cria o aviso com o texto do designer-ux e expira no fim do prazo', () => {
    const r = avisoDeVersaoApp({ perfil: 'promotor', doCliente: campo('1.0.33'), publicada: PUBLICADA, agora: AGORA });
    expect(r).toEqual({
      tipo: 'situacao',
      resposta: { variante: 'campo', situacao: 'aviso', versao_publicada: '1.0.34', prazo_ate: '2026-11-25T12:00:00.000Z' },
      aviso: { chave: 'campo|1.0.34', titulo: 'Versão 1.0.34 disponível', corpo: CORPO_AVISO_VERSAO_APP, expira_em: '2026-11-25T12:00:00.000Z' },
    });
    if (r.tipo === 'situacao') expect(AvisoVersaoAppRespostaSchema.parse(r.resposta)).toEqual(r.resposta);
  });

  it('RN-CORE-80: hora da publicação desconhecida = aviso sem prazo e sem expiração', () => {
    const r = avisoDeVersaoApp({ perfil: 'gerente', doCliente: { variante: 'gestao', versao: '1.0.33' }, publicada: { versao: '1.0.34', publicada_em: null }, agora: AGORA });
    expect(r).toMatchObject({ resposta: { situacao: 'aviso', prazo_ate: null }, aviso: { chave: 'gestao|1.0.34', expira_em: null } });
  });

  it('RN-CORE-80: versão já atual ou nenhuma publicada não cria aviso', () => {
    expect(avisoDeVersaoApp({ perfil: 'vendedor', doCliente: campo('1.0.34'), publicada: PUBLICADA, agora: AGORA })).toMatchObject({ resposta: { situacao: 'atual', versao_publicada: '1.0.34', prazo_ate: null }, aviso: null });
    expect(avisoDeVersaoApp({ perfil: 'vendedor', doCliente: campo('1.0.35'), publicada: PUBLICADA, agora: AGORA })).toMatchObject({ resposta: { situacao: 'atual' }, aviso: null });
    expect(avisoDeVersaoApp({ perfil: 'vendedor', doCliente: campo('1.0.33'), publicada: null, agora: AGORA })).toMatchObject({ resposta: { situacao: 'atual', versao_publicada: null }, aviso: null });
  });

  it('RN-CORE-80: às 24h00 em ponto a situação é bloqueada e não cria aviso (o app mostra a tela de reinstalar)', () => {
    const r = avisoDeVersaoApp({ perfil: 'vendedor', doCliente: campo('1.0.33'), publicada: PUBLICADA, agora: new Date('2026-11-25T12:00:00.000Z') });
    expect(r).toMatchObject({ resposta: { situacao: 'bloqueada', prazo_ate: '2026-11-25T12:00:00.000Z' }, aviso: null });
  });

  it('RN-CORE-80: a chave de idempotência é (variante, versão publicada); o usuário entra na chave do banco', () => {
    expect(chaveDoAvisoDeVersaoApp('campo', '1.0.34')).toBe('campo|1.0.34');
    expect(chaveDoAvisoDeVersaoApp('gestao', '1.0.34')).not.toBe(chaveDoAvisoDeVersaoApp('campo', '1.0.34'));
  });
});
