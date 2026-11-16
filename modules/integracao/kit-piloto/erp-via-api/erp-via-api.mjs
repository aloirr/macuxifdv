/**
 * T-0162 — "ERP via API" do kit do piloto (empresa teste "Piloto API"). Roda a cada minuto pela tarefa agendada do Windows.
 *
 * O que faz, nesta ordem, usando o ClienteHub (cliente-hub.mjs, o exemplo oficial da API /integracao/v1):
 *   1. Carga: lê as views vw_macuxi_* da ERP_PILOTO e envia ao Hub (cursor nulo = carga completa; com cursor = delta).
 *      A carga roda no máximo a cada INTERVALO_CARGA_MS (o pedido, em toda passada).
 *   2. Pedidos: busca os pendentes, confere cliente e produtos na ERP_PILOTO, grava na entrada de pedidos
 *      (origem 'Piloto API', idempotente por pedido_uuid) e devolve `integrado` com o número do ERP (ou `rejeitado_erp` com o motivo).
 *   3. Retornos: o que o dono do piloto mudar na ERP_PILOTO (rejeitado, cancelado, faturado) volta ao Hub.
 *
 * Este arquivo não importa nada: o executar.mjs injeta o banco (`db`) e o cliente do Hub, e os testes injetam dublês.
 * `db.consultar(sql, params)` devolve as linhas do último conjunto de resultados. Nenhum segredo nem dado de linha vai ao log.
 */

export const ORIGEM = 'Piloto API';
export const INTERVALO_CARGA_MS = 5 * 60 * 1000;
/** Ordem de carga: o que é citado vem antes de quem cita (filial/vendedor -> cliente; produto -> preço/estoque). */
export const ENTIDADES = ['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'preco', 'estoque', 'cliente', 'titulo'];

const BOOLEANOS = new Set(['ativo', 'bloqueado']);
const INTEIROS = new Set([
  'custo_cents', 'preco_venda_cents', 'limite_credito_cents', 'preco_cents', 'valor_cents', 'saldo_cents',
  'embalagem_quantidade', 'prazo_medio_dias', 'prazo_medio_max_dias', 'ordem', 'parcela',
]);
const NUMEROS = new Set(['saldo', 'desconto_maximo_pct', 'latitude', 'longitude']);
const JSONS = new Set(['parcelas_dias', 'formas_pagamento', 'referencias', 'oferece_junto', 'etiquetas', 'contatos']);
const INSTANTES = new Set(['alterado_em', 'baixado_em']);

/** Linha da view -> registro do contrato (mesmo mapeamento do conector.json: nulo some, endereco_* vira o objeto `endereco`). */
export function converterLinha(linha) {
  const registro = {};
  for (const [campo, bruto] of Object.entries(linha)) {
    if (bruto === null || bruto === undefined) continue;
    let valor = bruto;
    if (BOOLEANOS.has(campo)) valor = bruto === true || Number(bruto) === 1;
    else if (INTEIROS.has(campo)) valor = Math.round(Number(bruto));
    else if (NUMEROS.has(campo)) valor = Number(bruto);
    else if (JSONS.has(campo)) valor = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
    else if (INSTANTES.has(campo)) valor = bruto instanceof Date ? bruto.toISOString() : new Date(bruto).toISOString();
    else if (typeof bruto === 'string') valor = bruto.trim();
    if (valor === '') continue;
    if (campo.startsWith('endereco_')) {
      registro.endereco = { ...(registro.endereco ?? {}), [campo.slice('endereco_'.length)]: valor };
    } else {
      registro[campo] = valor;
    }
  }
  return registro;
}

/** Leitura por keyset da view da entidade: só o que é maior que o cursor (alterado_em, external_id em ordem binária). */
export function lerPaginaDaView(db, entidade) {
  if (!ENTIDADES.includes(entidade)) throw new Error(`Entidade desconhecida: ${entidade}.`);
  return async (cursor, limite) => {
    const linhas = await db.consultar(
      `SELECT TOP (@limite) * FROM dbo.vw_macuxi_${entidade}
        WHERE alterado_em > @cursor_alterado_em
           OR (alterado_em = @cursor_alterado_em AND external_id COLLATE Latin1_General_BIN2 > @cursor_external_id)
        ORDER BY alterado_em, external_id COLLATE Latin1_General_BIN2`,
      {
        limite,
        cursor_alterado_em: new Date(cursor?.alterado_em ?? '1900-01-01T00:00:00Z'),
        cursor_external_id: cursor?.external_id ?? '',
      },
    );
    return linhas.map(converterLinha);
  };
}

/** Mensagem do erro sem dado de linha: só o tipo do erro e, nos erros do Hub, o código. */
function mensagemSemDados(e) {
  if (e?.codigo) return `${e.name ?? 'Erro'} (${e.codigo})`;
  return e?.name ?? 'Erro';
}

/** Envia a carga de todas as entidades. Devolve um resumo por entidade (contagens, nada de dado de linha). */
export async function enviarCarga({ cliente, db, log }) {
  const resumo = [];
  for (const entidade of ENTIDADES) {
    const ler = lerPaginaDaView(db, entidade);
    let lotes;
    let cursor;
    try {
      ({ cursor } = await cliente.consultarCursor(entidade));
      lotes = cursor ? await cliente.enviarDelta(entidade, ler, { cursor }) : await cliente.enviarCompleto(entidade, ler);
    } catch (e) {
      if (e && typeof e === 'object') e.entidade = entidade;
      throw e;
    }
    const enviados = lotes.reduce((soma, l) => soma + (l.envelope?.registros?.length ?? 0), 0);
    const comErro = lotes.reduce((soma, l) => soma + (l.resultado?.erros?.length ?? 0), 0);
    resumo.push({ entidade, modo: cursor ? 'delta' : 'completo', lotes: lotes.length, registros: enviados, erros: comErro });
    if (enviados > 0 || comErro > 0) log(`carga ${entidade}: ${enviados} registro(s), ${comErro} erro(s) no Hub`);
  }
  return resumo;
}

/** Parâmetros da procedure do modelo a partir do pedido do Hub. */
export function parametrosDoPedido(p) {
  const f = p.frete ?? null;
  const t = f?.modalidade === 'FOB' ? f.transportadora : null;
  const cad = t && t.tipo === 'cadastrada' ? t : null;
  const e = p.endereco_entrega ?? null;
  const pg = p.pagamento ?? null;
  return {
    pedido_uuid: p.pedido_uuid,
    cliente: p.cliente_external_id,
    vendedor: p.vendedor_external_id,
    condicao: p.condicao_pagamento_erp ?? null,
    criado_em: new Date(p.criado_em),
    aprovado_em: new Date(p.aprovado_em),
    observacao: p.observacao ?? null,
    desconto_total_cents: p.desconto_total_cents ?? 0,
    total_cents: p.total_cents,
    filial_codigo: p.filial?.codigo ?? null,
    filial_external_id: p.filial?.external_id ?? null,
    frete_modalidade: f?.modalidade ?? null,
    frete_transportadora_tipo: t?.tipo ?? null,
    frete_transportadora_id: cad?.id ?? null,
    frete_transportadora_external_id: cad?.external_id ?? null,
    frete_transportadora_nome: t?.nome ?? null,
    frete_transportadora_cnpj: t?.cnpj ?? null,
    frete_transportadora_telefone: t?.telefone ?? null,
    entrega_origem: e ? (e.origem ?? 'erp') : null,
    entrega_external_id: e?.external_id ?? null,
    entrega_logradouro: e?.logradouro ?? null,
    entrega_numero: e?.numero ?? null,
    entrega_complemento: e?.complemento ?? null,
    entrega_bairro: e?.bairro ?? null,
    entrega_cidade: e?.cidade ?? null,
    entrega_uf: e?.uf ?? null,
    entrega_cep: e?.cep ?? null,
    entrega_principal: e?.principal === undefined || e?.principal === null ? null : e.principal ? 1 : 0,
    pagamento_forma_codigo: pg?.forma_codigo ?? null,
    pagamento_forma_external_id: pg?.forma_external_id ?? null,
    pagamento_prazo_codigo: pg?.prazo_codigo ?? null,
    pagamento_prazo_external_id: pg?.prazo_external_id ?? null,
    pagamento_parcelas_dias: pg?.parcelas_dias ? pg.parcelas_dias.join(',') : null,
    pagamento_prazo_medio_dias: pg?.prazo_medio_dias ?? null,
    pagamento_percentual_ajuste: pg?.percentual_ajuste ?? null, // RN-INT-15 (só informativo)
  };
}

/** "ERP" da ERP_PILOTO para o ClienteHub.processarPedidos: confere, grava de forma idempotente e devolve o número. */
export function criarErpPiloto(db, { RejeicaoErp }) {
  return {
    async gravarPedido(pedido) {
      const existente = await db.consultar('SELECT numero_pedido FROM dbo.macuxi_pedido_entrada WHERE pedido_uuid = @pedido_uuid', { pedido_uuid: pedido.pedido_uuid });
      if (existente[0]) return { numero_erp: String(existente[0].numero_pedido) };

      const cliente = await db.consultar('SELECT bloqueado FROM dbo.vw_macuxi_cliente WHERE external_id = @id AND ativo = 1', { id: pedido.cliente_external_id });
      if (!cliente[0]) throw new RejeicaoErp(`Cliente ${pedido.cliente_external_id} não existe ou está inativo na ERP_PILOTO.`);
      if (Number(cliente[0].bloqueado) === 1) throw new RejeicaoErp(`Cliente ${pedido.cliente_external_id} está bloqueado na ERP_PILOTO.`);
      const faltando = [];
      for (const item of pedido.itens) {
        const produto = await db.consultar('SELECT 1 AS ok FROM dbo.vw_macuxi_produto WHERE external_id = @id AND ativo = 1', { id: item.produto_external_id });
        if (!produto[0]) faltando.push(item.produto_external_id);
      }
      if (faltando.length > 0) throw new RejeicaoErp(`Produto(s) fora da ERP_PILOTO: ${[...new Set(faltando)].join(', ')}.`);

      const params = parametrosDoPedido(pedido);
      const chamada = Object.keys(params).map((c) => `@${c} = @${c}`).join(', ');
      const itens = pedido.itens.map((item, i) => {
        params[`seq${i}`] = item.sequencia;
        params[`prod${i}`] = item.produto_external_id;
        params[`qtd${i}`] = item.quantidade;
        params[`preco${i}_cents`] = item.preco_unitario_cents;
        params[`desc${i}_cents`] = item.desconto_cents ?? 0;
        params[`tot${i}_cents`] = item.total_cents;
        return `EXEC dbo.sp_macuxi_pedido_item_inserir @pedido_uuid = @pedido_uuid, @sequencia = @seq${i}, @produto = @prod${i}, @quantidade = @qtd${i}, @preco_unitario_cents = @preco${i}_cents, @desconto_cents = @desc${i}_cents, @total_cents = @tot${i}_cents;`;
      });
      params.origem = ORIGEM;
      const linhas = await db.consultar(
        `SET XACT_ABORT ON; BEGIN TRAN;
         EXEC dbo.sp_macuxi_pedido_inserir ${chamada};
         ${itens.join('\n')}
         UPDATE dbo.macuxi_pedido_entrada SET origem = @origem, retorno_enviado = 'I' WHERE pedido_uuid = @pedido_uuid;
         COMMIT;
         SELECT numero_pedido FROM dbo.macuxi_pedido_entrada WHERE pedido_uuid = @pedido_uuid;`,
        params,
      );
      if (!linhas[0]) throw new Error('A ERP_PILOTO não devolveu o número do pedido gravado.');
      return { numero_erp: String(linhas[0].numero_pedido) };
    },
  };
}

const STATUS_DO_ERP = { R: 'rejeitado_erp', C: 'cancelado', P: 'faturado_parcial', F: 'faturado_total' };
const semMs = (data) => data.toISOString().replace(/\.\d{3}Z$/, 'Z');
/** `situacao_em` da ERP_PILOTO (UTC) vira o `ocorrido_em` do status, como no Conector; sem ele, a hora do envio. */
const instante = (valor) => semMs(valor ? new Date(valor) : new Date());

/**
 * Devolve ao Hub o que o dono do piloto mudou na ERP_PILOTO (situação R, C, P ou F) nos pedidos desta origem.
 * Faturamento sem nota digitada fica para a próxima passada. Retorno definitivo recusado (422) é registrado e não se repete.
 */
export async function enviarRetornos({ cliente, db, ErroHub, log }) {
  const pedidos = await db.consultar(
    `SELECT pedido_uuid, situacao, numero_pedido, motivo, nota_numero, nota_serie, nota_emitida_em, nota_total_cents, situacao_em
       FROM dbo.macuxi_pedido_entrada WHERE origem = @origem AND situacao IN ('R', 'C', 'P', 'F') AND ISNULL(retorno_enviado, '') <> situacao`,
    { origem: ORIGEM },
  );
  const resumo = { enviados: 0, aguardando_nota: 0, recusados: 0 };
  for (const p of pedidos) {
    const status = STATUS_DO_ERP[p.situacao];
    const retorno = { versao_contrato: 'v1', pedido_uuid: String(p.pedido_uuid).toLowerCase(), status, ocorrido_em: instante(p.situacao_em) };
    if (status === 'rejeitado_erp') retorno.motivo = (p.motivo || 'Rejeitado na ERP_PILOTO.').slice(0, 300);
    else if (status === 'cancelado' && p.motivo) retorno.motivo = String(p.motivo).slice(0, 300);
    else if (status === 'faturado_parcial' || status === 'faturado_total') {
      if (!p.nota_numero) {
        resumo.aguardando_nota += 1;
        continue;
      }
      retorno.numero_erp = String(p.numero_pedido);
      retorno.nota = {
        numero: String(p.nota_numero),
        ...(p.nota_serie ? { serie: String(p.nota_serie) } : {}),
        emitida_em: new Date(p.nota_emitida_em ?? Date.now()).toISOString(),
        total_cents: Math.round(Number(p.nota_total_cents ?? 0)),
      };
      const itens = await db.consultar(
        'SELECT sequencia, quantidade, valor_cents, produto_codigo FROM dbo.vw_macuxi_pedido_nota_item WHERE pedido_uuid = @pedido_uuid AND nota_numero = @nota',
        { pedido_uuid: p.pedido_uuid, nota: p.nota_numero },
      );
      if (itens.length > 0) {
        retorno.itens_faturados = itens.map((i) => ({
          sequencia: Number(i.sequencia),
          produto_external_id: String(i.produto_codigo),
          quantidade: Math.round(Number(i.quantidade)),
          valor_cents: Math.round(Number(i.valor_cents)),
        }));
      }
    }
    try {
      await cliente.devolverRetorno(retorno.pedido_uuid, retorno);
      resumo.enviados += 1;
    } catch (e) {
      if (!(e instanceof ErroHub) || e.status !== 422) throw e;
      resumo.recusados += 1;
      log(`retorno recusado pelo Hub (${e.codigo}) no pedido ${retorno.pedido_uuid}`);
    }
    await db.consultar('UPDATE dbo.macuxi_pedido_entrada SET retorno_enviado = @situacao WHERE pedido_uuid = @pedido_uuid', { situacao: p.situacao, pedido_uuid: p.pedido_uuid });
  }
  return resumo;
}

/** Uma passada completa. `estado.ultimaCargaEm` (ms) controla a frequência da carga. Devolve o novo estado e o resumo. */
export async function executarCiclo({ cliente, db, deps, estado = {}, agoraMs = Date.now(), forcarCarga = false, log = () => {} }) {
  const resumo = {};
  let cargaFalhou = false;
  const cargaDevida = forcarCarga || !estado.ultimaCargaEm || agoraMs - estado.ultimaCargaEm >= INTERVALO_CARGA_MS;
  if (cargaDevida) {
    try {
      resumo.carga = await enviarCarga({ cliente, db, log });
    } catch (e) {
      // A carga de uma entidade falhou (ex.: linha da planilha que a view não converte): os pedidos e retornos seguem e a carga fica para a próxima passada.
      // O log diz qual entidade, sem dado de linha.
      cargaFalhou = true;
      log(`carga ${e?.entidade ?? 'desconhecida'} falhou e fica para a próxima passada: ${mensagemSemDados(e)}`);
      resumo.carga = [{ entidade: e?.entidade ?? null, erro: true }];
    }
  }
  const pedidos = await cliente.processarPedidos(criarErpPiloto(db, deps));
  resumo.pedidos = { integrados: pedidos.integrados, rejeitados: pedidos.rejeitados, repetidos: pedidos.repetidos, definitivos: pedidos.definitivos.length };
  if (pedidos.integrados + pedidos.rejeitados + pedidos.definitivos.length > 0) {
    log(`pedidos: ${pedidos.integrados} integrado(s), ${pedidos.rejeitados} rejeitado(s), ${pedidos.definitivos.length} recusa(s) definitiva(s) do Hub`);
  }
  resumo.retornos = await enviarRetornos({ cliente, db, ErroHub: deps.ErroHub, log });
  return { estado: { ...estado, ...(cargaDevida && !cargaFalhou ? { ultimaCargaEm: agoraMs } : {}) }, resumo };
}
