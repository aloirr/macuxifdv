/** ADR 0068: contrato do "Zerar dados" da empresa no portal (RN-PLA-12; a regra de liberação é do banco, `zerar_bloqueado`). */
import { describe, expect, it } from 'vitest';
import { CODIGOS_ACOES_EMPRESA, MENSAGENS_ACOES_EMPRESA } from './empresa-acoes';
import {
  CODIGOS_ZERAR_EMPRESA as Z,
  CONSULTA_PREVIA_ZERAR_MS,
  ENTIDADES_ZERAR,
  linhasQueSaem,
  LOTE_LIMPEZA_FORMATO,
  PedirPreviaZerarSchema,
  ERROS_WORKER_ZERAR,
  EVENTO_TENANT_ZERADO,
  grupoDaTabelaZerar,
  GRUPOS_ZERAR,
  mensagemDaPreviaZerar,
  mensagemDoZerar,
  PedirZerarEmpresaSchema,
  PreviaZerarSchema,
  resumirPreviaPorGrupo,
  ROTAS_ZERAR_EMPRESA,
  ROTULO_GRUPO_ZERAR,
  ZerarEmpresaSchema,
} from './empresa-zerar';

const T = '7a000000-0000-4000-8000-000000000001';
const ID = '7c000000-0000-4000-8000-000000000001';

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

describe('RN-PLA-12: códigos e frases (a regra de liberação é só do banco)', () => {
  it('o SDK não traz cópia da regra: nem conferirZerar nem o limite de linhas', async () => {
    const m: Record<string, unknown> = await import('./empresa-zerar');
    expect(m.conferirZerar).toBeUndefined();
    expect(m.LIMITE_LINHAS_ZERAR).toBeUndefined();
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

  it('prévia que falhou ou sumiu: a frase da contagem (R4-1); o ZERAR_FALHOU da prévia não é o do zerar', () => {
    const contar = 'Não foi possível contar os dados. Tente de novo.';
    expect(mensagemDoZerar(Z.previaNaoEncontrada)).toBe(contar);
    expect(mensagemDaPreviaZerar(ERROS_WORKER_ZERAR.falhou)).toBe(contar);
    expect(mensagemDoZerar(ERROS_WORKER_ZERAR.falhou)).not.toBe(contar);
    expect(mensagemDaPreviaZerar(Z.naoEncontrada)).toBe(mensagemDoZerar(Z.naoEncontrada));
    expect(mensagemDaPreviaZerar('NAO_EXISTE')).toBeNull();
  });
});

describe('contratos das rotas', () => {
  it('rotas do portal sob /v1/plataforma/empresas/:tenant_id', () => {
    expect(ROTAS_ZERAR_EMPRESA.zerar).toBe('/v1/plataforma/empresas/:tenant_id/zerar');
    expect(ROTAS_ZERAR_EMPRESA.previa).toBe('/v1/plataforma/empresas/:tenant_id/zerar/previa');
    expect(ROTAS_ZERAR_EMPRESA.previaLer).toBe('/v1/plataforma/empresas/:tenant_id/zerar/previa/:previa_id');
    expect(CONSULTA_PREVIA_ZERAR_MS).toBe(2_000);
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

  it('entidades: as 16 do Hub, na ordem de carga; o pedido da prévia leva o id do portal e a lista normalizada', () => {
    expect(ENTIDADES_ZERAR).toHaveLength(16);
    expect(PedirPreviaZerarSchema.parse({ id: ID }).entidades).toBeNull();
    expect(PedirPreviaZerarSchema.parse({ id: ID, entidades: ['nota', 'filial'] }).entidades).toEqual(['filial', 'nota']);
    for (const c of [{}, { id: 'x' }, { id: ID, entidades: [] }, { id: ID, entidades: ['cliente', 'pedido'] }, { id: ID, x: 1 }])
      expect(PedirPreviaZerarSchema.safeParse(c).success).toBe(false);
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

  it('prévia: em andamento sem conta; pronta com linhas, entidades_afetadas e total; falhou sempre com erro_codigo', () => {
    const pronta = {
      id: ID,
      situacao: 'pronta',
      entidades: ['cliente'],
      linhas: [
        { ordem: 1, tabela: 'core.cliente', modo: 'soft', linhas: 3 },
        { ordem: 2, tabela: 'integracao.registro_atual', modo: 'fisico', linhas: 2 },
        { ordem: 201, tabela: 'core.filial', modo: 'filial', linhas: 1 },
        { ordem: 202, tabela: 'plataforma.sync_pacote', modo: 'sync_pacote', linhas: 4 },
        { ordem: 203, tabela: 'plataforma.tenant', modo: 'girar', linhas: 1 },
      ],
      entidades_afetadas: ['cliente', 'cliente_endereco'],
      total: 5,
      bloqueio: null,
      erro_codigo: null,
      criado_em: '2026-11-23T14:00:00Z',
    };
    const andamento = { ...pronta, situacao: 'em_andamento', linhas: null, entidades_afetadas: null, total: null };
    expect(PreviaZerarSchema.safeParse(pronta).success).toBe(true);
    expect(PreviaZerarSchema.safeParse(andamento).success).toBe(true);
    expect(PreviaZerarSchema.safeParse({ ...andamento, situacao: 'falhou', erro_codigo: ERROS_WORKER_ZERAR.falhou }).success).toBe(true);
    expect(PreviaZerarSchema.safeParse({ ...andamento, situacao: 'falhou', erro_codigo: Z.naoEncontrada }).success).toBe(true);
    expect(PreviaZerarSchema.safeParse({ ...andamento, situacao: 'falhou' }).success).toBe(false);
    expect(PreviaZerarSchema.safeParse({ ...andamento, erro_codigo: 'ZERAR_FALHOU' }).success).toBe(false);
    expect(PreviaZerarSchema.safeParse({ ...pronta, total: null }).success).toBe(false);
    expect(PreviaZerarSchema.safeParse({ ...pronta, total: 6 }).success).toBe(false);
    // filial, sync_pacote e girar mudam e não saem: o total é só soft + fisico
    expect(PreviaZerarSchema.safeParse({ ...pronta, total: 11 }).success).toBe(false);
    // modo obrigatório e da lista
    expect(PreviaZerarSchema.safeParse({ ...pronta, linhas: [{ ordem: 1, tabela: 'core.cliente', linhas: 5 }], total: 5 }).success).toBe(false);
    expect(PreviaZerarSchema.safeParse({ ...pronta, linhas: [{ ordem: 1, tabela: 'core.cliente', modo: 'apagar', linhas: 5 }], total: 5 }).success).toBe(false);
    expect(PreviaZerarSchema.safeParse({ ...pronta, bloqueio: Z.naoEncontrada }).success).toBe(true);
    expect(PreviaZerarSchema.safeParse({ ...pronta, bloqueio: Z.volumeAlto }).success).toBe(true);
    expect(PreviaZerarSchema.safeParse({ ...pronta, bloqueio: Z.hubProcessando }).success).toBe(true);
    expect(PreviaZerarSchema.safeParse({ ...pronta, bloqueio: 'EXCLUSAO_SEM_BACKUP' }).success).toBe(false);
    expect(PreviaZerarSchema.safeParse({ ...pronta, tenant_id: ID }).success).toBe(false);
    expect(PreviaZerarSchema.safeParse({ ...pronta, situacao: 'concluido' }).success).toBe(false);
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
    expect(grupoDaTabelaZerar('core.usuario')).toBe('usuarios');
    expect(grupoDaTabelaZerar('plataforma.usuario_perfil')).toBe('usuarios');
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
        { tabela: 'core.usuario', modo: 'soft', linhas: 5 },
        { tabela: 'plataforma.evento', modo: 'soft', linhas: 0 },
        { tabela: 'plataforma.tenant', modo: 'girar', linhas: 1 },
      ]),
    ).toEqual([
      { grupo: 'cadastros', rotulo: ROTULO_GRUPO_ZERAR.cadastros, linhas: 3 },
      { grupo: 'usuarios', rotulo: ROTULO_GRUPO_ZERAR.usuarios, linhas: 5 },
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
