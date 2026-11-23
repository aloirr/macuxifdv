/**
 * Adaptador Sankhya (gateway `https://api.sankhya.com.br`; serviços `mge/service.sbr`). F4a, modelo BETA (D9).
 *
 * [P] conhecimento público (documentação Sankhya e uso amplo dos parceiros):
 *  - login no gateway com os cabeçalhos `appkey`, `token`, `username` e `password` devolve `bearerToken`;
 *  - leitura por `CRUDServiceProvider.loadRecords` (`dataSet` com `rootEntity`, `criteria.expression`, `entity.fieldset.list`),
 *    resposta em `responseBody.entities` com `metadata.fields.field[]` e `entity[]` de `f0`, `f1`… (valor em `$`), `hasMoreResult`;
 *  - entidades `Parceiro` (TGFPAR), `Vendedor` (TGFVEN), `Produto` (TGFPRO), `Estoque` (TGFEST), `TipoNegociacao` (TGFTPV);
 *  - `DTALTER` em `Parceiro` (data de alteração); datas em `dd/MM/yyyy HH:mm:ss`; sim/não em `S`/`N`;
 *  - pedido por `CACSP.incluirNota` (`cabecalho` e `itens` com campos `{ "$": valor }`), nota de pedido com `TIPMOV = 'P'`.
 * [C] a confirmar com o cliente:
 *  - contrato de API com a Sankhya e a appkey do parceiro; o gateway novo (OAuth) pode substituir o `login` por cabeçalhos;
 *  - a TOP de pedido do cliente (`top_pedido`), a empresa (`codigo_empresa`) e o campo adicional do UUID (`AD_MXUUID`, parâmetro `campo_uuid`);
 *  - a página do `loadRecords` é fixa do lado da Sankhya (o tamanho pedido é ignorado); `statusMessage` pode vir em base64;
 *  - `DTALTER` só foi assumida em `Parceiro`; produto, estoque, vendedor e forma vão em leitura completa;
 *  - endereço do parceiro (TSIEND/TSIBAI/TSICID) e preço (TGFTAB/TGFEXC) ficam para depois da confirmação: a entidade não é suportada ainda.
 */
import type { Entidade, PedidoParaErp } from '../../contracts';
import { dataBrParaPartes, dataHoraLocalParaUtc, numeroOuNull, reaisParaCentavos, simNao, textoOuNull } from './conversao';
import type { AdaptadorErp, ConfigAdaptador, RespostaErp, ResultadoConversao } from './tipos';

type Linha = Record<string, unknown>;
const obj = (v: unknown): Linha | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Linha) : null);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

const SUPORTADAS = ['vendedor', 'cliente', 'produto', 'estoque', 'forma_pagamento'] as const satisfies readonly Entidade[];

interface Descricao {
  entidade: string;
  campos: readonly string[];
  /** Critério fixo (sem a data). */
  criterio?: string;
  /** Campo de data de alteração; ausente = sem delta. */
  dataAlteracao?: string;
}

const DESCRICAO: Partial<Record<Entidade, Descricao>> = {
  vendedor: { entidade: 'Vendedor', campos: ['CODVEND', 'APELIDO', 'ATIVO', 'EMAIL'] },
  cliente: { entidade: 'Parceiro', campos: ['CODPARC', 'NOMEPARC', 'RAZAOSOCIAL', 'CGC_CPF', 'CODVEND', 'LIMCRED', 'BLOQUEAR', 'ATIVO', 'TELEFONE', 'EMAIL', 'DTALTER'], criterio: "this.CLIENTE = 'S'", dataAlteracao: 'DTALTER' },
  produto: { entidade: 'Produto', campos: ['CODPROD', 'DESCRPROD', 'CODVOL', 'ATIVO'] },
  estoque: { entidade: 'Estoque', campos: ['CODEMP', 'CODPROD', 'CODLOCAL', 'ESTOQUE', 'RESERVADO'] },
  forma_pagamento: { entidade: 'TipoNegociacao', campos: ['CODTIPVENDA', 'DESCRTIPVENDA', 'ATIVO'] },
};

const SIGLA = /^[A-Z]{1,4}$/;
const aspas = (t: string) => t.replace(/'/g, "''");

/** Mensagem do `statusMessage`: a Sankhya costuma mandar em base64. Só devolve texto que decodifica para algo imprimível. */
function mensagemStatus(corpo: unknown): string | null {
  const m = textoOuNull(obj(corpo)?.statusMessage);
  if (!m) return null;
  if (/^[A-Za-z0-9+/]{8,}={0,2}$/.test(m) && m.length % 4 === 0) {
    const t = Buffer.from(m, 'base64').toString('utf8');
    // eslint-disable-next-line no-control-regex
    if (t.length > 0 && !/[\u0000-\u0008\u000e-\u001f�]/.test(t)) return t;
  }
  return m;
}

/** Transforma `entities` do `loadRecords` em linhas `{ CAMPO: valor }` (valor textual do `$`). */
function linhasDeEntities(corpo: unknown): { ok: true; linhas: Linha[]; mais: boolean; pagina: number } | { ok: false } {
  const ent = obj(obj(obj(corpo)?.responseBody)?.entities);
  if (!ent) return { ok: false };
  const campos = lista(obj(ent.metadata)?.fields && obj(obj(ent.metadata)?.fields)?.field)
    .map((f) => textoOuNull(obj(f)?.name))
    .filter((n): n is string => n !== null);
  const linhas = lista(ent.entity).map((e) => {
    const o = obj(e) ?? {};
    const l: Linha = {};
    campos.forEach((c, i) => {
      const v = obj(o[`f${i}`])?.$;
      if (v !== undefined) l[c] = v;
    });
    return l;
  });
  return { ok: true, linhas, mais: String(ent.hasMoreResult) === 'true', pagina: Number(ent.offsetPage ?? 0) || 0 };
}

const falha = (external_id: string | null, campo: string, mensagem: string): ResultadoConversao => ({ ok: false, external_id, campo, mensagem });

function converter(entidade: Entidade, bruto: unknown, cfg: ConfigAdaptador): ResultadoConversao {
  const l = obj(bruto);
  if (!l) return falha(null, 'linha', 'A linha da Sankhya veio fora do formato esperado (objeto).');
  switch (entidade) {
    case 'vendedor': {
      const cod = textoOuNull(l.CODVEND);
      if (!cod) return falha(null, 'CODVEND', 'O vendedor da Sankhya veio sem CODVEND.');
      if (cod === '0') return { ok: true, registros: [] }; // vendedor 0 = "sem vendedor"
      const nome = textoOuNull(l.APELIDO);
      if (!nome) return falha(cod, 'APELIDO', 'O vendedor veio sem nome (APELIDO).');
      return { ok: true, registros: [{ external_id: cod, alterado_em: cfg.agora, ativo: simNao(l.ATIVO) !== false, nome, email: textoOuNull(l.EMAIL) }] };
    }
    case 'cliente': {
      const cod = textoOuNull(l.CODPARC);
      if (!cod) return falha(null, 'CODPARC', 'O parceiro da Sankhya veio sem CODPARC.');
      const nome = textoOuNull(l.RAZAOSOCIAL) ?? textoOuNull(l.NOMEPARC);
      if (!nome) return falha(cod, 'NOMEPARC', 'O parceiro veio sem nome (NOMEPARC).');
      const d = dataBrParaPartes(l.DTALTER);
      const limite = l.LIMCRED === undefined || l.LIMCRED === null || l.LIMCRED === '' ? null : reaisParaCentavos(l.LIMCRED);
      const vend = textoOuNull(l.CODVEND);
      return {
        ok: true,
        registros: [
          {
            external_id: cod,
            alterado_em: d ? (dataHoraLocalParaUtc(d.data, d.hora, cfg.fuso) ?? cfg.agora) : cfg.agora,
            ativo: simNao(l.ATIVO) !== false,
            razao_social: nome,
            nome_fantasia: textoOuNull(l.NOMEPARC) !== nome ? textoOuNull(l.NOMEPARC) : null,
            documento: textoOuNull(l.CGC_CPF),
            vendedor_external_id: vend && vend !== '0' ? vend : null,
            telefone: textoOuNull(l.TELEFONE),
            email: textoOuNull(l.EMAIL),
            limite_credito_cents: limite !== null && limite >= 0 ? limite : null,
            bloqueado: simNao(l.BLOQUEAR) === true,
          },
        ],
      };
    }
    case 'produto': {
      const cod = textoOuNull(l.CODPROD);
      if (!cod) return falha(null, 'CODPROD', 'O produto da Sankhya veio sem CODPROD.');
      const nome = textoOuNull(l.DESCRPROD);
      if (!nome) return falha(cod, 'DESCRPROD', 'O produto veio sem descrição (DESCRPROD).');
      const un = textoOuNull(l.CODVOL)?.toUpperCase() ?? null;
      if (!un || !SIGLA.test(un)) return falha(cod, 'CODVOL', `A unidade do produto (${un ?? 'vazia'}) não é uma sigla de 1 a 4 letras. Ajuste o volume no cadastro da Sankhya (ex.: UN, CX, KG).`);
      return { ok: true, registros: [{ external_id: cod, alterado_em: cfg.agora, ativo: simNao(l.ATIVO) !== false, sku: cod, nome, unidade: un }] };
    }
    case 'estoque': {
      const emp = textoOuNull(l.CODEMP);
      const prod = textoOuNull(l.CODPROD);
      const local = textoOuNull(l.CODLOCAL) ?? '0';
      if (!emp || !prod) return falha(prod, 'CODEMP', 'O estoque da Sankhya veio sem empresa (CODEMP) ou produto (CODPROD).');
      const est = numeroOuNull(l.ESTOQUE);
      if (est === null) return falha(`${emp}:${prod}:${local}`, 'ESTOQUE', 'O estoque veio sem saldo (ESTOQUE).');
      return { ok: true, registros: [{ external_id: `${emp}:${prod}:${local}`, alterado_em: cfg.agora, deposito_external_id: `${emp}:${local}`, produto_external_id: prod, saldo: est - (numeroOuNull(l.RESERVADO) ?? 0), filial_external_id: emp }] };
    }
    case 'forma_pagamento': {
      const cod = textoOuNull(l.CODTIPVENDA);
      if (!cod) return falha(null, 'CODTIPVENDA', 'O tipo de negociação da Sankhya veio sem CODTIPVENDA.');
      const nome = textoOuNull(l.DESCRTIPVENDA);
      if (!nome) return falha(cod, 'DESCRTIPVENDA', 'O tipo de negociação veio sem descrição (DESCRTIPVENDA).');
      return { ok: true, registros: [{ external_id: cod, alterado_em: cfg.agora, ativo: simNao(l.ATIVO) !== false, codigo: cod.slice(0, 20), nome: nome.slice(0, 60) }] };
    }
    default:
      return falha(null, 'entidade', `O modelo Sankhya ainda não lê a entidade ${entidade} (beta).`);
  }
}

const SERVICO = 'gateway/v1/mge/service.sbr';
const requisicaoServico = (servico: string, corpo: unknown) => ({ metodo: 'POST' as const, caminho: SERVICO, query: { serviceName: servico, outputType: 'json' }, corpo: { serviceName: servico, requestBody: corpo } });

function criterioData(desde: string, campo: string, fuso: string): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(desde));
  return `this.${campo} >= TO_DATE('${p} 00:00:00','DD/MM/YYYY HH24:MI:SS')`;
}

const statusOk = (r: RespostaErp) => r.status >= 200 && r.status <= 299 && String(obj(r.corpo)?.status) === '1';

export const adaptadorSankhya: AdaptadorErp = {
  erp: 'sankhya',
  situacao: 'beta',
  confirmarComCliente: [
    'Contrato de API com a Sankhya, appkey do parceiro e token do cliente',
    'TOP de pedido, empresa e o campo adicional do UUID do Macuxi no cabeçalho da nota (ex.: AD_MXUUID)',
    'DTALTER em produto, estoque e vendedor (hoje só o parceiro filtra por data)',
    'Endereço do parceiro e tabela de preço (ainda não lidos) e o tamanho da página do loadRecords',
  ],
  entidadesSuportadas: SUPORTADAS,
  suportaDelta: (e) => DESCRICAO[e]?.dataAlteracao !== undefined,
  parametros: [
    { chave: 'codigo_empresa', obrigatorio: false, descricao: 'Empresa da Sankhya que recebe o pedido (CODEMP); obrigatório para o pedido pela API' },
    { chave: 'top_pedido', obrigatorio: false, descricao: 'TOP de pedido de venda do cliente (CODTIPOPER); obrigatório para o pedido pela API' },
    { chave: 'campo_uuid', obrigatorio: false, descricao: 'Campo adicional do cabeçalho que guarda o UUID do Macuxi (ex.: AD_MXUUID); sem ele o pedido vai pelo Conector' },
    { chave: 'fuso_erp', obrigatorio: false, descricao: 'Fuso em que a Sankhya grava as datas (padrão: o fuso da empresa)' },
  ],
  camposObrigatorios: (e) => (DESCRICAO[e] ? DESCRICAO[e]!.campos.slice(0, 2) : []),
  requisicaoLogin: (c) => ({ metodo: 'POST', caminho: 'login', cabecalhos: { appkey: c.appkey ?? '', token: c.token ?? '', username: c.usuario ?? '', password: c.senha } }),
  lerSessao(r) {
    if (r.status === 401 || r.status === 403) return { ok: false, motivo: 'credencial_recusada', status: r.status };
    const t = textoOuNull(obj(r.corpo)?.bearerToken);
    if (r.status < 200 || r.status > 299 || !t) return { ok: false, motivo: r.status === 400 ? 'credencial_recusada' : 'formato_mudou', status: r.status };
    // o bearer da Sankhya vale ~5 min [C]: a API renova antes (expiraEm)
    return { ok: true, sessao: { cabecalhos: { Authorization: `Bearer ${t}` }, expiraEm: null } };
  },
  requisicaoPagina(entidade, p, cfg) {
    const d = DESCRICAO[entidade];
    if (!d) throw new Error(`Sankhya: entidade ${entidade} não suportada`);
    const criterios: string[] = [];
    if (d.criterio) criterios.push(d.criterio);
    if (p.desde && d.dataAlteracao) criterios.push(criterioData(p.desde, d.dataAlteracao, cfg.fuso));
    return requisicaoServico('CRUDServiceProvider.loadRecords', {
      dataSet: {
        rootEntity: d.entidade,
        includePresentationFields: 'N',
        offsetPage: p.ficha ?? '0',
        ...(criterios.length > 0 ? { criteria: { expression: { $: criterios.join(' AND ') } } } : {}),
        entity: { fieldset: { list: d.campos.join(',') } },
      },
    });
  },
  lerPagina(_entidade, r) {
    if (r.status < 200 || r.status > 299) return { ok: false, status: r.status, motivo: 'formato_mudou', mensagem: `A Sankhya respondeu HTTP ${r.status}` };
    if (String(obj(r.corpo)?.status) !== '1') return { ok: false, status: r.status, motivo: 'formato_mudou', mensagem: `A Sankhya recusou a consulta${mensagemStatus(r.corpo) ? `: ${mensagemStatus(r.corpo)}` : ''}` };
    const e = linhasDeEntities(r.corpo);
    if (!e.ok) return { ok: false, status: r.status, motivo: 'formato_mudou', mensagem: 'A resposta da Sankhya não trouxe responseBody.entities.' };
    return { ok: true, pagina: { linhas: e.linhas, proxima: e.mais ? String(e.pagina + 1) : null } };
  },
  converter,
  pedido: {
    parametroCampoUuid: 'campo_uuid',
    parametrosObrigatorios: ['campo_uuid', 'top_pedido', 'codigo_empresa'],
    requisicaoProcurar: (uuid, cfg) =>
      requisicaoServico('CRUDServiceProvider.loadRecords', {
        dataSet: { rootEntity: 'CabecalhoNota', includePresentationFields: 'N', offsetPage: '0', criteria: { expression: { $: `this.${String(cfg.parametros.campo_uuid ?? 'AD_MXUUID')} = '${aspas(uuid)}' AND this.TIPMOV = 'P'` } }, entity: { fieldset: { list: 'NUNOTA' } } },
      }),
    lerProcura(r) {
      const e = linhasDeEntities(r.corpo);
      const n = e.ok ? textoOuNull(e.linhas[0]?.NUNOTA) : null;
      return n ? { numero_erp: n } : null;
    },
    requisicaoCriar(p: PedidoParaErp, cfg) {
      const campo = String(cfg.parametros.campo_uuid ?? 'AD_MXUUID');
      const v = (x: unknown) => ({ $: String(x) });
      const tipvenda = numeroOuNull(p.condicao_pagamento_erp);
      return requisicaoServico('CACSP.incluirNota', {
        nota: {
          cabecalho: {
            NUNOTA: {},
            CODEMP: v(cfg.parametros.codigo_empresa ?? ''),
            CODPARC: v(p.cliente_external_id),
            CODVEND: v(p.vendedor_external_id),
            CODTIPOPER: v(cfg.parametros.top_pedido ?? ''),
            TIPMOV: v('P'),
            DTNEG: v(dataBrDoDia(p.aprovado_em)),
            ...(tipvenda !== null ? { CODTIPVENDA: v(tipvenda) } : {}),
            ...(p.observacao ? { OBSERVACAO: v(p.observacao) } : {}),
            [campo]: v(p.pedido_uuid),
          },
          itens: { INFORMARPRECO: 'True', item: p.itens.map((i) => ({ NUNOTA: {}, CODPROD: v(i.produto_external_id), QTDNEG: v(i.quantidade), VLRUNIT: v(i.preco_unitario_cents / 100) })) },
        },
      });
    },
    lerCriacao(r) {
      const c = obj(r.corpo);
      if (statusOk(r)) return { numero_erp: textoOuNull(obj(obj(obj(c?.responseBody)?.pk)?.NUNOTA)?.$), motivo: null };
      return { numero_erp: null, motivo: mensagemStatus(c) };
    },
  },
};

/** `dd/MM/yyyy` do dia UTC do instante (a Sankhya usa a data de negociação). */
function dataBrDoDia(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
