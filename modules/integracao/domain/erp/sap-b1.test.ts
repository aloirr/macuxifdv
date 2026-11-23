import { describe, expect, it } from 'vitest';
import { ENTIDADES, SCHEMA_REGISTRO, PedidoParaErp, type Entidade } from '../../contracts';
import { adaptadorSapB1 as a } from './sap-b1';
import type { ConfigAdaptador } from './tipos';

const cfg: ConfigAdaptador = { parametros: { company_db: 'SBO_MACUXI', campo_uuid: 'U_MXUUID' }, fuso: 'America/Manaus', agora: '2026-11-22T14:00:00.000Z' };
const valida = (e: Entidade, r: unknown) => SCHEMA_REGISTRO[e].safeParse(r);

describe('SAP B1 (Service Layer) — beta: login e sessão', () => {
  it('D9: o modelo é beta e lista o que falta confirmar com o cliente', () => {
    expect(a.situacao).toBe('beta');
    expect(a.confirmarComCliente.length).toBeGreaterThan(0);
  });

  it('[P] o login manda CompanyDB, UserName e Password; a sessão é o cookie B1SESSION', () => {
    const req = a.requisicaoLogin({ usuario: 'manager', senha: 'segredo-1' }, cfg);
    expect(req).toMatchObject({ metodo: 'POST', caminho: 'Login', corpo: { CompanyDB: 'SBO_MACUXI', UserName: 'manager', Password: 'segredo-1' } });
    const ok = a.lerSessao({ status: 200, cabecalhos: {}, corpo: { SessionId: 'abc123', Version: '1000160', SessionTimeout: 30 } }, cfg.agora);
    expect(ok).toEqual({ ok: true, sessao: { cabecalhos: { Cookie: 'B1SESSION=abc123' }, expiraEm: '2026-11-22T14:28:00.000Z' } });
  });

  it('RN-INT-20: login com 401 ou 400 (usuário/senha errados) é credencial recusada; sem SessionId é formato mudou', () => {
    expect(a.lerSessao({ status: 401, cabecalhos: {}, corpo: null }, cfg.agora)).toEqual({ ok: false, motivo: 'credencial_recusada', status: 401 });
    expect(a.lerSessao({ status: 400, cabecalhos: {}, corpo: { error: { code: -304, message: { value: 'Fail to get DB Credentials' } } } }, cfg.agora)).toMatchObject({ ok: false, motivo: 'credencial_recusada' });
    expect(a.lerSessao({ status: 200, cabecalhos: {}, corpo: { outro: 1 } }, cfg.agora)).toMatchObject({ ok: false, motivo: 'formato_mudou' });
  });
});

describe('SAP B1 — requisições de leitura', () => {
  it('[P] cliente: filtra CardType e, no incremental, UpdateDate pela data local do ERP; pede a página por Prefer', () => {
    const r = a.requisicaoPagina('cliente', { desde: '2026-11-22T02:00:00.000Z', tamanho: 200, ficha: null }, cfg);
    expect(r.caminho).toBe('BusinessPartners');
    expect(r.query?.$filter).toBe("CardType eq 'cCustomer' and UpdateDate ge '2026-11-21'"); // 02:00Z = 22:00 do dia 21 em Manaus
    expect(r.cabecalhos).toEqual({ Prefer: 'odata.maxpagesize=200' });
  });
  it('entidade sem data de alteração não leva filtro de data (leitura completa)', () => {
    const r = a.requisicaoPagina('vendedor', { desde: '2026-11-22T02:00:00.000Z', tamanho: 100, ficha: null }, cfg);
    expect(r.query?.$filter).toBeUndefined();
    expect(a.suportaDelta('vendedor')).toBe(false);
    expect(a.suportaDelta('estoque')).toBe(false);
    expect(a.suportaDelta('cliente')).toBe(true);
  });
  it('a ficha da próxima página é o odata.nextLink relativo; link para outro host é descartado', () => {
    expect(a.requisicaoPagina('produto', { desde: null, tamanho: 100, ficha: 'Items?$skip=100' }, cfg)).toMatchObject({ caminho: 'Items?$skip=100' });
    expect(a.lerPagina('produto', { status: 200, cabecalhos: {}, corpo: { value: [{ ItemCode: 'A' }], 'odata.nextLink': 'Items?$skip=100' } })).toEqual({ ok: true, pagina: { linhas: [{ ItemCode: 'A' }], proxima: 'Items?$skip=100' } });
    expect(a.lerPagina('produto', { status: 200, cabecalhos: {}, corpo: { value: [], '@odata.nextLink': 'https://atacante.com/x' } })).toEqual({ ok: true, pagina: { linhas: [], proxima: null } });
  });
  it('sem a lista "value" ou com erro HTTP é formato mudou, sem devolver o corpo', () => {
    expect(a.lerPagina('produto', { status: 200, cabecalhos: {}, corpo: { x: 1 } })).toMatchObject({ ok: false, motivo: 'formato_mudou' });
    const r = a.lerPagina('produto', { status: 404, cabecalhos: {}, corpo: { error: { message: { value: 'Invalid resource' } } } });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
});

describe('SAP B1 — conversão para o contrato canônico (de-para do desenho §3.3)', () => {
  it('[P] vendedor: SalesEmployeeCode e Name; o "-1 Sem vendedor" do SAP é ignorado; inativo vira ativo=false', () => {
    const r = a.converter('vendedor', { SalesEmployeeCode: 7, SalesEmployeeName: 'Ana Souza', Active: 'tYES', Email: 'ana@x.com' }, cfg);
    expect(r).toEqual({ ok: true, registros: [{ external_id: '7', alterado_em: cfg.agora, ativo: true, nome: 'Ana Souza', email: 'ana@x.com' }] });
    expect(valida('vendedor', (r as { registros: unknown[] }).registros[0]).success).toBe(true);
    expect(a.converter('vendedor', { SalesEmployeeCode: -1, SalesEmployeeName: '-Sem vendedor-' }, cfg)).toEqual({ ok: true, registros: [] });
    expect(a.converter('vendedor', { SalesEmployeeCode: 8, SalesEmployeeName: 'Beto', Active: 'tNO' }, cfg)).toMatchObject({ registros: [{ ativo: false }] });
  });

  it('[P] cliente: CardCode, CreditLimit em centavos, Frozen = bloqueado, data local do ERP em UTC, endereço de cobrança', () => {
    const r = a.converter('cliente', { CardCode: 'C0001', CardName: 'Mercado Boa Vista', CardForeignName: 'Boa Vista', FederalTaxID: '11.222.333/0001-81', Phone1: '9233334444', SalesPersonCode: 7, CreditLimit: 15000.5, Frozen: 'tYES', Valid: 'tYES', PriceListNum: 2, UpdateDate: '2026-11-20', UpdateTime: '14:35:00', BPAddresses: [{ AddressType: 'bo_ShipTo', Street: 'Rua X', City: 'Outra', State: 'AM' }, { AddressType: 'bo_BillTo', Street: 'Av. Brasil', StreetNo: '100', Block: 'Centro', City: 'Manaus', State: 'am', ZipCode: '69000-000' }] }, cfg);
    expect(r.ok).toBe(true);
    const reg = (r as { registros: Record<string, unknown>[] }).registros[0]!;
    expect(reg).toMatchObject({ external_id: 'C0001', alterado_em: '2026-11-20T18:35:00.000Z', razao_social: 'Mercado Boa Vista', vendedor_external_id: '7', limite_credito_cents: 1500050, bloqueado: true, ativo: true, tabela_preco_external_id: '2', endereco: { logradouro: 'Av. Brasil', cidade: 'Manaus', uf: 'AM', cep: '69000-000' } });
    expect(valida('cliente', reg).success).toBe(true);
  });

  it('cliente sem CardName é linha com erro legível (e o external_id), não quebra o lote', () => {
    expect(a.converter('cliente', { CardCode: 'C0002' }, cfg)).toMatchObject({ ok: false, external_id: 'C0002', campo: 'CardName' });
    expect(a.converter('cliente', { CardName: 'X' }, cfg)).toMatchObject({ ok: false, external_id: null, campo: 'CardCode' });
  });

  it('[P] produto: ItemCode, ItemName, SalesUnit em sigla, EAN só se válido; Frozen vira inativo', () => {
    const r = a.converter('produto', { ItemCode: 'P001', ItemName: 'Arroz 5kg', SalesUnit: 'cx', BarCode: '7891234567895', Frozen: 'tNO', Valid: 'tYES', UpdateDate: '2026-11-20', UpdateTime: '08:00:00' }, cfg);
    const reg = (r as { registros: Record<string, unknown>[] }).registros[0]!;
    expect(reg).toMatchObject({ external_id: 'P001', sku: 'P001', unidade: 'CX', ean: '7891234567895', ativo: true, alterado_em: '2026-11-20T12:00:00.000Z' });
    expect(valida('produto', reg).success).toBe(true);
    expect(a.converter('produto', { ItemCode: 'P002', ItemName: 'X', SalesUnit: 'Unidade', BarCode: 'ABC' }, cfg)).toMatchObject({ ok: false, campo: 'SalesUnit' });
    expect(a.converter('produto', { ItemCode: 'P003', ItemName: 'X', SalesUnit: 'UN', BarCode: 'ABC', Frozen: 'tYES' }, cfg)).toMatchObject({ registros: [{ ean: null, ativo: false }] });
  });

  it('[P] preço: um registro por lista de preço do item; preço zero não é preço', () => {
    const r = a.converter('preco', { ItemCode: 'P001', UpdateDate: '2026-11-20', UpdateTime: '08:00:00', ItemPrices: [{ PriceList: 1, Price: 12.9 }, { PriceList: 2, Price: 0 }, { PriceList: 3, Price: 10 }] }, cfg);
    const regs = (r as { registros: Record<string, unknown>[] }).registros;
    expect(regs.map((x) => x.external_id)).toEqual(['1:P001', '3:P001']);
    expect(regs[0]).toMatchObject({ tabela_external_id: '1', preco_cents: 1290, produto_external_id: 'P001', vigencia_inicio: '2026-11-20' });
    for (const x of regs) expect(valida('preco', x).success).toBe(true);
  });

  it('[P] estoque: saldo = InStock − Committed por depósito', () => {
    const r = a.converter('estoque', { ItemCode: 'P001', ItemWarehouseInfoCollection: [{ WarehouseCode: '01', InStock: 100, Committed: 30 }, { WarehouseCode: '02', InStock: 5, Committed: 0 }] }, cfg);
    const regs = (r as { registros: Record<string, unknown>[] }).registros;
    expect(regs).toMatchObject([{ external_id: 'P001:01', deposito_external_id: '01', saldo: 70 }, { external_id: 'P001:02', saldo: 5 }]);
    for (const x of regs) expect(valida('estoque', x).success).toBe(true);
  });

  it('[P] forma de pagamento: GroupNumber e PaymentTermsGroupName', () => {
    const r = a.converter('forma_pagamento', { GroupNumber: 3, PaymentTermsGroupName: 'Boleto 30 dias' }, cfg);
    expect(valida('forma_pagamento', (r as { registros: unknown[] }).registros[0]).success).toBe(true);
  });

  it('entidade que o modelo ainda não lê devolve erro legível; as suportadas têm campos obrigatórios declarados', () => {
    expect(a.converter('titulo', { x: 1 }, cfg)).toMatchObject({ ok: false, campo: 'entidade' });
    for (const e of a.entidadesSuportadas) expect(a.camposObrigatorios(e).length).toBeGreaterThan(0);
    expect(a.entidadesSuportadas.every((e) => (ENTIDADES as readonly string[]).includes(e))).toBe(true);
  });
});

describe('SAP B1 — pedido pela API (RN-INT-19)', () => {
  const pedido = PedidoParaErp.parse({
    versao_contrato: 'v1', pedido_uuid: '3f2b7a52-6c0e-4d44-9a52-5d2f3c1a9b10', cliente_external_id: 'C0001', vendedor_external_id: '7', condicao_pagamento_erp: '3',
    criado_em: '2026-11-22T13:00:00Z', aprovado_em: '2026-11-22T13:30:00Z', observacao: 'Entregar pela manhã',
    itens: [{ sequencia: 1, produto_external_id: 'P001', quantidade: 10, preco_unitario_cents: 1290, total_cents: 12900 }], total_cents: 12900,
  });
  const ped = a.pedido!;

  it('RN-INT-19: procura o pedido pelo campo do UUID antes de criar', () => {
    const r = ped.requisicaoProcurar(pedido.pedido_uuid, cfg);
    expect(r).toMatchObject({ metodo: 'GET', caminho: 'Orders', query: { $filter: "U_MXUUID eq '3f2b7a52-6c0e-4d44-9a52-5d2f3c1a9b10'", $top: '1' } });
    expect(ped.lerProcura({ status: 200, cabecalhos: {}, corpo: { value: [{ DocEntry: 55, DocNum: 9001, DocumentStatus: 'bost_Open' }] } })).toEqual({ numero_erp: '9001' });
    expect(ped.lerProcura({ status: 200, cabecalhos: {}, corpo: { value: [] } })).toBeNull();
  });

  it('RN-INT-19: o UUID vai no campo configurado; o preço sai em reais e o resto do pedido segue o contrato', () => {
    const r = ped.requisicaoCriar(pedido, { ...cfg, parametros: { ...cfg.parametros, campo_uuid: 'U_UUID_MX' } });
    expect(r.corpo).toMatchObject({ CardCode: 'C0001', SalesPersonCode: 7, PaymentGroupCode: 3, U_UUID_MX: pedido.pedido_uuid, DocumentLines: [{ ItemCode: 'P001', Quantity: 10, UnitPrice: 12.9 }] });
  });

  it('RN-INT-19: lê o número criado e o motivo da recusa (sem devolver a resposta inteira)', () => {
    expect(ped.lerCriacao({ status: 201, cabecalhos: {}, corpo: { DocEntry: 55, DocNum: 9001 } })).toEqual({ numero_erp: '9001', motivo: null });
    expect(ped.lerCriacao({ status: 400, cabecalhos: {}, corpo: { error: { code: -10, message: { lang: 'pt-br', value: 'Cliente bloqueado' } } } })).toEqual({ numero_erp: null, motivo: 'Cliente bloqueado' });
  });
});
