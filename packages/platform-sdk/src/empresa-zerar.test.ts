/** ADR 0068: contrato e regra do "Zerar dados" da empresa no portal (RN-PLA-12). */
import { describe, expect, it } from 'vitest';
import { CODIGOS_ACOES_EMPRESA, MENSAGENS_ACOES_EMPRESA } from './empresa-acoes';
import {
  CODIGOS_ZERAR_EMPRESA as Z,
  conferirZerar,
  ENTIDADES_ZERAR,
  linhasQueSaem,
  LOTE_LIMPEZA_FORMATO,
  PreviaZerarQuerySchema,
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
const livre: OcupacaoDaEmpresa = { zerar_em_andamento: false, backup_em_andamento: false, exclusao_em_andamento: false, hub_processando: false };

const concluido = {
  id: ID,
  tenant_id: T,
  codigo: 'am2808',
  entidades: null,
  entidades_afetadas: ['cliente', 'cliente_endereco'],
  lote: '20261123T140000Z-7c000000',
  situacao: 'concluido',
  pedido_em: '2026-11-23T14:00:00Z',
  concluido_em: '2026-11-23T14:00:09Z',
  linhas_apagadas: 130,
  contagem: [
    { tabela: 'vendedor.pedido_item', modo: 'soft', linhas: 100 },
    { tabela: 'core.cliente', modo: 'soft', linhas: 25 },
    { tabela: 'integracao.registro_atual', modo: 'fisico', linhas: 5 },
    { tabela: 'core.filial', modo: 'filial', linhas: 2 },
    { tabela: 'plataforma.tenant', modo: 'girar', linhas: 1 },
  ],
  copia_expira_em: '2026-11-30T14:00:09Z',
  erro_codigo: null,
};

describe('RN-PLA-12: quando o zerar está liberado', () => {
  it('libera a empresa ativa e a inativa, sem nada em andamento e dentro do limite', () => {
    expect(conferirZerar({ status: 'ativo' }, livre, 0)).toEqual({ ok: true });
    expect(conferirZerar({ status: 'suspenso' }, livre, LIMITE_LINHAS_ZERAR)).toEqual({ ok: true });
  });

  it('recusa na ordem: exclusão, zerar, backup, Hub processando, volume', () => {
    const tudo: OcupacaoDaEmpresa = { zerar_em_andamento: true, backup_em_andamento: true, exclusao_em_andamento: true, hub_processando: true };
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
    expect(conferirZerar({ status: 'ativo' }, { ...livre, hub_processando: true }, LIMITE_LINHAS_ZERAR + 1)).toEqual({
      ok: false,
      codigo: Z.hubProcessando,
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

  it('pedido: id, código digitado, senha e entidades opcionais; nada além', () => {
    expect(PedirZerarEmpresaSchema.parse({ id: ID, codigo_confirmacao: ' AM2808 ', senha: 'x' }).entidades).toBeNull();
    expect(PedirZerarEmpresaSchema.parse({ id: ID, codigo_confirmacao: 'am2808', senha: 'x', entidades: null }).entidades).toBeNull();
    expect(
      PedirZerarEmpresaSchema.parse({ id: ID, codigo_confirmacao: 'am2808', senha: 'x', entidades: ['nota', 'cliente'] }).entidades,
    ).toEqual(['cliente', 'nota']);
    for (const entidades of [[], ['cliente', 'cliente'], ['pedido']])
      expect(PedirZerarEmpresaSchema.safeParse({ id: ID, codigo_confirmacao: 'am2808', senha: 'x', entidades }).success).toBe(false);
    expect(PedirZerarEmpresaSchema.safeParse({ id: ID, codigo_confirmacao: 'am2808' }).success).toBe(false);
    expect(PedirZerarEmpresaSchema.safeParse({ id: 'x', codigo_confirmacao: 'am2808', senha: 'x' }).success).toBe(false);
    expect(
      PedirZerarEmpresaSchema.safeParse({ id: ID, codigo_confirmacao: 'am2808', senha: 'x', backup_id: ID }).success,
    ).toBe(false);
  });

  it('zerar concluído traz data, contagem, soma (só soft e físico), lote e prazo da cópia', () => {
    expect(ZerarEmpresaSchema.safeParse(concluido).success).toBe(true);
    expect(linhasQueSaem(concluido.contagem as never)).toBe(130);
    expect(ZerarEmpresaSchema.safeParse({ ...concluido, entidades: ['cliente'] }).success).toBe(true);
    expect(ZerarEmpresaSchema.safeParse({ ...concluido, entidades: [] }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...concluido, copia_expira_em: null }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...concluido, entidades_afetadas: null }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...concluido, linhas_apagadas: 133 }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...concluido, lote: '2026-11-23' }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...concluido, contagem: [{ tabela: 'Core.Cliente', modo: 'soft', linhas: 1 }] }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...concluido, contagem: [{ tabela: 'core.cliente', modo: 'apagar', linhas: 1 }] }).success).toBe(false);
  });

  it('lote: o do workflow (carimbo) e o do portal (carimbo + 8 hexa do id)', () => {
    expect(LOTE_LIMPEZA_FORMATO.test('20261123T140000Z')).toBe(true);
    expect(LOTE_LIMPEZA_FORMATO.test('20261123T140000Z-7c000000')).toBe(true);
    expect(LOTE_LIMPEZA_FORMATO.test('20261123T140000Z-7C000000')).toBe(false);
    expect(LOTE_LIMPEZA_FORMATO.test('20261123T140000Z;drop')).toBe(false);
  });

  it('entidades: as 16 do Hub, na ordem de carga; a query da prévia aceita lista por vírgula', () => {
    expect(ENTIDADES_ZERAR).toHaveLength(16);
    expect(PreviaZerarQuerySchema.parse({}).entidades).toBeNull();
    expect(PreviaZerarQuerySchema.parse({ entidades: 'nota, filial' }).entidades).toEqual(['filial', 'nota']);
    expect(PreviaZerarQuerySchema.safeParse({ entidades: '' }).success).toBe(false);
    expect(PreviaZerarQuerySchema.safeParse({ entidades: 'cliente,pedido' }).success).toBe(false);
    expect(PreviaZerarQuerySchema.safeParse({ entidades: 'cliente', x: '1' }).success).toBe(false);
  });

  it('em andamento sem conclusão; falhou sempre com erro_codigo', () => {
    const andamento = {
      ...concluido,
      situacao: 'em_andamento',
      concluido_em: null,
      linhas_apagadas: null,
      contagem: null,
      copia_expira_em: null,
      entidades_afetadas: null,
    };
    expect(ZerarEmpresaSchema.safeParse(andamento).success).toBe(true);
    expect(ZerarEmpresaSchema.safeParse({ ...andamento, concluido_em: '2026-11-23T14:00:09Z' }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...andamento, situacao: 'falhou', erro_codigo: 'ZERAR_CONCORRENCIA' }).success).toBe(true);
    expect(ZerarEmpresaSchema.safeParse({ ...andamento, situacao: 'falhou' }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...andamento, entidades_afetadas: ['cliente'] }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...andamento, erro_codigo: 'ZERAR_FALHOU' }).success).toBe(false);
    expect(ZerarEmpresaSchema.safeParse({ ...andamento, origem: 'portal' }).success).toBe(false);
  });

  it('prévia: total é a soma das linhas que saem e o bloqueio é um código do zerar', () => {
    const previa = {
      tenant_id: T,
      codigo: 'am2808',
      entidades: ['cliente'],
      entidades_afetadas: ['cliente', 'cliente_endereco'],
      contado_em: '2026-11-23T14:00:00Z',
      total_linhas: 5,
      tabelas: [
        { tabela: 'core.cliente', modo: 'soft', linhas: 3 },
        { tabela: 'integracao.registro_atual', modo: 'fisico', linhas: 2 },
        { tabela: 'plataforma.sync_pacote', modo: 'sync_pacote', linhas: 4 },
      ],
      bloqueio: null,
    };
    expect(PreviaZerarEmpresaSchema.safeParse(previa).success).toBe(true);
    expect(PreviaZerarEmpresaSchema.safeParse({ ...previa, total_linhas: 6 }).success).toBe(false);
    expect(PreviaZerarEmpresaSchema.safeParse({ ...previa, bloqueio: Z.volumeAlto }).success).toBe(true);
    expect(PreviaZerarEmpresaSchema.safeParse({ ...previa, bloqueio: Z.hubProcessando }).success).toBe(true);
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

  it('soma por grupo só o que sai, na ordem fixa, sem os grupos vazios', () => {
    expect(
      resumirPreviaPorGrupo([
        { tabela: 'plataforma.arquivo', modo: 'soft', linhas: 4 },
        { tabela: 'vendedor.pedido_item', modo: 'soft', linhas: 10 },
        { tabela: 'vendedor.pedido', modo: 'soft', linhas: 2 },
        { tabela: 'core.cliente', modo: 'soft', linhas: 3 },
        { tabela: 'core.filial', modo: 'filial', linhas: 2 },
        { tabela: 'core.produto', modo: 'soft', linhas: 0 },
        { tabela: 'plataforma.sync_pacote', modo: 'sync_pacote', linhas: 7 },
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
      lote: '20261123T140000Z-7c000000',
      entidades: ['cliente', 'produto'],
      linhas_apagadas: 130,
      copia_expira_em: '2026-11-30T14:00:09Z',
      zerado_em: '2026-11-23T14:00:09Z',
    };
    expect(EVENTO_TENANT_ZERADO.schema.safeParse(p).success).toBe(true);
    expect(EVENTO_TENANT_ZERADO.schema.safeParse({ ...p, nome: 'x' }).success).toBe(false);
  });
});
