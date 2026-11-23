import { describe, expect, it } from 'vitest';
import { PedidoParaErp, SCHEMA_REGISTRO, type Entidade } from '../../contracts';
import { adaptadorSankhya as a } from './sankhya';
import type { ConfigAdaptador } from './tipos';

const cfg: ConfigAdaptador = { parametros: { codigo_empresa: '1', top_pedido: '1010', campo_uuid: 'AD_MXUUID' }, fuso: 'America/Manaus', agora: '2026-11-22T14:00:00.000Z' };
const valida = (e: Entidade, r: unknown) => SCHEMA_REGISTRO[e].safeParse(r);
const resposta = (campos: string[], linhas: string[][], extra: Record<string, unknown> = {}) => ({
  status: 200,
  cabecalhos: {},
  corpo: { status: '1', responseBody: { entities: { total: String(linhas.length), hasMoreResult: 'false', offsetPage: '0', metadata: { fields: { field: campos.map((name) => ({ name })) } }, entity: linhas.map((l) => Object.fromEntries(l.map((v, i) => [`f${i}`, { $: v }]))), ...extra } } },
});

describe('Sankhya — beta: login e leitura', () => {
  it('D9: beta, com o que falta confirmar; só o parceiro filtra por data de alteração', () => {
    expect(a.situacao).toBe('beta');
    expect(a.confirmarComCliente.length).toBeGreaterThan(0);
    expect(a.suportaDelta('cliente')).toBe(true);
    expect(a.suportaDelta('produto')).toBe(false);
  });

  it('[P] o login manda appkey, token, username e password em cabeçalhos; a sessão é o bearerToken', () => {
    const r = a.requisicaoLogin({ usuario: 'api', senha: 'segredo-2', token: 'tk', appkey: 'ak' }, cfg);
    expect(r).toMatchObject({ metodo: 'POST', caminho: 'login', cabecalhos: { appkey: 'ak', token: 'tk', username: 'api', password: 'segredo-2' } });
    expect(a.lerSessao({ status: 200, cabecalhos: {}, corpo: { bearerToken: 'BT' } }, cfg.agora)).toEqual({ ok: true, sessao: { cabecalhos: { Authorization: 'Bearer BT' }, expiraEm: null } });
    expect(a.lerSessao({ status: 401, cabecalhos: {}, corpo: null }, cfg.agora)).toMatchObject({ ok: false, motivo: 'credencial_recusada' });
    expect(a.lerSessao({ status: 200, cabecalhos: {}, corpo: {} }, cfg.agora)).toMatchObject({ ok: false, motivo: 'formato_mudou' });
  });

  it('[P] loadRecords do parceiro: critério de cliente e, no incremental, DTALTER pela data local; página por offsetPage', () => {
    const r = a.requisicaoPagina('cliente', { desde: '2026-11-22T02:00:00.000Z', tamanho: 100, ficha: '3' }, cfg);
    expect(r).toMatchObject({ metodo: 'POST', caminho: 'gateway/v1/mge/service.sbr', query: { serviceName: 'CRUDServiceProvider.loadRecords', outputType: 'json' } });
    const ds = (r.corpo as { requestBody: { dataSet: Record<string, unknown> } }).requestBody.dataSet;
    expect(ds.rootEntity).toBe('Parceiro');
    expect(ds.offsetPage).toBe('3');
    expect((ds.criteria as { expression: { $: string } }).expression.$).toBe("this.CLIENTE = 'S' AND this.DTALTER >= TO_DATE('21/11/2026 00:00:00','DD/MM/YYYY HH24:MI:SS')");
  });

  it('[P] lê metadata + f0..fn em linhas por nome de campo; hasMoreResult avança a página; entity único (objeto) também vale', () => {
    const r = a.lerPagina('vendedor', resposta(['CODVEND', 'APELIDO'], [['1', 'Ana'], ['2', 'Beto']], { hasMoreResult: 'true', offsetPage: '4' }));
    expect(r).toEqual({ ok: true, pagina: { linhas: [{ CODVEND: '1', APELIDO: 'Ana' }, { CODVEND: '2', APELIDO: 'Beto' }], proxima: '5' } });
    const unico = a.lerPagina('vendedor', { status: 200, cabecalhos: {}, corpo: { status: '1', responseBody: { entities: { hasMoreResult: 'false', metadata: { fields: { field: { name: 'CODVEND' } } }, entity: { f0: { $: '9' } } } } } });
    expect(unico).toEqual({ ok: true, pagina: { linhas: [{ CODVEND: '9' }], proxima: null } });
  });

  it('status diferente de 1 vira formato mudou com a mensagem (base64 decodificada), sem o corpo inteiro', () => {
    const msg = Buffer.from('Entidade inexistente').toString('base64');
    const r = a.lerPagina('vendedor', { status: 200, cabecalhos: {}, corpo: { status: '0', statusMessage: msg } });
    expect(r).toMatchObject({ ok: false, motivo: 'formato_mudou' });
    expect((r as { mensagem: string }).mensagem).toContain('Entidade inexistente');
    expect(a.lerPagina('vendedor', { status: 200, cabecalhos: {}, corpo: { status: '1', responseBody: {} } })).toMatchObject({ ok: false });
  });
});

describe('Sankhya — conversão para o contrato canônico (de-para do desenho §3.4)', () => {
  it('[P] cliente: CODPARC, NOMEPARC, CGC_CPF, LIMCRED em centavos, BLOQUEAR, DTALTER local → UTC', () => {
    const r = a.converter('cliente', { CODPARC: '10', NOMEPARC: 'Boa Vista', RAZAOSOCIAL: 'Mercado Boa Vista Ltda', CGC_CPF: '11222333000181', CODVEND: '7', LIMCRED: '5000.00', BLOQUEAR: 'S', ATIVO: 'S', DTALTER: '20/11/2026 14:35:10' }, cfg);
    const reg = (r as { registros: Record<string, unknown>[] }).registros[0]!;
    expect(reg).toMatchObject({ external_id: '10', razao_social: 'Mercado Boa Vista Ltda', nome_fantasia: 'Boa Vista', vendedor_external_id: '7', limite_credito_cents: 500000, bloqueado: true, alterado_em: '2026-11-20T18:35:10.000Z' });
    expect(valida('cliente', reg).success).toBe(true);
    expect(a.converter('cliente', { NOMEPARC: 'X' }, cfg)).toMatchObject({ ok: false, campo: 'CODPARC' });
  });

  it('[P] vendedor, produto, estoque e forma de pagamento viram registros válidos do contrato', () => {
    const v = a.converter('vendedor', { CODVEND: '7', APELIDO: 'Ana', ATIVO: 'S' }, cfg);
    expect(valida('vendedor', (v as { registros: unknown[] }).registros[0]).success).toBe(true);
    expect(a.converter('vendedor', { CODVEND: '0', APELIDO: 'SEM VENDEDOR' }, cfg)).toEqual({ ok: true, registros: [] });
    const p = a.converter('produto', { CODPROD: '100', DESCRPROD: 'Arroz 5kg', CODVOL: 'cx', ATIVO: 'S' }, cfg);
    expect((p as { registros: unknown[] }).registros[0]).toMatchObject({ sku: '100', unidade: 'CX', ativo: true });
    expect(valida('produto', (p as { registros: unknown[] }).registros[0]).success).toBe(true);
    expect(a.converter('produto', { CODPROD: '101', DESCRPROD: 'X', CODVOL: 'UNIDADE' }, cfg)).toMatchObject({ ok: false, campo: 'CODVOL' });
    const e = a.converter('estoque', { CODEMP: '1', CODPROD: '100', CODLOCAL: '0', ESTOQUE: '50', RESERVADO: '8' }, cfg);
    expect((e as { registros: unknown[] }).registros[0]).toMatchObject({ external_id: '1:100:0', saldo: 42, deposito_external_id: '1:0', filial_external_id: '1' });
    expect(valida('estoque', (e as { registros: unknown[] }).registros[0]).success).toBe(true);
    const f = a.converter('forma_pagamento', { CODTIPVENDA: '12', DESCRTIPVENDA: 'Boleto 28 dias', ATIVO: 'S' }, cfg);
    expect(valida('forma_pagamento', (f as { registros: unknown[] }).registros[0]).success).toBe(true);
  });

  it('preço e endereço ainda não são lidos (a entidade não é suportada) e o motivo é legível', () => {
    expect(a.entidadesSuportadas).not.toContain('preco');
    expect(a.converter('preco', {}, cfg)).toMatchObject({ ok: false, campo: 'entidade' });
  });
});

describe('Sankhya — pedido pela API (RN-INT-19)', () => {
  const pedido = PedidoParaErp.parse({
    versao_contrato: 'v1', pedido_uuid: '3f2b7a52-6c0e-4d44-9a52-5d2f3c1a9b10', cliente_external_id: '10', vendedor_external_id: '7', condicao_pagamento_erp: '12',
    criado_em: '2026-11-22T13:00:00Z', aprovado_em: '2026-11-22T13:30:00Z',
    itens: [{ sequencia: 1, produto_external_id: '100', quantidade: 10, preco_unitario_cents: 1290, total_cents: 12900 }], total_cents: 12900,
  });
  const ped = a.pedido!;

  it('RN-INT-19: procura a nota de pedido pelo campo do UUID antes de criar', () => {
    const r = ped.requisicaoProcurar(pedido.pedido_uuid, cfg);
    const ds = (r.corpo as { requestBody: { dataSet: { rootEntity: string; criteria: { expression: { $: string } } } } }).requestBody.dataSet;
    expect(ds.rootEntity).toBe('CabecalhoNota');
    expect(ds.criteria.expression.$).toBe("this.AD_MXUUID = '3f2b7a52-6c0e-4d44-9a52-5d2f3c1a9b10' AND this.TIPMOV = 'P'");
    expect(ped.lerProcura(resposta(['NUNOTA'], [['5551']]))).toEqual({ numero_erp: '5551' });
    expect(ped.lerProcura(resposta(['NUNOTA'], []))).toBeNull();
  });

  it('RN-INT-19: CACSP.incluirNota leva TOP, empresa, UUID no campo adicional e os itens em reais', () => {
    const r = ped.requisicaoCriar(pedido, cfg);
    expect(r.query).toMatchObject({ serviceName: 'CACSP.incluirNota' });
    const nota = (r.corpo as { requestBody: { nota: { cabecalho: Record<string, { $?: string }>; itens: { item: Record<string, { $?: string }>[] } } } }).requestBody.nota;
    expect(nota.cabecalho).toMatchObject({ CODEMP: { $: '1' }, CODPARC: { $: '10' }, CODTIPOPER: { $: '1010' }, TIPMOV: { $: 'P' }, AD_MXUUID: { $: pedido.pedido_uuid }, CODTIPVENDA: { $: '12' } });
    expect(nota.itens.item[0]).toMatchObject({ CODPROD: { $: '100' }, QTDNEG: { $: '10' }, VLRUNIT: { $: '12.9' } });
  });

  it('RN-INT-19: lê o NUNOTA criado e o motivo da recusa (base64 decodificada)', () => {
    expect(ped.lerCriacao({ status: 200, cabecalhos: {}, corpo: { status: '1', responseBody: { pk: { NUNOTA: { $: '5551' } } } } })).toEqual({ numero_erp: '5551', motivo: null });
    const m = Buffer.from('Parceiro bloqueado').toString('base64');
    expect(ped.lerCriacao({ status: 200, cabecalhos: {}, corpo: { status: '0', statusMessage: m } })).toEqual({ numero_erp: null, motivo: 'Parceiro bloqueado' });
  });
});
