import { describe, expect, it } from 'vitest';
import { criarPermissoes } from '@macuxi/platform-sdk';
import manifest from './manifest';

const ativos = ['core', 'treinamento'] as const;
const permissoes = criarPermissoes([manifest]);
const pode = (acao: string, perfil: Parameters<typeof permissoes.pode>[1]['perfil']) => permissoes.pode(acao, { perfil, modulosAtivos: ativos });

describe('manifesto do treinamento', () => {
  it('é válido no platform-sdk, publica licao/medalha e consome pedido.criado como opcional', () => {
    expect(manifest.id).toBe('treinamento');
    expect(manifest.publica).toContain('treinamento.licao.concluida@1');
    expect(manifest.publica).toContain('treinamento.medalha.conquistada@1');
    expect(manifest.consome).toContain('vendedor.pedido.criado@1');
    expect(manifest.opcionais).toContain('vendedor');
  });

  it('publica exatamente os dois eventos do doc 02', () => {
    expect([...manifest.publica].sort()).toEqual(['treinamento.licao.concluida@1', 'treinamento.medalha.conquistada@1']);
  });

  it('doc 03 §2: criar/editar/publicar trilha só analista e admin', () => {
    for (const acao of ['trilha.criar', 'trilha.editar', 'trilha.publicar', 'quiz.gerenciar', 'desafio.gerenciar', 'medalha.gerenciar']) {
      expect(pode(acao, 'analista'), `${acao} analista`).toBe(true);
      expect(pode(acao, 'admin'), `${acao} admin`).toBe(true);
      for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente', 'assistente'] as const) expect(pode(acao, perfil), `${acao} ${perfil}`).toBe(false);
    }
  });

  it('RN-TRE-02/04: vendedor, promotor, supervisor e gerente concluem lição, respondem quiz e baixam trilha; BKO não "estuda"', () => {
    for (const acao of ['licao.concluir', 'quiz.responder', 'trilha.baixar_offline']) {
      for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente'] as const) expect(pode(acao, perfil), `${acao} ${perfil}`).toBe(true);
      for (const perfil of ['analista', 'assistente', 'admin'] as const) expect(pode(acao, perfil), `${acao} ${perfil}`).toBe(false);
    }
  });

  it('RF-TRE-04 / RN-TRE-03: o ranking é visto pelo aluno e pelo BKO (analista, admin), nunca pelo assistente', () => {
    for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'] as const) expect(pode('ranking.ver', perfil)).toBe(true);
    expect(pode('ranking.ver', 'assistente')).toBe(false);
  });

  it('RF-TRE-05: adesão e notas só para supervisor, gerente, analista e admin — vendedor e promotor não veem a dos colegas', () => {
    for (const acao of ['adesao.ver', 'notas.ver']) {
      for (const perfil of ['supervisor', 'gerente', 'analista', 'admin'] as const) expect(pode(acao, perfil), `${acao} ${perfil}`).toBe(true);
      for (const perfil of ['vendedor', 'promotor', 'assistente'] as const) expect(pode(acao, perfil), `${acao} ${perfil}`).toBe(false);
    }
  });

  it('RN-CORE-02: com o módulo desativado, nenhuma ação é permitida', () => {
    expect(permissoes.pode('licao.concluir', { perfil: 'vendedor', modulosAtivos: ['core'] })).toBe(false);
  });

  it('RN-PRO-01: o Treinamento não tem nenhuma ação de pedido', () => {
    expect(Object.keys(manifest.acoes).filter((a) => /pedido/i.test(a))).toEqual([]);
  });

  it('toda entidade de sync citada existe no schema treinamento do doc 04', () => {
    const doc04 = ['trilha', 'modulo_trilha', 'licao', 'quiz', 'questao', 'alternativa', 'publico_alvo', 'progresso', 'tentativa', 'xp_lancamento', 'medalha', 'medalha_usuario', 'ranking_periodo'];
    expect(manifest.sync.filter((s) => !doc04.includes(s))).toEqual([]);
  });
});
