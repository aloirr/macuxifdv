#!/usr/bin/env node
/**
 * Conferência da DEMO NO AR (agente `testes`, T-0065): só leitura, contra a API que o `subir-demo.ps1` deixou rodando.
 * Não cria pedido nem coleta (a única escrita é um push de pedido do PROMOTOR, que a API tem de recusar — RN-PRO-01 —
 * e não grava nada). Complementa o smoke-demo.test.ts (banco efêmero): aqui é a base `demo` real, recriada pelo seed.
 *
 * Uso: node tests/scripts/demo-no-ar.mjs [--api http://127.0.0.1:8100] [--senha demo-macuxi]
 * Saída: uma linha por item (OK | FALHA | AVISO) e código 1 se houver FALHA.
 */
import { randomUUID } from 'node:crypto';

const arg = (k, padrao) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : padrao;
};
const API = (arg('--api', process.env.MACUXI_DEMO_API ?? 'http://127.0.0.1:8100')).replace(/\/$/, '');
const SENHA = arg('--senha', process.env.MACUXI_SENHA_DEMO ?? 'demo-macuxi');
const DEMO = {
  vendedor: 'vendedor@exemplo.com.br',
  vendedor2: 'vendedor2@exemplo.com.br',
  promotor: 'promotor@exemplo.com.br',
  supervisor: 'supervisor@exemplo.com.br',
  gerente: 'gerente@exemplo.com.br',
  analista: 'analista@exemplo.com.br',
  admin: 'admin@exemplo.com.br',
};
const ENT_PROMOTOR_CADASTRO = ['categoria_gondola', 'checklist_loja', 'mix_obrigatorio', 'meta_share', 'concorrente', 'produto_concorrente', 'foto_referencia', 'tarefa_trade', 'ponto_extra_negociado'];
const ENT_PESQUISA = ['questionario_versao', 'resposta_pesquisa'];
const ENT_TREINAMENTO = ['trilha', 'progresso', 'tentativa', 'xp_lancamento', 'medalha_usuario'];

let falhas = 0;
const linha = (estado, id, texto) => {
  if (estado === 'FALHA') falhas++;
  console.log(`${estado.padEnd(5)} ${id.padEnd(8)} ${texto}`);
};
const confere = (id, ok, texto, detalhe = '') => linha(ok ? 'OK' : 'FALHA', id, ok ? texto : `${texto} — ${detalhe}`);

async function http(metodo, caminho, token, corpo) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'content-type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const txt = await r.text();
  let json = null;
  try {
    json = JSON.parse(txt);
  } catch {
    json = { texto: txt.slice(0, 200) };
  }
  return { status: r.status, corpo: json };
}
const lista = (c) => (Array.isArray(c) ? c : (c?.itens ?? c?.items ?? c?.data ?? c?.pedidos ?? []));

/** Puxa todas as páginas da entidade; devolve { status, itens, codigo }. */
async function puxar(token, entidade) {
  const itens = [];
  let cursor = null;
  for (let pag = 0; pag < 200; pag++) {
    const r = await http('GET', `/v1/sync/pull?entidade=${entidade}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, token);
    if (r.status !== 200) return { status: r.status, itens, codigo: r.corpo?.codigo ?? r.corpo?.erro?.codigo ?? r.corpo?.code ?? '' };
    itens.push(...(r.corpo.itens ?? []));
    if (!r.corpo.proximo_cursor) break;
    cursor = r.corpo.proximo_cursor;
  }
  return { status: 200, itens, codigo: '' };
}

async function main() {
  const saude = await http('GET', '/v1/saude').catch((e) => ({ status: 0, corpo: { erro: String(e) } }));
  confere('saude', saude.status === 200, `GET ${API}/v1/saude`, `${saude.status} ${JSON.stringify(saude.corpo)}`);
  if (saude.status !== 200) return;

  const token = {};
  const usuario = {};
  const modulos = {};
  for (const [k, email] of Object.entries(DEMO)) {
    const r = await http('POST', '/v1/auth/login', null, { codigo_empresa: 'demo', email, senha: SENHA });
    confere('login', r.status === 200, `login ${k} (${email})`, `${r.status} ${JSON.stringify(r.corpo)}`);
    if (r.status !== 200) continue;
    token[k] = r.corpo.access_token;
    usuario[k] = r.corpo.usuario;
    const m = await http('GET', '/v1/me/modulos', token[k]);
    modulos[k] = (m.corpo?.modulos ?? []).map((x) => x.id).sort();
    linha('INFO', 'modulos', `${k}: ${modulos[k].join(', ')}`);
  }
  if (!token.vendedor || !token.supervisor || !token.promotor) return;

  // RN-PRO-01 e licenças do seed
  confere('RN-PRO', !modulos.promotor.includes('vendedor'), 'promotor sem o Vendedor nos módulos', modulos.promotor.join(','));
  confere('M-D21', modulos.promotor.includes('promotor'), 'promotor com o Promotor licenciado (aba Loja)', modulos.promotor.join(','));
  confere('M-D20', (modulos.supervisor ?? []).includes('gestor') && (modulos.gerente ?? []).includes('gestor'), 'supervisora e gerente com o Gestor (Equipe/Aprovações)', `${modulos.supervisor} | ${modulos.gerente}`);
  confere('PES', ['vendedor', 'promotor', 'supervisor'].every((k) => (modulos[k] ?? []).includes('pesquisa')), 'Pesquisa licenciada para vendedor, promotor e supervisora');
  const comTreino = Object.entries(modulos).filter(([, m]) => m.includes('treinamento')).map(([k]) => k);
  linha(comTreino.length ? 'INFO' : 'AVISO', 'TRE', comTreino.length ? `Treinamento licenciado para: ${comTreino.join(', ')}` : 'Treinamento não licenciado na base (seed sem a 0017 ou sem gravarTreinamentoDemo)');

  // M-D13: novidades (o Sincronizar começa por aqui)
  const nov = await http('GET', '/v1/sync/novidades', token.vendedor);
  confere('M-D13', nov.status === 200, 'GET /v1/sync/novidades do vendedor', `${nov.status} ${JSON.stringify(nov.corpo)}`);

  // M-D15: Boto Rosa só na carteira da Camila, com cadastro incompleto
  const cliCamila = await puxar(token.vendedor2, 'cliente');
  const boto = cliCamila.itens.find((c) => /boto rosa/i.test(String(c.nome_fantasia ?? c.razao_social ?? '')));
  confere('M-D15', !!boto && boto.cadastro_incompleto === true, 'vendedor2@: Atacado Boto Rosa com "Cadastro incompleto"', boto ? JSON.stringify({ incompleto: boto.cadastro_incompleto, faltam: boto.cadastro_campos_faltantes }) : `ausente (${cliCamila.status}, ${cliCamila.itens.length} clientes)`);
  const cliLucas = await puxar(token.vendedor, 'cliente');
  confere('M-D15', cliLucas.status === 200 && !cliLucas.itens.some((c) => /boto rosa/i.test(String(c.nome_fantasia ?? ''))), `vendedor@: ${cliLucas.itens.length} clientes, sem o Boto Rosa`);

  // M-D16: busca online
  const busca = await http('GET', `/v1/catalogo/busca?q=${encodeURIComponent('óleo para moto 150 cilindradas')}&limit=20`, token.vendedor);
  const skus = lista(busca.corpo).map((i) => i.erp_code);
  confere('M-D16', busca.status === 200 && skus[0] === 'OLE-4T-1L', 'busca "óleo para moto 150 cilindradas" → OLE-4T-1L em 1º', `${busca.status} ${JSON.stringify(skus.slice(0, 5))}`);
  const buscaP = await http('GET', `/v1/catalogo/busca?q=${encodeURIComponent('óleo para moto 150 cilindradas')}&limit=20`, token.promotor);
  const itensP = lista(buscaP.corpo);
  const comPreco = itensP.filter((i) => i.price_cents != null || i.preco_cents != null || i.stock != null || i.estoque != null);
  confere('M-D16a', buscaP.status === 200 && comPreco.length === 0, `promotor: vitrine sem preço e sem estoque (${itensP.length} itens)`, `${buscaP.status} ${JSON.stringify(comPreco[0] ?? buscaP.corpo).slice(0, 200)}`);

  // M-D17a / M-D20: Gestão da Renata
  const eq = await http('GET', '/v1/gestor/equipe', token.supervisor);
  const nomes = (eq.corpo?.membros ?? []).map((m) => m.membro?.nome);
  const ids = (eq.corpo?.membros ?? []).map((m) => m.membro?.id);
  confere('M-D20', eq.status === 200 && ids.includes(usuario.vendedor?.id) && ids.includes(usuario.vendedor2?.id), `Renata › Equipe: ${nomes.join(', ')}`, `${eq.status} ${JSON.stringify(eq.corpo).slice(0, 200)}`);
  const eqG = await http('GET', '/v1/gestor/equipe', token.gerente);
  confere('M-D20', eqG.status === 200, `Marcelo › Equipe (${(eqG.corpo?.membros ?? []).length} membros)`, `${eqG.status}`);
  const ap = await http('GET', '/v1/gestor/aprovacoes', token.supervisor);
  const fila = ap.corpo?.itens ?? [];
  confere('M-D17a', ap.status === 200 && fila.length > 0, `Renata › Aprovações: ${fila.length} na fila (${fila.map((i) => i.numero ?? i.pedido?.numero ?? '?').join(', ')})`, `${ap.status} ${JSON.stringify(ap.corpo).slice(0, 200)}`);
  const al = await http('GET', '/v1/gestor/alertas', token.supervisor);
  confere('M-D20a', al.status === 200, `Renata › Alertas abre (${lista(al.corpo).length})`, `${al.status} ${JSON.stringify(al.corpo).slice(0, 200)}`);
  for (const k of ['vendedor', 'promotor']) {
    const r = await http('GET', '/v1/gestor/equipe', token[k]);
    confere('M-D20', r.status === 403, `${k} sem acesso à Equipe (403)`, `${r.status}`);
  }

  // M-D19: 000010 no BKO
  const ped = await http('GET', '/v1/vendedor/pedidos?q=000010&limite=50', token.analista);
  const p10 = lista(ped.corpo).find((o) => o.number === '000010');
  if (!p10) confere('M-D19', false, 'BKO › Pedidos: 000010 na busca', `${ped.status} ${JSON.stringify(lista(ped.corpo).map((o) => o.number))}`);
  else {
    const d = await http('GET', `/v1/vendedor/pedidos/${p10.id}`, token.analista);
    const doc = d.corpo?.cliente?.documento ?? '';
    confere('M-D19', d.status === 200 && (d.corpo.items ?? []).length > 0 && (d.corpo.history ?? []).length > 0 && /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/.test(doc), `000010: ${(d.corpo.items ?? []).length} itens, ${(d.corpo.history ?? []).length} no histórico, CNPJ ${doc}`, `${d.status} ${JSON.stringify(d.corpo).slice(0, 200)}`);
  }

  // M-D21: Loja do promotor (cadastros de trade descem?)
  for (const e of ENT_PROMOTOR_CADASTRO.slice(0, 4)) {
    const r = await puxar(token.promotor, e);
    confere('M-D21', r.status === 200 && r.itens.length > 0, `promotor puxa ${e}: ${r.itens.length}`, `${r.status} ${r.codigo}`);
  }
  const rel = await http('GET', '/v1/promotor/relatorios/share', token.supervisor);
  confere('M-D21d', rel.status === 200, 'BKO › Trade marketing › Share (supervisora)', `${rel.status} ${JSON.stringify(rel.corpo).slice(0, 160)}`);

  // M-D21e / S7: pedido do promotor recusado, sem gravar
  const cli = (await puxar(token.promotor, 'cliente')).itens[0];
  const id = randomUUID();
  const push = await http('POST', '/v1/sync/push', token.promotor, { itens: [{ id, entidade: 'pedido', operacao: 'upsert', payload: { id, customer_id: cli?.id ?? randomUUID(), items: [], discount_pct: 0 } }] });
  const res = push.corpo?.resultados?.[0];
  confere('M-D21e', push.status === 200 && res?.status === 'rejeitado' && ['MODULO_INATIVO', 'RN-PRO-01'].includes(res?.codigo), `push de pedido do promotor recusado (${res?.codigo})`, `${push.status} ${JSON.stringify(push.corpo).slice(0, 200)}`);
  const ped2 = await http('POST', '/v1/vendedor/pedidos', token.promotor, { id, customer_id: cli?.id, items: [], discount_pct: 0 });
  confere('M-D21e', ped2.status === 403, 'POST /v1/vendedor/pedidos do promotor → 403', `${ped2.status}`);

  // Pesquisa
  const pq = await puxar(token.vendedor, 'questionario_versao');
  confere('PES', pq.status === 200 && pq.itens.length > 0, `vendedor puxa questionario_versao: ${pq.itens.length} questionários`, `${pq.status} ${pq.codigo}`);
  const pqB = await http('GET', '/v1/pesquisa/questionarios', token.analista);
  confere('PES', pqB.status === 200 && lista(pqB.corpo).length > 0, `BKO › Pesquisa: ${lista(pqB.corpo).length} questionários`, `${pqB.status} ${JSON.stringify(pqB.corpo).slice(0, 160)}`);
  void ENT_PESQUISA;

  // Treinamento (só se licenciado)
  if (comTreino.length) {
    for (const e of ENT_TREINAMENTO.slice(0, 2)) {
      const r = await puxar(token.vendedor, e);
      confere('TRE', r.status === 200 && (e !== 'trilha' || r.itens.length > 0), `vendedor puxa ${e}: ${r.itens.length}`, `${r.status} ${r.codigo}`);
    }
    const j = await http('GET', '/v1/treinamento/jornada', token.vendedor);
    confere('TRE', j.status === 200, 'Campo › Treinar (GET /v1/treinamento/jornada)', `${j.status} ${JSON.stringify(j.corpo).slice(0, 160)}`);
  }
}

main()
  .catch((e) => {
    linha('FALHA', 'erro', String(e?.stack ?? e));
  })
  .finally(() => {
    console.log(`\n${falhas ? `${falhas} FALHA(S)` : 'tudo OK'} — ${API} — ${new Date().toISOString()}`);
    process.exitCode = falhas ? 1 : 0;
  });
