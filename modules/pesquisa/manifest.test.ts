import { describe, expect, it } from 'vitest';
import { criarPermissoes } from '@macuxi/platform-sdk';
import manifest from './manifest';

const ativos = ['core', 'pesquisa'] as const;
const permissoes = criarPermissoes([manifest]);
const pode = (acao: string, perfil: Parameters<typeof permissoes.pode>[1]['perfil']) => permissoes.pode(acao, { perfil, modulosAtivos: ativos });
const CAMPO = ['vendedor', 'promotor', 'supervisor', 'gerente'] as const;
const CADASTRO = ['analista', 'admin'] as const;

describe('manifesto da pesquisa', () => {
  it('é válido no platform-sdk e usa visita.etapas_checkout e cliente.abas', () => {
    expect(manifest.id).toBe('pesquisa');
    expect(manifest.usaExtensoes).toEqual(expect.arrayContaining(['visita.etapas_checkout', 'cliente.abas']));
  });

  it('T-0170: oferece as três consultas (checkout, questionários para a tarefa e resposta local)', () => {
    expect([...manifest.ofereceConsultas]).toEqual(['pesquisa.etapas_checkout@1', 'pesquisa.questionarios_para_tarefa@1', 'pesquisa.resposta_local@1']);
  });

  it('publica pesquisa.resposta.registrada@1 (doc 02) e só ele', () => {
    expect(manifest.publica).toContain('pesquisa.resposta.registrada@1');
    expect([...manifest.publica]).toEqual(['pesquisa.resposta.registrada@1']);
  });

  it('doc 03 §2 "Criar pesquisa": criar, editar, publicar e arquivar questionário só analista e admin', () => {
    for (const acao of ['questionario.criar', 'questionario.editar', 'questionario.publicar', 'questionario.arquivar']) {
      for (const perfil of CADASTRO) expect(pode(acao, perfil), `${acao} ${perfil}`).toBe(true);
      for (const perfil of [...CAMPO, 'assistente'] as const) expect(pode(acao, perfil), `${acao} ${perfil}`).toBe(false);
    }
  });

  it('doc 03 §2 "Responder pesquisa": vendedor, promotor, supervisor e gerente; BKO não responde', () => {
    for (const perfil of CAMPO) expect(pode('pesquisa.responder', perfil), perfil).toBe(true);
    for (const perfil of ['analista', 'assistente', 'admin'] as const) expect(pode('pesquisa.responder', perfil), perfil).toBe(false);
  });

  it('RF-PES-06: resultados e exportação para a gestão (supervisor, gerente) e o BKO (analista, admin); vendedor, promotor e assistente não', () => {
    for (const acao of ['resultado.ver', 'resultado.exportar']) {
      for (const perfil of ['supervisor', 'gerente', 'analista', 'admin'] as const) expect(pode(acao, perfil), `${acao} ${perfil}`).toBe(true);
      for (const perfil of ['vendedor', 'promotor', 'assistente'] as const) expect(pode(acao, perfil), `${acao} ${perfil}`).toBe(false);
    }
  });

  it('RN-CORE-02: com o módulo desativado nenhuma ação é permitida', () => {
    expect(permissoes.pode('pesquisa.responder', { perfil: 'vendedor', modulosAtivos: ['core'] })).toBe(false);
    expect(permissoes.acoesPermitidas({ perfil: 'analista', modulosAtivos: ['core'] })).toEqual([]);
  });

  it('ação desconhecida é negada (falha fechada)', () => {
    expect(pode('questionario.apagar', 'admin')).toBe(false);
  });

  it('o módulo aparece para todos os perfis que têm alguma ação nele', () => {
    for (const perfil of [...CAMPO, ...CADASTRO]) expect(manifest.perfis).toContain(perfil);
  });
});
