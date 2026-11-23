/** ADR 0068: contrato e regra do "Zerar dados" da empresa no portal (RN-PLA-12). */
import { describe, expect, it } from 'vitest';
import { CODIGOS_ACOES_EMPRESA, MENSAGENS_ACOES_EMPRESA } from './empresa-acoes';
import {
  CODIGOS_ZERAR_EMPRESA as Z,
  conferirZerar,
  ERROS_WORKER_ZERAR,
  EVENTO_TENANT_ZERADO,
  grupoDaTabelaZerar,
  GRUPOS_ZERAR,
  LIMITE_LINHAS_ZERAR,
  mensagemDoZerar,
  PedirZerarEmpresaSchema,
  PreviaZerarEmpresaSchema,
  resumirPreviaPorGrupo,
  ROTAS_ZERAR_EMPRESA,
  ROTULO_GRUPO_ZERAR,
  ZerarEmpresaSchema,
  type OcupacaoDaEmpresa,
} from './empresa-zerar';

const T = '7a000000-0000-4000-8000-000000000001';
const ID = '7c000000-0000-4000-8000-000000000001';
const livre: OcupacaoDaEmpresa = { zerar_em_andamento: false, backup_em_andamento: false, exclusao_em_andamento: false };

const concluido = {
  id: ID,
  tenant_id: T,
  codigo: 'am2808',
  origem: 'portal',
  situacao: 'concluido',
  pedido_em: '2026-11-23T14:00:00Z',
  concluido_em: '2026-11-23T14:00:09Z',
  linhas_apagadas: 130,
  contagem: { 'vendedor.pedido_item': 100, 'core.cliente': 30 },
  copia_expira_em: '2026-11-30T14:00:09Z',
  erro_codigo: null,
};

describe('RN-PLA-12: quando o zerar está liberado', () => {
  it('libera a empresa ativa e a inativa, sem nada em andamento e dentro do limite', () => {
    expect(conferirZerar({ status: 'ativo' }, livre, 0)).toEqual({ ok: true });
    expect(conferirZerar({ status: 'suspenso' }, livre, LIMITE_LINHAS_ZERAR)).toEqual({ ok: true });
  });

  it('recusa na ordem: exclusão, zerar, backup, volume', () => {
    const tudo: OcupacaoDaEmpresa = { zerar_em_andamento: true, backup_em_andamento: true, exclusao_em_andamento: true };
    expect(conferirZerar({ status: 'ativo' }, tudo, LIMITE_LINHAS_ZERAR + 1)).toEqual({ ok: false, codigo: Z.exclusaoEmAndamento });
    expect(conferirZerar({ status: 'encerrado' }, livre, 0)).toEqual({ ok: false, codigo: Z.exclusaoEmAndamento });
    expect(conferirZerar({ status: 'ativo' }, { ...tudo, exclusao_em_andamento: false }, 0)).toEqual({
      ok: false,
      codigo: Z.zerarEmAndamento,
    });
    expect(conferirZerar({ status: 'ativo' }, { ...livre, backup_em_andamento: true }, 0)).toEqual({
      ok: false,
      codigo: Z.backupEmAndamento,
    });
    expect(conferirZerar({ status: 'ativo' }, livre, LIMITE_LINHAS_ZERAR + 1)).toEqual({ ok: false, codigo: Z.volumeAlto });
  });

  it('reaproveita os códigos comuns das ações da empresa (uma tabela de códigos)', () => {
    expect(Z.naoEncontrada).toBe(CODIGOS_ACOES_EMPRESA.naoEncontrada);
    expect(Z.exclusaoEmAndamento).toBe(CODIGOS_ACOES_EMPRESA.exclusaoEmAndamento);
    expect(Z.backupEmAndamento).toBe(CODIGOS_ACOES_EMPRESA.backupEmAndamento);
    expect(Z.reautenticacaoFalhou).toBe(CODIGOS_ACOES_EMPRESA.reautenticacaoFalhou);
  });

  it('todo código das rotas e do worker tem frase, e as comuns são as das ações', () => {
    for (const c of [...Object.values(Z), ...Object.values(ERROS_WORKER_ZERAR)]) expect(mensagemDoZerar(c)).toBeTruthy();
    expect(mensagemDoZerar(Z.reautenticacaoFalhou)).toBe(MENSAGENS_ACOES_EMPRESA[CODIGOS_ACOES_EMPRESA.reautenticacaoFalhou]);
    expect(mensagemDoZerar('NAO_EXISTE')).toBeNull();
  });
});

describe('contratos das rotas', () => {
  it('rotas do portal sob /v1/plataforma/empresas/:tenant_id', () => {
    expect(ROTAS_ZERAR_EMPRESA.zerar).toBe('/v1/plataforma/empresas/:tenant_id/zerar');
    expect(ROTAS_ZERAR_EMPRESA.previa).toBe('/v1/plataforma/empresas/:tenant_id/zerar/previa');
  });

  it('pedido: id, código digitado e senha; nada além', () => {
    expect(PedirZerarEmpresaSchema.safeParse({ id: ID, codigo_confirmacao: ' AM2808 ', senha: 'x' }).success).toBe(true);
    expect(PedirZerarEmpresaSchema.safeParse({ id: ID, codigo_confirmacao: 'am2808' }).success).toBe(false);
    expect(PedirZerarEmpresaSchema.safeParse({ id: 'x', codigo_confirmacao: 'am2808', senha: 'x' }).success).toBe(false);
    expect(
      PedirZerarEmpresaSchema.safeParse({ id: ID, codigo_confirmacao: 'am2808', senha: 'x', backup_id: ID }).success,
    ).toBe(false);
  });

  it('zerar concluído traz data, contagem, soma e prazo da cópia', () => {
    expect(ZerarEmpresaSchema.safeParse(concluido).success).toBe(true);
    expect(ZerarEmpresaSchema.safeParse({ ...concluido, copia_expira_em: null }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...concluido, linhas_apagadas: 129 }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...concluido, contagem: { 'Core.Cliente': 1 } }).success).toBe(false);
  });

  it('em andamento sem conclusão; falhou sempre com erro_codigo', () => {
    const andamento = {
      ...concluido,
      situacao: 'em_andamento',
      concluido_em: null,
      linhas_apagadas: null,
      contagem: null,
      copia_expira_em: null,
    };
    expect(ZerarEmpresaSchema.safeParse(andamento).success).toBe(true);
    expect(ZerarEmpresaSchema.safeParse({ ...andamento, concluido_em: '2026-11-23T14:00:09Z' }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...andamento, situacao: 'falhou', erro_codigo: 'ZERAR_CONCORRENCIA' }).success).toBe(true);
    expect(ZerarEmpresaSchema.safeParse({ ...andamento, situacao: 'falhou' }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...andamento, erro_codigo: 'ZERAR_FALHOU' }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...andamento, origem: 'outro' }).success).toBe(false);
  });

  it('prévia: total é a soma das tabelas e o bloqueio é um código do zerar', () => {
    const previa = {
      tenant_id: T,
      codigo: 'am2808',
      contado_em: '2026-11-23T14:00:00Z',
      total_linhas: 5,
      tabelas: [
        { tabela: 'core.cliente', linhas: 3 },
        { tabela: 'vendedor.pedido', linhas: 2 },
      ],
      bloqueio: null,
    };
    expect(PreviaZerarEmpresaSchema.safeParse(previa).success).toBe(true);
    expect(PreviaZerarEmpresaSchema.safeParse({ ...previa, total_linhas: 6 }).success).toBe(false);
    expect(PreviaZerarEmpresaSchema.safeParse({ ...previa, bloqueio: Z.volumeAlto }).success).toBe(true);
    expect(PreviaZerarEmpresaSchema.safeParse({ ...previa, bloqueio: 'EXCLUSAO_SEM_BACKUP' }).success).toBe(false);
  });
});

describe('agrupamento da prévia', () => {
  it('cada tabela cai num grupo; tabela desconhecida é cadastro', () => {
    expect(grupoDaTabelaZerar('core.cliente')).toBe('cadastros');
    expect(grupoDaTabelaZerar('catalogo.tabela_preco_item')).toBe('cadastros');
    expect(grupoDaTabelaZerar('vendedor.pedido')).toBe('pedidos');
    expect(grupoDaTabelaZerar('vendedor.pedido_item')).toBe('pedidos');
    expect(grupoDaTabelaZerar('integracao.pedido_retorno')).toBe('pedidos');
    expect(grupoDaTabelaZerar('integracao.registro_atual')).toBe('integracao');
    expect(grupoDaTabelaZerar('core.visita')).toBe('registros');
    expect(grupoDaTabelaZerar('promotor.ruptura_item')).toBe('registros');
    expect(grupoDaTabelaZerar('pesquisa.resposta')).toBe('registros');
    expect(grupoDaTabelaZerar('plataforma.evento')).toBe('sistema');
    expect(grupoDaTabelaZerar('plataforma.arquivo')).toBe('arquivos');
    expect(grupoDaTabelaZerar('novo.tabela')).toBe('cadastros');
  });

  it('soma por grupo, na ordem fixa, sem os grupos vazios', () => {
    expect(
      resumirPreviaPorGrupo([
        { tabela: 'plataforma.arquivo', linhas: 4 },
        { tabela: 'vendedor.pedido_item', linhas: 10 },
        { tabela: 'vendedor.pedido', linhas: 2 },
        { tabela: 'core.cliente', linhas: 3 },
        { tabela: 'core.produto', linhas: 0 },
        { tabela: 'plataforma.evento', linhas: 0 },
      ]),
    ).toEqual([
      { grupo: 'cadastros', rotulo: ROTULO_GRUPO_ZERAR.cadastros, linhas: 3 },
      { grupo: 'pedidos', rotulo: ROTULO_GRUPO_ZERAR.pedidos, linhas: 12 },
      { grupo: 'arquivos', rotulo: ROTULO_GRUPO_ZERAR.arquivos, linhas: 4 },
    ]);
    expect(Object.keys(ROTULO_GRUPO_ZERAR)).toEqual([...GRUPOS_ZERAR]);
  });
});

describe('auditoria tenant.zerado', () => {
  it('payload estrito de plataforma.tenant.zerado@1', () => {
    expect(EVENTO_TENANT_ZERADO.nome).toBe('plataforma.tenant.zerado@1');
    const p = {
      tenant_id: T,
      codigo: 'am2808',
      zerar_id: ID,
      origem: 'workflow',
      linhas_apagadas: 130,
      copia_expira_em: '2026-11-30T14:00:09Z',
      zerado_em: '2026-11-23T14:00:09Z',
    };
    expect(EVENTO_TENANT_ZERADO.schema.safeParse(p).success).toBe(true);
    expect(EVENTO_TENANT_ZERADO.schema.safeParse({ ...p, nome: 'x' }).success).toBe(false);
  });
});
