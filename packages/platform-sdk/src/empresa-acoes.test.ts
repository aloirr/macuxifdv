/** ADR 0052: contratos e regras das ações da empresa no portal (Inativar/Reativar, Backup, Excluir; RN-PLA-07..11). */
import { describe, expect, it } from 'vitest';
import {
  AcoesDaEmpresaSchema,
  BackupEmpresaSchema,
  CODIGOS_ACOES_EMPRESA as C,
  codigoDeConfirmacaoConfere,
  conferirExclusao,
  EVENTOS_TENANT,
  ExcluirEmpresaSchema,
  ExclusaoEmpresaSchema,
  InativarEmpresaSchema,
  ManifestoBackupEmpresaSchema,
  MENSAGEM_SO_SUPER_ADMIN_ACOES,
  MENSAGENS_ACOES_EMPRESA,
  parteDaTabela,
  PRAZO_BACKUP_PARA_EXCLUIR_DIAS,
  prefixoDoBackupEmpresa,
  ROTULO_STATUS_EMPRESA,
  SituacaoEmpresaRespostaSchema,
  transicaoDeSituacao,
  type BackupParaExclusao,
} from './empresa-acoes';
import { EmpresaResumoSchema } from './plataforma';

const T = '7a000000-0000-4000-8000-000000000001';
const OUTRO = '7a000000-0000-4000-8000-000000000002';
const B = '7b000000-0000-4000-8000-000000000001';
const DIA = 86_400_000;
const inativada = new Date('2026-11-10T12:00:00Z');
const agora = new Date('2026-11-14T23:56:00Z');
const empresa = { id: T, status: 'suspenso' as const, inativada_em: inativada };
const backup = (b: Partial<BackupParaExclusao> = {}): BackupParaExclusao => ({
  tenant_id: T,
  situacao: 'pronto',
  consistente: true,
  iniciado_em: new Date(inativada.getTime() + 60_000),
  concluido_em: new Date(inativada.getTime() + 600_000),
  ...b,
});
const backupJson = {
  id: B,
  tenant_id: T,
  situacao: 'pronto',
  consistente: true,
  pedido_em: '2026-11-10T12:01:00Z',
  iniciado_em: '2026-11-10T12:01:05Z',
  concluido_em: '2026-11-10T12:10:00Z',
  expira_em: '2026-12-10T12:10:00Z',
  progresso_pct: 100,
  tamanho_bytes: 123_456,
  tabelas: 115,
  linhas: 1802,
  arquivos: 40,
  erro_codigo: null,
};

describe('RN-PLA-07: inativar e reativar', () => {
  it('RD-0454: o 403 do admin do cliente tem uma frase só, a do SDK', () => {
    expect(MENSAGEM_SO_SUPER_ADMIN_ACOES).toBe('Só o time da Macuxi faz esta ação.');
  });

  it('inativa = status suspenso, com o rótulo "Inativa" no portal; o valor do banco não muda', () => {
    expect(ROTULO_STATUS_EMPRESA.suspenso).toBe('Inativa');
    expect(ROTULO_STATUS_EMPRESA.ativo).toBe('Ativa');
  });
  it('transição idempotente: repetir dá sem_mudanca; empresa em exclusão recusa as duas', () => {
    expect(transicaoDeSituacao('ativo', 'inativar')).toBe('alterado');
    expect(transicaoDeSituacao('suspenso', 'inativar')).toBe('sem_mudanca');
    expect(transicaoDeSituacao('suspenso', 'reativar')).toBe('alterado');
    expect(transicaoDeSituacao('ativo', 'reativar')).toBe('sem_mudanca');
    expect(transicaoDeSituacao('encerrado', 'inativar')).toBe('recusado');
    expect(transicaoDeSituacao('encerrado', 'reativar')).toBe('recusado');
  });
  it('inativar sem motivo: corpo vazio ou motivo nulo', () => {
    expect(InativarEmpresaSchema.parse({})).toEqual({});
    expect(InativarEmpresaSchema.parse({ motivo: null })).toEqual({ motivo: null });
  });
  it('motivo, quando vem, só de lista (sem texto livre); chave extra recusada', () => {
    expect(InativarEmpresaSchema.parse({ motivo: 'inadimplencia' })).toEqual({ motivo: 'inadimplencia' });
    expect(InativarEmpresaSchema.safeParse({ motivo: 'cliente João não pagou' }).success).toBe(false);
    expect(InativarEmpresaSchema.safeParse({ motivo: 'outro', obs: 'x' }).success).toBe(false);
  });
  it('resposta: inativada_em só na empresa inativa; motivo opcional, só nela', () => {
    const ok = {
      tenant_id: T,
      status: 'suspenso',
      inativada_em: '2026-11-10T12:00:00Z',
      motivo: 'outro',
      resultado: 'alterado',
    };
    expect(SituacaoEmpresaRespostaSchema.safeParse(ok).success).toBe(true);
    expect(SituacaoEmpresaRespostaSchema.safeParse({ ...ok, status: 'ativo' }).success).toBe(false);
    expect(
      SituacaoEmpresaRespostaSchema.safeParse({ ...ok, status: 'ativo', inativada_em: null, motivo: null })
        .success,
    ).toBe(true);
    expect(SituacaoEmpresaRespostaSchema.safeParse({ ...ok, motivo: null }).success).toBe(true);
    expect(SituacaoEmpresaRespostaSchema.safeParse({ ...ok, inativada_em: null }).success).toBe(false);
    expect(
      SituacaoEmpresaRespostaSchema.safeParse({ ...ok, status: 'ativo', inativada_em: null }).success,
    ).toBe(false);
  });
});

describe('RN-PLA-08: backup da empresa', () => {
  it('pronto tem concluido_em, tamanho e 100%; falhou tem erro_codigo; em andamento sem concluido_em', () => {
    expect(BackupEmpresaSchema.safeParse(backupJson).success).toBe(true);
    expect(BackupEmpresaSchema.safeParse({ ...backupJson, progresso_pct: 90 }).success).toBe(false);
    expect(BackupEmpresaSchema.safeParse({ ...backupJson, situacao: 'falhou' }).success).toBe(false);
    expect(
      BackupEmpresaSchema.safeParse({ ...backupJson, situacao: 'falhou', erro_codigo: 'S3_FALHOU' }).success,
    ).toBe(true);
    expect(BackupEmpresaSchema.safeParse({ ...backupJson, erro_codigo: 'S3_FALHOU' }).success).toBe(false);
    expect(
      BackupEmpresaSchema.safeParse({ ...backupJson, situacao: 'em_andamento', progresso_pct: 40 }).success,
    ).toBe(false);
    expect(
      BackupEmpresaSchema.safeParse({
        ...backupJson,
        situacao: 'em_andamento',
        progresso_pct: 40,
        concluido_em: null,
        tamanho_bytes: null,
      }).success,
    ).toBe(true);
  });
  it('erro_codigo é código técnico, nunca mensagem', () => {
    expect(
      BackupEmpresaSchema.safeParse({
        ...backupJson,
        situacao: 'falhou',
        erro_codigo: 'falhou ao ler cliente Fulano',
      }).success,
    ).toBe(false);
  });
  it('lugar no bucket: backups-empresas/<tenant>/<backup>/, fora de backups/ e arquivos/', () => {
    expect(prefixoDoBackupEmpresa(T.toUpperCase(), B)).toBe(`backups-empresas/${T}/${B}/`);
    expect(() => prefixoDoBackupEmpresa('../x', B)).toThrow();
    expect(parteDaTabela('core.cliente')).toBe('dados/core.cliente.ndjson.gz.cifrado');
    expect(() => parteDaTabela('core.cliente/../../x')).toThrow();
  });
  it('manifesto: formato fechado, plataforma.tenant obrigatória, partes no formato, sem tabela repetida', () => {
    const tabela = (t: string) => ({
      tabela: t,
      linhas: 1,
      parte: parteDaTabela(t),
      bytes: 10,
      sha256: 'a'.repeat(64),
    });
    const m = {
      formato: 'macuxi-backup-empresa',
      versao_formato: 1,
      backup_id: B,
      tenant_id: T,
      codigo: 'AM4821',
      migracao: '0069',
      criado_em: '2026-11-10T12:01:05Z',
      consistente: true,
      cifra: { algoritmo: 'aes-256-gcm', chave_id: 'backup-2026-11' },
      tabelas: [tabela('plataforma.tenant'), tabela('core.cliente')],
      arquivos: { quantidade: 0, bytes: 0 },
    };
    expect(ManifestoBackupEmpresaSchema.safeParse(m).success).toBe(true);
    expect(ManifestoBackupEmpresaSchema.safeParse({ ...m, tabelas: [tabela('core.cliente')] }).success).toBe(
      false,
    );
    expect(
      ManifestoBackupEmpresaSchema.safeParse({ ...m, tabelas: [...m.tabelas, tabela('core.cliente')] })
        .success,
    ).toBe(false);
    expect(
      ManifestoBackupEmpresaSchema.safeParse({
        ...m,
        tabelas: [{ ...tabela('plataforma.tenant'), parte: 'outra' }],
      }).success,
    ).toBe(false);
  });
});

describe('RN-PLA-09: excluir só com a empresa inativa e backup pronto, consistente e recente', () => {
  it('liberada: inativa, backup pronto da própria empresa, iniciado depois da inativação, dentro do prazo', () => {
    expect(conferirExclusao(empresa, backup(), agora)).toEqual({ ok: true });
  });
  it('empresa ativa (ou sem data de inativação) recusa; em exclusão também', () => {
    expect(conferirExclusao({ ...empresa, status: 'ativo' }, backup(), agora)).toEqual({
      ok: false,
      codigo: C.exclusaoEmpresaAtiva,
    });
    expect(conferirExclusao({ ...empresa, inativada_em: null }, backup(), agora)).toEqual({
      ok: false,
      codigo: C.exclusaoEmpresaAtiva,
    });
    expect(conferirExclusao({ ...empresa, status: 'encerrado' }, backup(), agora)).toEqual({
      ok: false,
      codigo: C.exclusaoEmAndamento,
    });
  });
  it('sem backup, backup de outra empresa, em andamento ou que falhou: EXCLUSAO_SEM_BACKUP', () => {
    for (const b of [
      null,
      backup({ tenant_id: OUTRO }),
      backup({ situacao: 'em_andamento', concluido_em: null }),
      backup({ situacao: 'falhou' }),
      backup({ situacao: 'apagado' }),
    ]) {
      expect(conferirExclusao(empresa, b, agora)).toEqual({ ok: false, codigo: C.exclusaoSemBackup });
    }
  });
  it('backup iniciado antes da inativação, ou com a empresa em uso (não consistente): faça outro', () => {
    expect(
      conferirExclusao(empresa, backup({ iniciado_em: new Date(inativada.getTime() - 1) }), agora),
    ).toEqual({ ok: false, codigo: C.exclusaoBackupAntesDaInativacao });
    expect(conferirExclusao(empresa, backup({ consistente: false }), agora)).toEqual({
      ok: false,
      codigo: C.exclusaoBackupAntesDaInativacao,
    });
  });
  it(`prazo de ${PRAZO_BACKUP_PARA_EXCLUIR_DIAS} dias do fim do backup: no limite vale, 1 ms depois vence`, () => {
    const concluido = backup().concluido_em!;
    const limite = new Date(concluido.getTime() + PRAZO_BACKUP_PARA_EXCLUIR_DIAS * DIA);
    expect(conferirExclusao(empresa, backup(), limite)).toEqual({ ok: true });
    expect(conferirExclusao(empresa, backup(), new Date(limite.getTime() + 1))).toEqual({
      ok: false,
      codigo: C.exclusaoBackupVencido,
    });
  });
  it('confirmação: o código da empresa, sem diferença de maiúsculas nem espaços nas pontas', () => {
    expect(codigoDeConfirmacaoConfere(' am4821 ', 'AM4821')).toBe(true);
    expect(codigoDeConfirmacaoConfere('AM4822', 'AM4821')).toBe(false);
    expect(codigoDeConfirmacaoConfere('', '')).toBe(false);
  });
  it('pedido de exclusão exige backup_id, código e senha; nada além', () => {
    const p = { id: B, backup_id: B, codigo_confirmacao: 'AM4821', senha: 'x' };
    expect(ExcluirEmpresaSchema.safeParse(p).success).toBe(true);
    expect(ExcluirEmpresaSchema.safeParse({ ...p, senha: '' }).success).toBe(false);
    expect(ExcluirEmpresaSchema.safeParse({ ...p, forcar: true }).success).toBe(false);
  });
  it('situação da exclusão: concluída tem fim; erro só na que falhou', () => {
    const x = {
      id: B,
      tenant_id: T,
      codigo: 'AM4821',
      backup_id: B,
      situacao: 'concluida',
      etapa: 'fim',
      pedida_em: '2026-11-14T23:56:00Z',
      concluida_em: '2026-11-14T23:58:00Z',
      linhas_apagadas: 1802,
      arquivos_apagados: 40,
      erro_codigo: null,
    };
    expect(ExclusaoEmpresaSchema.safeParse(x).success).toBe(true);
    expect(ExclusaoEmpresaSchema.safeParse({ ...x, etapa: 'arquivos' }).success).toBe(false);
    expect(ExclusaoEmpresaSchema.safeParse({ ...x, situacao: 'falhou' }).success).toBe(false);
    expect(
      ExclusaoEmpresaSchema.safeParse({
        ...x,
        situacao: 'falhou',
        concluida_em: null,
        etapa: 'banco',
        erro_codigo: 'BANCO_FALHOU',
      }).success,
    ).toBe(true);
  });
});

describe('contratos da lista e eventos', () => {
  it('EmpresaResumo ganha `acoes` opcional (aditivo: a resposta antiga continua válida)', () => {
    const item = {
      id: T,
      codigo: 'AM4821',
      razao_social: 'Alfa',
      cnpj: null,
      fuso: 'America/Manaus',
      status: 'suspenso',
      criada_em: '2026-11-01T00:00:00Z',
      modulos: [],
    };
    expect(EmpresaResumoSchema.safeParse(item).success).toBe(true);
    const acoes = {
      inativada_em: '2026-11-10T12:00:00Z',
      motivo_inativacao: 'outro',
      ultimo_backup: backupJson,
      exclusao: null,
      exclusao_bloqueada: null,
    };
    expect(AcoesDaEmpresaSchema.safeParse(acoes).success).toBe(true);
    expect(
      AcoesDaEmpresaSchema.safeParse({ ...acoes, exclusao_bloqueada: C.exclusaoBackupVencido }).success,
    ).toBe(true);
    expect(AcoesDaEmpresaSchema.safeParse({ ...acoes, exclusao_bloqueada: 'QUALQUER' }).success).toBe(false);
    expect(EmpresaResumoSchema.safeParse({ ...item, acoes }).success).toBe(true);
  });
  it('eventos plataforma.tenant.*@1 com nome válido e payload estrito, sem dado pessoal', () => {
    expect(EVENTOS_TENANT.map((e) => e.nome)).toEqual([
      'plataforma.tenant.inativado@1',
      'plataforma.tenant.reativado@1',
      'plataforma.tenant.backup_concluido@1',
      'plataforma.tenant.backup_falhou@1',
      'plataforma.tenant.excluido@1',
    ]);
    for (const e of EVENTOS_TENANT)
      expect(e).toMatchObject({ modulo: 'plataforma', entidade: 'tenant', versao: 1 });
    const [inativado] = EVENTOS_TENANT;
    expect(
      inativado.schema.safeParse({ tenant_id: T, motivo: 'outro', inativada_em: '2026-11-10T12:00:00Z' })
        .success,
    ).toBe(true);
    expect(
      inativado.schema.safeParse({ tenant_id: T, motivo: null, inativada_em: '2026-11-10T12:00:00Z' })
        .success,
    ).toBe(true);
    expect(
      inativado.schema.safeParse({
        tenant_id: T,
        motivo: 'outro',
        inativada_em: '2026-11-10T12:00:00Z',
        email: 'a@b.c',
      }).success,
    ).toBe(false);
  });
});

describe('RD-0407: uma frase por código de recusa', () => {
  it('todo código de CODIGOS_ACOES_EMPRESA tem frase, e só eles', () => {
    expect(Object.keys(MENSAGENS_ACOES_EMPRESA).sort()).toEqual(Object.values(C).sort());
    for (const frase of Object.values(MENSAGENS_ACOES_EMPRESA)) expect(frase).toMatch(/^\S.*\.$/);
    expect(Object.isFrozen(MENSAGENS_ACOES_EMPRESA)).toBe(true);
  });

  it('o texto da tela (spec §15.2)', () => {
    expect(MENSAGENS_ACOES_EMPRESA[C.exclusaoBackupVencido]).toBe('Faça o backup antes de excluir.');
    expect(MENSAGENS_ACOES_EMPRESA[C.exclusaoCodigoNaoConfere]).toBe('Código não confere.');
    expect(MENSAGENS_ACOES_EMPRESA[C.reautenticacaoFalhou]).toBe('Senha incorreta.');
  });
});
