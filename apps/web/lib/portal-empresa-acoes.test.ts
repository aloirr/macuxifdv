/**
 * Backup, Inativar e Excluir na lista de Empresas (ADR 0052; spec portal-config-enxuto §15; RN-PLA-07 a RN-PLA-09): o que a
 * coluna Backup mostra em cada estado da simulação `depois-02b`, quais itens do menu ficam ligados, a frase de cada recusa do
 * Excluir e o caminho das rotas do SDK.
 */
import { CODIGOS_ACOES_EMPRESA as C, MENSAGENS_ACOES_EMPRESA, type AcoesDaEmpresa, type BackupEmpresa } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { ErroPortal, MENSAGEM_PADRAO } from './portal-api';
import { celulaDoBackup, erroDoExcluir, estadoDasAcoes, rotaDaAcao, rotuloDoExcluir, rotuloDoStatus, tomDoStatus } from './portal-empresa-acoes';

const T = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const backup = (x: Partial<BackupEmpresa> = {}): BackupEmpresa => ({
  id: '7c0d5e1a-2b4f-4c6d-8e9f-000000000001',
  tenant_id: T,
  situacao: 'pronto',
  consistente: true,
  pedido_em: '2026-11-14T23:30:00.000Z',
  iniciado_em: '2026-11-14T23:30:00.000Z',
  concluido_em: '2026-11-14T23:40:00.000Z',
  expira_em: null,
  progresso_pct: 100,
  tamanho_bytes: 1000,
  tabelas: 1,
  linhas: 1,
  arquivos: 0,
  erro_codigo: null,
  ...x,
});
const andamento = backup({ situacao: 'em_andamento', concluido_em: null, progresso_pct: 40, tamanho_bytes: null });
const acoes = (x: Partial<AcoesDaEmpresa> = {}): AcoesDaEmpresa => ({ inativada_em: null, motivo_inativacao: null, ultimo_backup: null, exclusao: null, exclusao_bloqueada: null, ...x });
const FUSO = 'America/Manaus';

describe('coluna Backup (§15.1): data, "Em andamento" ou "Nenhum"; o motivo do Excluir desabilitado só no item do menu (RD-1205)', () => {
  it.each([
    ['ativa, com backup', acoes({ ultimo_backup: backup(), exclusao_bloqueada: C.exclusaoEmpresaAtiva }), '14/11/2026 19:40', false, 'Excluir (inative antes)'],
    ['ativa, sem backup', acoes({ exclusao_bloqueada: C.exclusaoEmpresaAtiva }), 'Nenhum', false, 'Excluir (inative antes)'],
    ['ativa, backup em andamento', acoes({ ultimo_backup: andamento, exclusao_bloqueada: C.exclusaoEmpresaAtiva }), 'Em andamento', true, 'Excluir (inative antes)'],
    ['inativa, backup em andamento', acoes({ ultimo_backup: andamento, exclusao_bloqueada: C.exclusaoSemBackup }), 'Em andamento', true, 'Excluir'],
    ['inativa, sem backup', acoes({ exclusao_bloqueada: C.exclusaoSemBackup }), 'Nenhum', false, 'Excluir'],
    ['inativa, anterior à inativação', acoes({ ultimo_backup: backup(), exclusao_bloqueada: C.exclusaoBackupAntesDaInativacao }), '14/11/2026 19:40', false, 'Excluir (backup anterior à inativação)'],
    ['inativa, vencido', acoes({ ultimo_backup: backup(), exclusao_bloqueada: C.exclusaoBackupVencido }), '14/11/2026 19:40', false, 'Excluir (backup vencido)'],
    ['inativa, válido', acoes({ ultimo_backup: backup() }), '14/11/2026 19:40', false, 'Excluir'],
  ])('%s', (_n, a, texto, giro, rotulo) => {
    expect(celulaDoBackup(a, FUSO)).toEqual({ texto, andamento: giro });
    expect(rotuloDoExcluir(a)).toBe(rotulo);
  });
  it('o clique em Backup põe a linha em "Em andamento" antes da resposta', () => {
    expect(celulaDoBackup(acoes({ ultimo_backup: backup() }), FUSO, true).texto).toBe('Em andamento');
  });
  it('a data sai no fuso da empresa', () => {
    expect(celulaDoBackup(acoes({ ultimo_backup: backup() }), 'America/Sao_Paulo').texto).toBe('14/11/2026 20:40');
  });
});

describe('itens do menu (§15.1)', () => {
  it('ativa: Inativar; Excluir desligado enquanto `exclusao_bloqueada` não for nulo', () => {
    expect(estadoDasAcoes('ativo', acoes({ exclusao_bloqueada: C.exclusaoEmpresaAtiva }))).toEqual({ backupLigado: true, situacao: 'inativar', situacaoLigada: true, excluirLigado: false });
  });
  it('inativa com backup válido: Reativar e Excluir liberado', () => {
    expect(estadoDasAcoes('suspenso', acoes({ ultimo_backup: backup() }))).toEqual({ backupLigado: true, situacao: 'reativar', situacaoLigada: true, excluirLigado: true });
  });
  it('backup em andamento (ou pedido agora): Backup e Excluir desligados', () => {
    const e = estadoDasAcoes('suspenso', acoes({ ultimo_backup: andamento }));
    expect([e.backupLigado, e.excluirLigado, e.situacaoLigada]).toEqual([false, false, true]);
    expect(estadoDasAcoes('suspenso', acoes({ ultimo_backup: backup() }), { pedindoBackup: true }).excluirLigado).toBe(false);
  });
  it('reativando: Reativar e Excluir desligados', () => {
    const e = estadoDasAcoes('suspenso', acoes({ ultimo_backup: backup() }), { ocupada: true });
    expect([e.situacaoLigada, e.excluirLigado]).toEqual([false, false]);
  });
  it('em exclusão: nada liga e não há Inativar nem Reativar', () => {
    expect(estadoDasAcoes('encerrado', acoes({ exclusao_bloqueada: C.exclusaoEmAndamento }))).toEqual({ backupLigado: false, situacao: null, situacaoLigada: false, excluirLigado: false });
  });
});

describe('recusas do Excluir (§15.2, RD-0407)', () => {
  const e = (status: number, codigo: string, msg = 'Frase da API.') => erroDoExcluir(new ErroPortal(status, codigo, msg));
  it('recusas da regra e do código: uma linha com a frase que a API devolve, sem marcar a senha', () => {
    for (const c of [C.exclusaoSemBackup, C.exclusaoBackupAntesDaInativacao, C.exclusaoBackupVencido, C.exclusaoEmpresaAtiva, C.exclusaoCodigoNaoConfere])
      expect(e(422, c)).toEqual({ tipo: 'linha', texto: 'Frase da API.', senha: false });
  });
  it('senha errada: a frase da API e o campo senha marcado', () => {
    const senha = MENSAGENS_ACOES_EMPRESA[C.reautenticacaoFalhou];
    expect(e(403, C.reautenticacaoFalhou, senha)).toEqual({ tipo: 'linha', texto: senha, senha: true });
  });
  it('texto técnico da API vira a mensagem padrão', () => {
    expect(e(422, C.exclusaoCodigoNaoConfere, '{"x":1}')).toEqual({ tipo: 'linha', texto: MENSAGEM_PADRAO, senha: false });
  });
  it('outro erro, ou código com o status trocado, vai para o bloco padrão', () => {
    expect(e(409, C.exclusaoEmAndamento)).toEqual({ tipo: 'bloco' });
    expect(e(422, C.reautenticacaoFalhou)).toEqual({ tipo: 'bloco' });
    expect(e(403, C.exclusaoCodigoNaoConfere)).toEqual({ tipo: 'bloco' });
    expect(e(422, 'toString')).toEqual({ tipo: 'bloco' });
    expect(e(0, 'sem_conexao')).toEqual({ tipo: 'bloco' });
    expect(erroDoExcluir(new Error('x'))).toEqual({ tipo: 'bloco' });
  });
});

describe('rotas e situação', () => {
  it('caminho relativo ao /v1, com o tenant e o backup', () => {
    expect(rotaDaAcao('inativar', T)).toBe(`/plataforma/empresas/${T}/inativar`);
    expect(rotaDaAcao('backup', T, 'b1')).toBe(`/plataforma/empresas/${T}/backups/b1`);
    expect(rotaDaAcao('exclusao', T)).toBe(`/plataforma/empresas/${T}/exclusao`);
  });
  it('selo: "Ativa" verde, "Inativa" neutro', () => {
    expect([rotuloDoStatus('ativo'), tomDoStatus('ativo')]).toEqual(['Ativa', 'success']);
    expect([rotuloDoStatus('suspenso'), tomDoStatus('suspenso')]).toEqual(['Inativa', 'neutral']);
  });
});
