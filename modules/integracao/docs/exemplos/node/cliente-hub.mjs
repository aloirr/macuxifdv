#!/usr/bin/env node
/**
 * T-0108 — Exemplo de cliente da API do Hub (`/integracao/v1`) em Node puro (fetch, Node >= 18, nenhuma dependência).
 *
 * Mostra, de ponta a ponta e seguindo o guia (`../../guia-api-hub.md`):
 *   - cursor por entidade: nulo = carga inicial completa em partes; com cursor = delta;
 *   - delta paginado por cursor (keyset): páginas com (alterado_em, external_id) > cursor, ordenadas, um lote por página;
 *   - Idempotency-Key = SHA-256 do conteúdo estável do lote, SEMPRE a mesma ao repetir (rede, 429, 500, 503, com Retry-After);
 *   - recusa de envelope (400/409/413/422/426) vira RecusaLoteErro e NÃO é repetida;
 *   - erros por linha separados em "reprocessáveis" (o Hub reprocessa sozinho) e "corrigir na origem";
 *   - devolução de pedidos: busca até a lista vir vazia, grava no ERP de forma idempotente e devolve o retorno.
 *
 * Variáveis de ambiente:
 *   MACUXI_HUB_URL            base da API (padrão https://api.macuxifdv.com.br/integracao/v1; HTTPS obrigatório, exceto localhost)
 *   MACUXI_CHAVE              chave de API do Conector (mxc_ + 43 caracteres). Nunca é impressa.
 *   MACUXI_CONECTOR           identificador do Conector cadastrado no BKO (padrão erp-matriz)
 *   MACUXI_CONECTOR_VERSAO    opcional; sem ele o cabeçalho X-Macuxi-Conector-Versao não é enviado
 *   MACUXI_INTERVALO_MS       intervalo entre consultas de um lote (padrão 5000)
 *
 * Rodar a demonstração:  node cliente-hub.mjs
 */
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const URL_PADRAO = 'https://api.macuxifdv.com.br/integracao/v1';
const RE_CHAVE = /^mxc_[A-Za-z0-9_-]{43}$/;
const STATUS_FINAIS = ['concluido', 'concluido_com_erros', 'falhou'];
const STATUS_RECUSA_LOTE = [400, 409, 413, 422, 426];
const LIMITE_LOTE = 5000;

/* ------------------------------------------------------------------ erros ------------------------------------------------------------------ */

/** Erro devolvido pelo Hub (corpo `{ codigo, mensagem, detalhes?, requisicao_id }`). */
export class ErroHub extends Error {
  constructor({ status, codigo, mensagem, requisicao_id = null, detalhes = null, erros = [] }) {
    super(`${status} ${codigo}: ${mensagem}`);
    this.name = 'ErroHub';
    this.status = status;
    this.codigo = codigo;
    this.requisicao_id = requisicao_id;
    this.detalhes = detalhes;
    this.erros = erros;
  }
}

/** Recusa de envelope em POST /lotes (nenhum lote foi criado): corrija o envelope; repetir igual dá o mesmo erro. */
export class RecusaLoteErro extends ErroHub {
  constructor(dados) {
    super(dados);
    this.name = 'RecusaLoteErro';
  }
}

/** O ERP recusou o pedido de forma definitiva (vira o retorno `rejeitado_erp`). */
export class RejeicaoErp extends Error {}

/* ------------------------------------------------------------------ utilidades ------------------------------------------------------------------ */

/** Ordem do cursor: `alterado_em` por instante e, no empate, `external_id` em ordem de bytes (não por idioma). Negativo, 0 ou positivo. */
export function compararCursor(a, b) {
  const dif = Date.parse(a.alterado_em) - Date.parse(b.alterado_em);
  if (dif !== 0) return dif < 0 ? -1 : 1;
  return Buffer.compare(Buffer.from(a.external_id, 'utf8'), Buffer.from(b.external_id, 'utf8'));
}

/** O maior par (alterado_em, external_id) de uma lista de registros (ou null). */
export function maiorCursor(registros) {
  let maior = null;
  for (const r of registros) {
    const par = { alterado_em: r.alterado_em, external_id: r.external_id };
    if (!maior || compararCursor(par, maior) > 0) maior = par;
  }
  return maior;
}

function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * Idempotency-Key do lote: SHA-256 hexadecimal (64 caracteres) das partes estáveis do envelope. `enviado_em`, `cursor`,
 * `conector_id` e `versao_conector` ficam de fora, como no Hub: remontar o lote depois não gera conflito (409).
 */
export function chaveIdempotencia(envelope) {
  const estavel = {
    versao_contrato: envelope.versao_contrato,
    entidade: envelope.entidade,
    modo: envelope.modo,
    sessao: envelope.sessao ?? null,
    registros: envelope.registros,
    linhas_invalidas: envelope.linhas_invalidas ?? [],
    linhas_invalidas_omitidas: envelope.linhas_invalidas_omitidas ?? 0,
  };
  return createHash('sha256').update(canonico(estavel), 'utf8').digest('hex');
}

/** Separa os erros por linha do resultado: o que o Hub reprocessa sozinho × o que se corrige na origem (ERP). */
export function separarErros(erros) {
  return {
    reprocessaveis: erros.filter((e) => e.reprocessavel),
    corrigirNaOrigem: erros.filter((e) => !e.reprocessavel),
  };
}

const esperarPadrao = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lê a configuração do ambiente. Valida URL (HTTPS, salvo localhost) e o formato da chave, sem nunca devolver a chave em mensagem. */
export function lerConfig(env = process.env) {
  const url = (env.MACUXI_HUB_URL ?? URL_PADRAO).replace(/\/+$/, '');
  let analisada;
  try {
    analisada = new URL(url);
  } catch {
    throw new Error('MACUXI_HUB_URL não é uma URL válida.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(analisada.hostname);
  if (analisada.protocol !== 'https:' && !(local && analisada.protocol === 'http:')) {
    throw new Error('MACUXI_HUB_URL precisa ser https:// (http só é aceito para localhost/127.0.0.1).');
  }
  const chave = env.MACUXI_CHAVE ?? '';
  if (!RE_CHAVE.test(chave)) {
    throw new Error('MACUXI_CHAVE ausente ou fora do formato esperado (mxc_ seguido de 43 caracteres). Peça uma chave ao administrador no BKO.');
  }
  const intervalo = Number(env.MACUXI_INTERVALO_MS ?? 5000);
  if (!Number.isFinite(intervalo) || intervalo < 0) throw new Error('MACUXI_INTERVALO_MS precisa ser um número de milissegundos (0 ou mais).');
  return {
    url,
    chave,
    conectorId: env.MACUXI_CONECTOR || 'erp-matriz',
    conectorVersao: env.MACUXI_CONECTOR_VERSAO || undefined,
    intervaloMs: intervalo,
  };
}

/* ------------------------------------------------------------------ cliente ------------------------------------------------------------------ */

export class ClienteHub {
  /**
   * @param {{ url: string, chave: string, conectorId?: string, conectorVersao?: string, intervaloMs?: number,
   *   maxTentativas?: number, esperaBaseMs?: number, esperaMaximaMs?: number, timeoutMs?: number,
   *   esperar?: (ms: number) => Promise<void>, registrar?: (mensagem: string) => void }} cfg
   */
  constructor(cfg) {
    this.url = cfg.url.replace(/\/+$/, '');
    this.conectorId = cfg.conectorId ?? 'erp-matriz';
    this.conectorVersao = cfg.conectorVersao;
    this.intervaloMs = cfg.intervaloMs ?? 5000;
    this.maxTentativas = cfg.maxTentativas ?? 5;
    this.esperaBaseMs = cfg.esperaBaseMs ?? 1000;
    this.esperaMaximaMs = cfg.esperaMaximaMs ?? 60_000;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.esperar = cfg.esperar ?? esperarPadrao;
    this.registrar = cfg.registrar ?? (() => {});
    // A chave fica só aqui, num campo não enumerável: não aparece em console.log(cliente) nem em JSON.
    Object.defineProperty(this, '_chave', { value: cfg.chave, enumerable: false });
  }

  /** Cabeçalhos de toda chamada. `X-Macuxi-Conector-Versao` só vai se foi informada (é opcional e uma versão antiga leva 426). */
  cabecalhos(extras = {}) {
    return {
      Authorization: `Bearer ${this._chave}`,
      'X-Macuxi-Conector-Id': this.conectorId,
      ...(this.conectorVersao ? { 'X-Macuxi-Conector-Versao': this.conectorVersao } : {}),
      Accept: 'application/json',
      ...extras,
    };
  }

  /**
   * Uma chamada com repetição. Repete (com a MESMA requisição, portanto a mesma Idempotency-Key) em erro de rede, 429, 500 e 503,
   * esperando o `Retry-After` (ou espera crescente). Qualquer outra resposta volta como está.
   * @returns {Promise<{ status: number, cabecalhos: Headers, corpo: any }>}
   */
  async requisitar(metodo, caminho, { corpo, cabecalhos = {} } = {}) {
    const texto = corpo === undefined ? undefined : JSON.stringify(corpo);
    const init = {
      method: metodo,
      headers: this.cabecalhos(texto === undefined ? cabecalhos : { 'Content-Type': 'application/json', ...cabecalhos }),
      body: texto,
    };
    let ultimaFalha = null;
    for (let tentativa = 1; tentativa <= this.maxTentativas; tentativa += 1) {
      let resposta;
      try {
        resposta = await fetch(`${this.url}${caminho}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        ultimaFalha = new ErroHub({ status: 0, codigo: 'rede', mensagem: `Falha de rede (${e?.cause?.code ?? e?.name ?? 'desconhecida'}). Verifique a conexão e o endereço do Hub.` });
        if (tentativa < this.maxTentativas) await this.aguardarRepeticao(tentativa, null, 'falha de rede');
        continue;
      }
      const lido = await lerCorpo(resposta);
      if ([429, 500, 503].includes(resposta.status)) {
        ultimaFalha = new ErroHub({ status: resposta.status, codigo: lido?.codigo ?? 'erro_transitorio', mensagem: lido?.mensagem ?? 'Hub indisponível no momento.', requisicao_id: lido?.requisicao_id ?? null });
        if (tentativa < this.maxTentativas) await this.aguardarRepeticao(tentativa, resposta.headers.get('retry-after'), `HTTP ${resposta.status}`);
        continue;
      }
      return { status: resposta.status, cabecalhos: resposta.headers, corpo: lido };
    }
    throw ultimaFalha;
  }

  async aguardarRepeticao(tentativa, retryAfter, motivo) {
    let ms = this.esperaBaseMs * 2 ** (tentativa - 1);
    const segundos = Number(retryAfter);
    if (retryAfter !== null && Number.isFinite(segundos) && segundos >= 0) ms = segundos * 1000;
    else if (retryAfter) {
      const data = Date.parse(retryAfter);
      if (!Number.isNaN(data)) ms = Math.max(0, data - Date.now());
    }
    ms = Math.min(ms, this.esperaMaximaMs);
    this.registrar(`  repetindo em ${ms} ms (${motivo}; tentativa ${tentativa} de ${this.maxTentativas}), mesma requisição`);
    await this.esperar(ms);
  }

  #exigirSucesso(r, esperado = [200]) {
    if (esperado.includes(r.status)) return r.corpo;
    throw new ErroHub({ status: r.status, codigo: r.corpo?.codigo ?? 'erro_http', mensagem: r.corpo?.mensagem ?? `Resposta inesperada do Hub (HTTP ${r.status}).`, requisicao_id: r.corpo?.requisicao_id ?? null, detalhes: r.corpo?.detalhes ?? null, erros: r.corpo?.erros ?? [] });
  }

  /** `GET /cursores/{entidade}`: `{ entidade, cursor|null, atualizado_em|null }`. Cursor nulo = carga inicial completa. */
  async consultarCursor(entidade) {
    return this.#exigirSucesso(await this.requisitar('GET', `/cursores/${encodeURIComponent(entidade)}`));
  }

  /**
   * `POST /lotes` com a Idempotency-Key do conteúdo. Recusas de envelope (400/409/413/422/426) viram RecusaLoteErro, sem repetir.
   * @returns {{ aceito: object, chave: string, repetido: boolean }}
   */
  async enviarLote(envelope) {
    const chave = chaveIdempotencia(envelope);
    const r = await this.requisitar('POST', '/lotes', { corpo: envelope, cabecalhos: { 'Idempotency-Key': chave } });
    if (r.status === 202) {
      return { aceito: r.corpo, chave, repetido: r.corpo.repetido === true || r.cabecalhos.get('idempotent-replay') === 'true' };
    }
    const c = r.corpo ?? {};
    const dados = { status: r.status, codigo: c.codigo ?? 'recusa', mensagem: c.mensagem ?? `Lote recusado (HTTP ${r.status}).`, requisicao_id: c.requisicao_id ?? null, detalhes: c.detalhes ?? null, erros: Array.isArray(c.erros) && c.erros.length ? c.erros : [{ codigo: c.codigo ?? 'recusa', campo: null, mensagem: c.mensagem ?? '' }] };
    if (STATUS_RECUSA_LOTE.includes(r.status)) throw new RecusaLoteErro(dados);
    throw new ErroHub(dados);
  }

  /** `GET /lotes/{id}` até o status final (`concluido`, `concluido_com_erros` ou `falhou`), esperando `intervaloMs` entre consultas. */
  async aguardarLote(loteId, { limiteErros = 1000, maxConsultas = 1000 } = {}) {
    for (let i = 0; i < maxConsultas; i += 1) {
      const resultado = this.#exigirSucesso(await this.requisitar('GET', `/lotes/${loteId}?limite_erros=${limiteErros}`));
      if (STATUS_FINAIS.includes(resultado.status)) return resultado;
      await this.esperar(this.intervaloMs);
    }
    throw new Error(`O lote ${loteId} não terminou depois de ${maxConsultas} consultas.`);
  }

  #montarEnvelope(entidade, modo, registros, extras = {}) {
    const cursor = maiorCursor(registros);
    return {
      versao_contrato: 'v1',
      entidade,
      modo,
      ...(extras.sessao ? { sessao: extras.sessao } : {}),
      ...(cursor ? { cursor } : {}),
      enviado_em: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      conector_id: this.conectorId,
      ...(this.conectorVersao ? { versao_conector: this.conectorVersao } : {}),
      registros,
      ...(extras.linhasInvalidas?.length ? { linhas_invalidas: extras.linhasInvalidas } : {}),
    };
  }

  /** Envia um lote e espera o resultado. Devolve `{ envelope, aceito, chave, repetido, resultado, erros: { reprocessaveis, corrigirNaOrigem } }`. */
  async enviarEAguardar(envelope) {
    const envio = await this.enviarLote(envelope);
    const resultado = await this.aguardarLote(envio.aceito.lote_id);
    if (resultado.status === 'falhou') throw new Error(`O lote ${resultado.lote_id} falhou no Hub. Reenvie o mesmo lote (mesma Idempotency-Key) ou informe o suporte.`);
    return { envelope, ...envio, resultado, erros: separarErros(resultado.erros) };
  }

  /**
   * Delta paginado por cursor (keyset). `lerPagina(cursor, limite)` lê do ERP, ORDENADO, só o que é maior que o cursor
   * (alterado_em, external_id); `validar(registro)` (opcional) devolve `null` ou `{ codigo, campo?, mensagem }` para a linha que o
   * ERP não consegue mandar (vai em `linhas_invalidas`, sem o valor). Um lote por página, até 5.000 registros.
   * @returns {Promise<object[]>} um item por lote enviado (ver enviarEAguardar)
   */
  async enviarDelta(entidade, lerPagina, { cursor = null, tamanhoPagina = LIMITE_LOTE, validar } = {}) {
    if (tamanhoPagina < 1 || tamanhoPagina > LIMITE_LOTE) throw new Error(`tamanhoPagina precisa estar entre 1 e ${LIMITE_LOTE}.`);
    const lotes = [];
    let atual = cursor;
    for (;;) {
      const pagina = await lerPagina(atual, tamanhoPagina);
      if (pagina.length === 0) break;
      const validos = [];
      const linhasInvalidas = [];
      for (const r of pagina) {
        const problema = validar?.(r) ?? null;
        if (problema) linhasInvalidas.push({ external_id: r.external_id ?? null, codigo: problema.codigo, ...(problema.campo ? { campo: problema.campo } : {}), mensagem: problema.mensagem });
        else validos.push(r);
      }
      lotes.push(await this.enviarEAguardar(this.#montarEnvelope(entidade, 'delta', validos, { linhasInvalidas })));
      // O cursor local anda com a página inteira (válidas e inválidas); o do Hub só avança com o que ele aceitou.
      atual = maiorCursor(pagina);
      if (pagina.length < tamanhoPagina) break;
    }
    return lotes;
  }

  /**
   * Carga completa em partes de uma mesma sessão (`sessao.id` UUID, `parte` 1..n, `ultimo: true` só na última). Lê o ERP por
   * páginas (keyset, desde o começo) e olha a página seguinte antes de enviar para saber qual é a última.
   */
  async enviarCompleto(entidade, lerPagina, { tamanhoParte = LIMITE_LOTE } = {}) {
    if (tamanhoParte < 1 || tamanhoParte > LIMITE_LOTE) throw new Error(`tamanhoParte precisa estar entre 1 e ${LIMITE_LOTE}.`);
    const sessaoId = randomUUID();
    const partes = [];
    let atual = await lerPagina(null, tamanhoParte);
    for (let numero = 1; atual.length > 0; numero += 1) {
      const proxima = atual.length === tamanhoParte ? await lerPagina(maiorCursor(atual), tamanhoParte) : [];
      const ultimo = proxima.length === 0;
      partes.push(await this.enviarEAguardar(this.#montarEnvelope(entidade, 'completo', atual, { sessao: { id: sessaoId, parte: numero, ultimo } })));
      atual = proxima;
    }
    return partes;
  }

  /** `GET /pedidos/pendentes?limite=`: o Hub já marca os pedidos como enviados (tentativa + 1). */
  async buscarPendentes(limite = 50) {
    return this.#exigirSucesso(await this.requisitar('GET', `/pedidos/pendentes?limite=${limite}`)).pedidos;
  }

  /** `POST /pedidos/{uuid}/retorno`. 400/422 (inclusive transicao_invalida) são definitivos: viram ErroHub e não se reenvia igual. */
  async devolverRetorno(pedidoUuid, retorno) {
    const r = await this.requisitar('POST', `/pedidos/${pedidoUuid}/retorno`, { corpo: retorno });
    return this.#exigirSucesso(r);
  }

  /**
   * Fluxo de devolução: busca até a lista vir vazia; para cada pedido grava no ERP (idempotente por `pedido_uuid`) e devolve o
   * retorno `integrado` com o `numero_erp`. `erp.gravarPedido(pedido)` devolve `{ numero_erp }` ou lança RejeicaoErp (vira `rejeitado_erp`).
   */
  async processarPedidos(erp, { limite = 50, maxRodadas = 1000 } = {}) {
    const resumo = { rodadas: 0, integrados: 0, rejeitados: 0, repetidos: 0, definitivos: [], descartados: [] };
    for (let rodada = 0; rodada < maxRodadas; rodada += 1) {
      const pedidos = await this.buscarPendentes(limite);
      if (pedidos.length === 0) break;
      resumo.rodadas += 1;
      for (const pedido of pedidos) {
        let retorno;
        try {
          const { numero_erp } = await erp.gravarPedido(pedido);
          retorno = { versao_contrato: 'v1', pedido_uuid: pedido.pedido_uuid, status: 'integrado', numero_erp, ocorrido_em: agora() };
        } catch (e) {
          if (!(e instanceof RejeicaoErp)) throw e; // falha nossa: o pedido volta a "pendente" após 10 min e sai de novo
          retorno = { versao_contrato: 'v1', pedido_uuid: pedido.pedido_uuid, status: 'rejeitado_erp', motivo: e.message.slice(0, 300), ocorrido_em: agora() };
        }
        try {
          const aceito = await this.devolverRetorno(pedido.pedido_uuid, retorno);
          if (aceito.repetido) resumo.repetidos += 1;
          else if (retorno.status === 'integrado') resumo.integrados += 1;
          else resumo.rejeitados += 1;
          for (const d of aceito.itens_descartados ?? []) resumo.descartados.push({ pedido_uuid: pedido.pedido_uuid, ...d });
        } catch (e) {
          if (e instanceof ErroHub && e.status === 422) {
            // 422 é definitivo (pedido_desconhecido, pedido_nao_entregue, transicao_invalida, numero_erp_divergente): não reenviar igual.
            resumo.definitivos.push({ pedido_uuid: pedido.pedido_uuid, codigo: e.codigo, mensagem: e.message, requisicao_id: e.requisicao_id });
            continue;
          }
          throw e;
        }
      }
    }
    return resumo;
  }
}

const agora = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

async function lerCorpo(resposta) {
  const texto = await resposta.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ ERP fictício (só para a demonstração) ------------------------------------------------------------------ */

/** Um "ERP" em memória: produtos, preços e pedidos gravados. Troque pelas suas consultas (SQL, API do ERP...). */
export function criarErpFicticio() {
  const t = (n) => `2026-11-05T13:4${n}:10Z`;
  const produto = (n, nome, alterado) => ({
    external_id: `P00000${n}`,
    alterado_em: alterado,
    ativo: true,
    sku: `REF-000${n}`,
    nome,
    unidade: 'UN',
    preco_venda_cents: 500 + n * 100,
  });
  const preco = (id, produtoId, cents, alterado) => ({
    external_id: `TAB01:${id}`,
    alterado_em: alterado,
    ativo: true,
    tabela_external_id: 'TAB01',
    tabela_nome: 'Tabela Atacado',
    vigencia_inicio: '2026-11-01',
    produto_external_id: produtoId,
    preco_cents: cents,
    unidade: 'UN',
  });
  const dados = {
    produto: [
      produto(1, 'Refrigerante Cola 2 L', t(0)),
      produto(2, 'Suco de Laranja 1 L', t(0)),
      produto(3, 'Água Mineral 500 mL', t(1)),
      produto(4, 'Biscoito Recheado', t(1)),
      produto(5, 'Macarrão Espaguete', t(2)),
      produto(6, 'Arroz Tipo 1 5 kg', t(2)),
      produto(7, 'Feijão Carioca 1 kg', t(3)),
    ],
    preco: [
      preco('P000099', 'P000099', 1250, t(0)), // produto que o ERP ainda não mandou: o Hub devolve referencia_ausente (reprocessável)
      preco('P000098', 'P000098', -50, t(0)), // preço negativo: o cliente NÃO envia, registra em linhas_invalidas (corrigir na origem)
      preco('P000001', 'P000001', 790, t(2)),
      preco('P000002', 'P000002', 650, t(3)),
      preco('P000003', 'P000003', 300, t(3)),
    ],
  };
  const pedidosGravados = new Map(); // pedido_uuid -> numero_erp (a "tabela do ERP" com o UUID guardado)
  return {
    pedidosGravados,
    /** Leitura por keyset: ordenada por (alterado_em, external_id) e só o que é maior que o cursor. */
    lerPagina(entidade) {
      return async (cursor, limite) =>
        dados[entidade]
          .filter((r) => !cursor || compararCursor(r, cursor) > 0)
          .sort(compararCursor)
          .slice(0, limite)
          .map((r) => ({ ...r }));
    },
    /** Validação local de uma linha do ERP antes de enviar (dado que o Hub recusaria de qualquer jeito). */
    validarPreco(r) {
      return r.preco_cents < 0 ? { codigo: 'valor_fora_da_faixa', campo: 'preco_cents', mensagem: 'preco_cents está negativo no ERP.' } : null;
    },
    /** Grava o pedido uma única vez por `pedido_uuid`: repetir a chamada devolve o mesmo número (idempotente). */
    async gravarPedido(pedido) {
      if (!pedidosGravados.has(pedido.pedido_uuid)) {
        pedidosGravados.set(pedido.pedido_uuid, `PV-${String(4500 + pedidosGravados.size + 12).padStart(6, '0')}`);
      }
      return { numero_erp: pedidosGravados.get(pedido.pedido_uuid) };
    },
  };
}

/* ------------------------------------------------------------------ demonstração ------------------------------------------------------------------ */

function mostrarResultado(log, rotulo, r) {
  const c = r.resultado.contagens;
  log(`  ${rotulo}: ${r.resultado.status} (recebidas ${c.recebidas}, novas ${c.novas}, atualizadas ${c.atualizadas}, inalteradas ${c.inalteradas}, com erro ${c.com_erro})`);
  for (const e of r.erros.reprocessaveis) log(`    reprocessável  ${e.external_id} ${e.codigo} em ${e.campo}: o Hub reprocessa sozinho quando o alvo chegar`);
  for (const e of r.erros.corrigirNaOrigem) log(`    corrigir no ERP ${e.external_id} ${e.codigo} em ${e.campo ?? '-'} (origem ${e.origem})`);
}

export async function main(env = process.env, log = console.log) {
  let cfg;
  try {
    cfg = lerConfig(env);
  } catch (e) {
    console.error(`Configuração inválida: ${e.message}`);
    return 2;
  }
  const cliente = new ClienteHub({ ...cfg, registrar: log });
  const erp = criarErpFicticio();
  log(`Hub: ${cfg.url} | Conector: ${cfg.conectorId}${cfg.conectorVersao ? ` v${cfg.conectorVersao}` : ''}`);

  // 1) Onde continuar? Cursor nulo = carga inicial completa; com cursor = só o delta.
  log('\n1) Produtos');
  const { cursor } = await cliente.consultarCursor('produto');
  let ultimo = null;
  if (cursor === null) {
    log('  cursor nulo: carga completa em partes (na demonstração, 3 por parte; na vida real, até 5.000)');
    const partes = await cliente.enviarCompleto('produto', erp.lerPagina('produto'), { tamanhoParte: 3 });
    partes.forEach((p, i) => mostrarResultado(log, `parte ${i + 1} (ultimo=${p.envelope.sessao.ultimo})`, p));
    ultimo = partes.at(-1) ?? null;
  } else {
    log(`  cursor em ${cursor.alterado_em} / ${cursor.external_id}: só o delta`);
    const lotes = await cliente.enviarDelta('produto', erp.lerPagina('produto'), { cursor, tamanhoPagina: 3 });
    lotes.forEach((p, i) => mostrarResultado(log, `página ${i + 1}`, p));
    if (lotes.length === 0) log('  nada novo desde o cursor: nenhum lote enviado');
    ultimo = lotes.at(-1) ?? null;
  }

  // 2) Delta de preços com erros por linha.
  log('\n2) Preços (delta com erros por linha)');
  const cursorPreco = (await cliente.consultarCursor('preco')).cursor;
  const lotesPreco = await cliente.enviarDelta('preco', erp.lerPagina('preco'), { cursor: cursorPreco, tamanhoPagina: 10, validar: erp.validarPreco });
  lotesPreco.forEach((p, i) => mostrarResultado(log, `página ${i + 1}`, p));
  if (lotesPreco.length === 0) log('  nada novo desde o cursor: nenhum lote enviado');
  ultimo = lotesPreco.at(-1) ?? ultimo;

  // 3) Reenviar o MESMO lote (resposta perdida): mesma Idempotency-Key, mesmo lote_id, repetido: true.
  log('\n3) Reenvio do mesmo lote');
  if (ultimo) {
    const novamente = await cliente.enviarLote(ultimo.envelope);
    log(`  mesma chave (${novamente.chave.slice(0, 12)}...): lote ${novamente.aceito.lote_id === ultimo.aceito.lote_id ? 'o mesmo' : 'DIFERENTE (inesperado)'}, repetido=${novamente.repetido}`);
  } else {
    log('  nenhum lote enviado nesta execução; nada a reenviar');
  }

  // 4) Recusa de envelope: nenhum lote é criado e a recusa NÃO é repetida.
  log('\n4) Recusa de envelope (lote vazio)');
  try {
    await cliente.enviarLote({ versao_contrato: 'v1', entidade: 'vendedor', modo: 'delta', registros: [] });
    log('  inesperado: o Hub aceitou um lote vazio');
  } catch (e) {
    if (!(e instanceof RecusaLoteErro)) throw e;
    log(`  RecusaLote ${e.status} ${e.codigo}: ${e.erros[0].mensagem} (requisicao_id ${e.requisicao_id})`);
  }

  // 5) Devolução de pedidos.
  log('\n5) Pedidos aprovados');
  const resumo = await cliente.processarPedidos(erp);
  log(`  rodadas ${resumo.rodadas}, integrados ${resumo.integrados}, rejeitados ${resumo.rejeitados}, repetidos ${resumo.repetidos}`);
  for (const [uuid, numero] of erp.pedidosGravados) log(`  pedido ${uuid} gravado no ERP como ${numero}`);
  for (const d of resumo.descartados) log(`  item descartado no pedido ${d.pedido_uuid}: ${d.codigo} em ${d.campo}`);
  for (const d of resumo.definitivos) log(`  recusa definitiva (não reenviar) do pedido ${d.pedido_uuid}: ${d.codigo}`);
  if (resumo.rodadas === 0) log('  nenhum pedido pendente');
  log('\nConcluído.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((codigo) => {
      process.exitCode = codigo;
    })
    .catch((e) => {
      // Só o resumo do erro (código HTTP, código do Hub e requisicao_id): nunca a chave nem o corpo enviado.
      console.error(`Falhou: ${e instanceof ErroHub ? `${e.message} (requisicao_id ${e.requisicao_id ?? '-'})` : e.message}`);
      process.exitCode = 1;
    });
}
