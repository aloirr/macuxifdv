/**
 * Adaptador SAP Business One pelo Service Layer (REST/OData; `https://<host>:50000/b1s/v1`). F4a, modelo BETA (D9).
 *
 * [P] conhecimento público (documentação do Service Layer):
 *  - `POST Login` com `CompanyDB`, `UserName` e `Password` devolve `SessionId` e o cookie `B1SESSION` (vence em ~30 min);
 *  - leitura por `GET <Entidade>` com `$select`, `$filter`, `$orderby` e paginação por `Prefer: odata.maxpagesize=N` + `odata.nextLink`
 *    (`@odata.nextLink` no OData v4); `Items`, `BusinessPartners`, `SalesPersons`, `PaymentTermsTypes`, `Orders`;
 *  - `UpdateDate`/`UpdateTime` em `Items` e `BusinessPartners`; `Active`/`Frozen`/`Valid` como `tYES`/`tNO`;
 *  - `POST Orders` com `CardCode`, `DocDueDate`, `DocumentLines` (`ItemCode`, `Quantity`, `UnitPrice`); status em `DocumentStatus`/`Cancelled`.
 * [C] a confirmar com o cliente (o desenho §3.3 e o guia da ficha):
 *  - licença/usuário dedicado do Service Layer, HANA × SQL Server (a API é a mesma; o Conector não lê HANA);
 *  - o UDF do UUID (`U_MXUUID` no cabeçalho do pedido, parâmetro `campo_uuid`) criado pelo parceiro;
 *  - CNPJ: em instalações brasileiras fica em `BPFiscalTaxIDCollection` (aqui lido de `FederalTaxID`, que existe no cadastro simples);
 *  - o formato do filtro de data (`UpdateDate ge '2026-11-20'`) e se `UpdateTime` vem como texto `HH:mm:ss` ou número;
 *  - `UpdateDate` de `Items` NÃO muda em movimento de estoque: estoque, vendedores e formas vão em leitura completa;
 *  - nome da lista de preço (`PriceLists`) e vigência do preço: aqui, "Lista de preço <n>" e a data da última alteração do item.
 */
import type { Entidade, PedidoParaErp } from '../../contracts';
import { caminhoRelativoSeguro, dataHoraLocalParaUtc, numeroOuNull, reaisParaCentavos, simNao, textoOuNull } from './conversao';
import type { AdaptadorErp, ConfigAdaptador, ResultadoConversao } from './tipos';

const SUPORTADAS = ['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'forma_pagamento'] as const satisfies readonly Entidade[];
const COM_DELTA: ReadonlySet<Entidade> = new Set<Entidade>(['cliente', 'produto', 'preco']);

const CAMPOS_OBRIGATORIOS: Partial<Record<Entidade, readonly string[]>> = {
  vendedor: ['SalesEmployeeCode', 'SalesEmployeeName'],
  cliente: ['CardCode', 'CardName'],
  produto: ['ItemCode', 'ItemName'],
  preco: ['ItemCode', 'ItemPrices'],
  estoque: ['ItemCode', 'ItemWarehouseInfoCollection'],
  forma_pagamento: ['GroupNumber', 'PaymentTermsGroupName'],
};

const DESCRICAO: Partial<Record<Entidade, { caminho: string; select: string; ordem: string; filtro?: string; delta: boolean }>> = {
  vendedor: { caminho: 'SalesPersons', select: 'SalesEmployeeCode,SalesEmployeeName,Active,Email', ordem: 'SalesEmployeeCode', delta: false },
  cliente: { caminho: 'BusinessPartners', select: 'CardCode,CardName,CardForeignName,FederalTaxID,Phone1,EmailAddress,SalesPersonCode,CreditLimit,Frozen,Valid,PriceListNum,BPAddresses,UpdateDate,UpdateTime', ordem: 'CardCode', filtro: "CardType eq 'cCustomer'", delta: true },
  produto: { caminho: 'Items', select: 'ItemCode,ItemName,BarCode,SalesUnit,Frozen,Valid,UpdateDate,UpdateTime', ordem: 'ItemCode', delta: true },
  preco: { caminho: 'Items', select: 'ItemCode,ItemPrices,UpdateDate,UpdateTime', ordem: 'ItemCode', delta: true },
  estoque: { caminho: 'Items', select: 'ItemCode,ItemWarehouseInfoCollection', ordem: 'ItemCode', delta: false },
  forma_pagamento: { caminho: 'PaymentTermsTypes', select: 'GroupNumber,PaymentTermsGroupName', ordem: 'GroupNumber', delta: false },
};

const SIGLA = /^[A-Z]{1,4}$/;
const EAN = /^\d{8}$|^\d{12,14}$/;

type Linha = Record<string, unknown>;
const obj = (v: unknown): Linha | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Linha) : null);

function alteradoEm(l: Linha, cfg: ConfigAdaptador): string {
  return dataHoraLocalParaUtc(l.UpdateDate, l.UpdateTime, cfg.fuso) ?? cfg.agora;
}

const falha = (external_id: string | null, campo: string, mensagem: string): ResultadoConversao => ({ ok: false, external_id, campo, mensagem });
const aspas = (t: string) => t.replace(/'/g, "''");

function converter(entidade: Entidade, bruto: unknown, cfg: ConfigAdaptador): ResultadoConversao {
  const l = obj(bruto);
  if (!l) return falha(null, 'linha', 'A linha do SAP B1 veio fora do formato esperado (objeto).');
  switch (entidade) {
    case 'vendedor': {
      const cod = numeroOuNull(l.SalesEmployeeCode);
      if (cod === null) return falha(null, 'SalesEmployeeCode', 'O vendedor do SAP B1 veio sem SalesEmployeeCode.');
      if (cod < 0) return { ok: true, registros: [] }; // "-Sem vendedor-" do SAP B1: não é vendedor
      const nome = textoOuNull(l.SalesEmployeeName);
      if (!nome) return falha(String(cod), 'SalesEmployeeName', 'O vendedor veio sem nome (SalesEmployeeName).');
      return { ok: true, registros: [{ external_id: String(cod), alterado_em: cfg.agora, ativo: simNao(l.Active) !== false, nome, email: textoOuNull(l.Email) }] };
    }
    case 'cliente': {
      const cod = textoOuNull(l.CardCode);
      if (!cod) return falha(null, 'CardCode', 'O cliente do SAP B1 veio sem CardCode.');
      const nome = textoOuNull(l.CardName);
      if (!nome) return falha(cod, 'CardName', 'O cliente veio sem nome (CardName).');
      const limite = l.CreditLimit === undefined || l.CreditLimit === null ? null : reaisParaCentavos(l.CreditLimit);
      const ends = Array.isArray(l.BPAddresses) ? l.BPAddresses.map(obj).filter((x): x is Linha => x !== null) : [];
      const e = ends.find((x) => x.AddressType === 'bo_BillTo') ?? ends[0];
      const uf = textoOuNull(e?.State)?.toUpperCase();
      const vend = numeroOuNull(l.SalesPersonCode);
      const lista = numeroOuNull(l.PriceListNum);
      return {
        ok: true,
        registros: [
          {
            external_id: cod,
            alterado_em: alteradoEm(l, cfg),
            ativo: simNao(l.Valid) !== false,
            razao_social: nome,
            nome_fantasia: textoOuNull(l.CardForeignName),
            documento: textoOuNull(l.FederalTaxID),
            vendedor_external_id: vend !== null && vend > 0 ? String(vend) : null,
            endereco: e ? { logradouro: textoOuNull(e.Street), numero: textoOuNull(e.StreetNo), complemento: textoOuNull(e.BuildingFloorRoom), bairro: textoOuNull(e.Block), cidade: textoOuNull(e.City), uf: uf && uf.length === 2 ? uf : null, cep: textoOuNull(e.ZipCode) } : null,
            telefone: textoOuNull(l.Phone1),
            email: textoOuNull(l.EmailAddress),
            limite_credito_cents: limite !== null && limite >= 0 ? limite : null,
            bloqueado: simNao(l.Frozen) === true,
            tabela_preco_external_id: lista !== null && lista > 0 ? String(lista) : null,
          },
        ],
      };
    }
    case 'produto': {
      const cod = textoOuNull(l.ItemCode);
      if (!cod) return falha(null, 'ItemCode', 'O item do SAP B1 veio sem ItemCode.');
      const nome = textoOuNull(l.ItemName);
      if (!nome) return falha(cod, 'ItemName', 'O item veio sem nome (ItemName).');
      const un = textoOuNull(l.SalesUnit)?.toUpperCase() ?? null;
      if (!un || !SIGLA.test(un)) return falha(cod, 'SalesUnit', `A unidade de venda do item (${un ?? 'vazia'}) não é uma sigla de 1 a 4 letras. Ajuste a unidade no SAP B1 (ex.: UN, CX, KG).`);
      const ean = textoOuNull(l.BarCode)?.replace(/\s/g, '') ?? null;
      return { ok: true, registros: [{ external_id: cod, alterado_em: alteradoEm(l, cfg), ativo: simNao(l.Frozen) !== true && simNao(l.Valid) !== false, sku: cod, nome, unidade: un, ean: ean && EAN.test(ean) ? ean : null }] };
    }
    case 'preco': {
      const cod = textoOuNull(l.ItemCode);
      if (!cod) return falha(null, 'ItemCode', 'O item do SAP B1 veio sem ItemCode.');
      if (!Array.isArray(l.ItemPrices)) return falha(cod, 'ItemPrices', 'O item veio sem a lista de preços (ItemPrices).');
      const alt = alteradoEm(l, cfg);
      const vig = alt.slice(0, 10);
      const regs: unknown[] = [];
      for (const p of l.ItemPrices) {
        const po = obj(p);
        const lista = po ? numeroOuNull(po.PriceList) : null;
        const cents = po ? reaisParaCentavos(po.Price) : null;
        if (lista === null || cents === null || cents <= 0) continue; // lista sem preço no item: não é preço
        regs.push({ external_id: `${lista}:${cod}`, alterado_em: alt, tabela_external_id: String(lista), tabela_nome: `Lista de preço ${lista}`, vigencia_inicio: vig, produto_external_id: cod, preco_cents: cents });
      }
      return { ok: true, registros: regs };
    }
    case 'estoque': {
      const cod = textoOuNull(l.ItemCode);
      if (!cod) return falha(null, 'ItemCode', 'O item do SAP B1 veio sem ItemCode.');
      if (!Array.isArray(l.ItemWarehouseInfoCollection)) return falha(cod, 'ItemWarehouseInfoCollection', 'O item veio sem o estoque por depósito (ItemWarehouseInfoCollection).');
      const regs: unknown[] = [];
      for (const w of l.ItemWarehouseInfoCollection) {
        const wo = obj(w);
        const dep = wo ? textoOuNull(wo.WarehouseCode) : null;
        const saldo = wo ? numeroOuNull(wo.InStock) : null;
        if (!dep || saldo === null) continue;
        regs.push({ external_id: `${cod}:${dep}`, alterado_em: cfg.agora, deposito_external_id: dep, produto_external_id: cod, saldo: saldo - (numeroOuNull(wo?.Committed) ?? 0) });
      }
      return { ok: true, registros: regs };
    }
    case 'forma_pagamento': {
      const g = numeroOuNull(l.GroupNumber);
      if (g === null) return falha(null, 'GroupNumber', 'A condição de pagamento do SAP B1 veio sem GroupNumber.');
      const nome = textoOuNull(l.PaymentTermsGroupName);
      if (!nome) return falha(String(g), 'PaymentTermsGroupName', 'A condição de pagamento veio sem nome.');
      return { ok: true, registros: [{ external_id: String(g), alterado_em: cfg.agora, codigo: String(g), nome: nome.slice(0, 60) }] };
    }
    default:
      return falha(null, 'entidade', `O modelo SAP B1 ainda não lê a entidade ${entidade} (beta).`);
  }
}

const textoErro = (corpo: unknown): string | null => {
  const e = obj(obj(corpo)?.error);
  const m = e?.message;
  if (typeof m === 'string') return m;
  return textoOuNull(obj(m)?.value);
};

export const adaptadorSapB1: AdaptadorErp = {
  erp: 'sap_b1',
  situacao: 'beta',
  confirmarComCliente: [
    'Licença ou usuário dedicado do Service Layer (porta 50000) e a URL pública em https',
    'Banco do SAP B1 (HANA ou SQL Server): a API é a mesma',
    'Campo definido pelo usuário do UUID do Macuxi no pedido (ex.: U_MXUUID), criado pelo parceiro',
    'Onde fica o CNPJ do cliente (FederalTaxID ou BPFiscalTaxIDCollection) e o formato de UpdateTime',
    'Nome da lista de preço e vigência do preço (aqui: "Lista de preço n" e a data da última alteração do item)',
  ],
  entidadesSuportadas: SUPORTADAS,
  suportaDelta: (e) => COM_DELTA.has(e),
  parametros: [
    { chave: 'company_db', obrigatorio: true, descricao: 'Banco da empresa no SAP B1 (CompanyDB do login)' },
    { chave: 'campo_uuid', obrigatorio: false, descricao: 'Campo do pedido que guarda o UUID do Macuxi (ex.: U_MXUUID); sem ele o pedido vai pelo Conector' },
    { chave: 'fuso_erp', obrigatorio: false, descricao: 'Fuso em que o SAP B1 grava as datas (padrão: o fuso da empresa)' },
  ],
  camposObrigatorios: (e) => CAMPOS_OBRIGATORIOS[e] ?? [],
  requisicaoLogin: (c, cfg) => ({ metodo: 'POST', caminho: 'Login', corpo: { CompanyDB: String(cfg.parametros.company_db ?? ''), UserName: c.usuario ?? '', Password: c.senha } }),
  lerSessao(r, agora) {
    if (r.status === 401 || r.status === 403) return { ok: false, motivo: 'credencial_recusada', status: r.status };
    const id = textoOuNull(obj(r.corpo)?.SessionId);
    if (r.status < 200 || r.status > 299 || !id) return { ok: false, motivo: r.status === 400 ? 'credencial_recusada' : 'formato_mudou', status: r.status };
    const min = numeroOuNull(obj(r.corpo)?.SessionTimeout) ?? 30;
    return { ok: true, sessao: { cabecalhos: { Cookie: `B1SESSION=${id}` }, expiraEm: new Date(Date.parse(agora) + Math.max(1, min - 2) * 60_000).toISOString() } };
  },
  requisicaoPagina(entidade, p, cfg) {
    const d = DESCRICAO[entidade];
    if (!d) throw new Error(`SAP B1: entidade ${entidade} não suportada`);
    const cab = { Prefer: `odata.maxpagesize=${p.tamanho}` };
    if (p.ficha) return { metodo: 'GET', caminho: p.ficha, cabecalhos: cab };
    const filtros: string[] = [];
    if (d.filtro) filtros.push(d.filtro);
    if (p.desde && d.delta) filtros.push(`UpdateDate ge '${localParaFiltro(p.desde, cfg.fuso)}'`);
    return { metodo: 'GET', caminho: d.caminho, query: { $select: d.select, $orderby: d.ordem, ...(filtros.length > 0 ? { $filter: filtros.join(' and ') } : {}) }, cabecalhos: cab };
  },
  lerPagina(_entidade, r) {
    const c = obj(r.corpo);
    if (r.status < 200 || r.status > 299) return { ok: false, status: r.status, motivo: 'formato_mudou', mensagem: `O SAP B1 respondeu HTTP ${r.status}${textoErro(r.corpo) ? `: ${textoErro(r.corpo)}` : ''}` };
    if (!c || !Array.isArray(c.value)) return { ok: false, status: r.status, motivo: 'formato_mudou', mensagem: 'A resposta do SAP B1 não trouxe a lista "value".' };
    return { ok: true, pagina: { linhas: c.value, proxima: caminhoRelativoSeguro(c['odata.nextLink'] ?? c['@odata.nextLink']) } };
  },
  converter,
  pedido: {
    parametroCampoUuid: 'campo_uuid',
    parametrosObrigatorios: ['company_db', 'campo_uuid'],
    requisicaoProcurar: (uuid, cfg) => ({
      metodo: 'GET',
      caminho: 'Orders',
      query: { $select: 'DocEntry,DocNum,DocumentStatus,Cancelled', $filter: `${String(cfg.parametros.campo_uuid ?? 'U_MXUUID')} eq '${aspas(uuid)}'`, $top: '1' },
    }),
    lerProcura(r) {
      const v = obj(r.corpo)?.value;
      const o = Array.isArray(v) ? obj(v[0]) : null;
      const n = o ? (textoOuNull(o.DocNum) ?? textoOuNull(o.DocEntry)) : null;
      return n ? { numero_erp: n } : null;
    },
    requisicaoCriar(p: PedidoParaErp, cfg) {
      const campo = String(cfg.parametros.campo_uuid ?? 'U_MXUUID');
      const vend = numeroOuNull(p.vendedor_external_id);
      const grupo = numeroOuNull(p.condicao_pagamento_erp);
      return {
        metodo: 'POST',
        caminho: 'Orders',
        corpo: {
          CardCode: p.cliente_external_id,
          DocDate: p.aprovado_em.slice(0, 10),
          DocDueDate: p.aprovado_em.slice(0, 10),
          Comments: p.observacao ?? undefined,
          ...(vend !== null ? { SalesPersonCode: vend } : {}),
          ...(grupo !== null ? { PaymentGroupCode: grupo } : {}),
          [campo]: p.pedido_uuid,
          DocumentLines: p.itens.map((i) => ({ ItemCode: i.produto_external_id, Quantity: i.quantidade, UnitPrice: i.preco_unitario_cents / 100, ...(i.desconto_pct ? { DiscountPercent: i.desconto_pct } : {}) })),
        },
      };
    },
    lerCriacao(r) {
      const c = obj(r.corpo);
      return { numero_erp: textoOuNull(c?.DocNum) ?? textoOuNull(c?.DocEntry), motivo: textoErro(r.corpo) };
    },
  },
};

/** A API filtra por DATA (`UpdateDate`): a janela UTC vira a data local do ERP; o dia inteiro volta e o hash descarta o repetido. */
function localParaFiltro(iso: string, fuso: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    return /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : iso.slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}
