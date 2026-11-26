/**
 * R-20261124-114951 / R-20261124-115055 (agente testes) — critérios do lote do Vendedor, sem banco:
 *   C1 RN-VEN-13: "Cadastro do cliente incompleto" lista os campos; alerta, recusa da API e conversão usam a mesma frase;
 *   C2 RN-VEN-38/13/11/11a/20: `botoesDoSalvarNovo` (só Salvar e Cancelar; Orçamento ou Pedido) na matriz inteira; o item
 *      só-orçamento não esconde o Pedido e barra o Enviar (`motivoDeNaoEnviarOSalvo`); RN-VEN-35: o Gestão só grava, igual ao Campo (o salvo em nome entra em Pedidos com Ações);
 *   RN-VEN-10: o Enviar do salvo acima da alçada pergunta "Enviar para aprovação?" antes de enfileirar;
 *   C3 RN-VEN-30: depois de salvar, sempre Pedidos (o aviso "Pedido salvo" é lido lá);
 *   C4 RN-VEN-48: botão "Ações" da aba Pedidos (`acoesDoPedidoNaLista` e `acoesDaLinha`), perfil e Gestão;
 *   C6 RN-VEN-42/48 e R-20261123-201347: pedido salvo na aba Pedidos, fora de Rascunhos, sem sumir nem duplicar no Enviar;
 *   C8 RN-VEN-39/48 (decisão B): vários salvos do mesmo cliente na lista; Duplicar não sobrescreve o rascunho em digitação; migração sem perda.
 * A API (C5, C7) está em tests/integracao/api/reenvio-enviado-erp-r20261124-acoes.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { acoesDoPedidoNaLista, CODIGO_ACAO_DA_LISTA, motivoDaAcaoNegada, verificarAcaoDaLista } from '../../modules/vendedor/domain/acoes-da-lista';
import { orderActions, type OrderStatus } from '../../modules/vendedor/domain/order';
import { alertasDoPedido } from '../../modules/vendedor/domain/alertas-pedido';
import { botoesDoSalvarNovo, motivoDeNaoEnviarOSalvo, PERGUNTA_DA_ALCADA, precisaPerguntarAlcadaNoEnvioSalvo, ROTULOS_DO_SALVAR_NOVO } from '../../modules/vendedor/domain/botoes-resumo';
import { aprovacoesFinanceiras } from '../../modules/vendedor/domain/credito-pedido';
import { nivelComAprovacoes, niveisDosParametros } from '../../modules/vendedor/domain/aprovacao';
import type { NivelDePreco } from '../../modules/vendedor/domain/preco-pedido';
import { textoCadastroIncompleto, verificarTipoParaCliente, type SituacaoCliente } from '../../modules/vendedor/domain/orcamento';
import { chaveDaCopiaDoPedido, chaveParaSalvar, copiaDoPedidoSalvo, idDoPedidoNoEnvio, limparRascunhosExpirados, migrarSalvosParaChavePropria, rascunhoIdNaRota } from '../../modules/vendedor/domain/rascunhos';
import { migrarSalvosGuardados, type RepositorioDeRascunhos } from '../../modules/vendedor/app/lib/migrar-salvos';
import { acoesDaLinha } from '../../modules/vendedor/app/lib/acoes-da-lista';
import { estadoDasAcoes } from '../../modules/vendedor/app/lib/acoes-pedido';
import { AVISO_NA_FILA_SEM_SINAL, AVISO_PEDIDO_ENVIADO, AVISO_SALVO_ENVIANDO, estadoNaFila } from '../../modules/vendedor/app/lib/salvar-na-fila';
import { textoDaMudanca } from '../../modules/vendedor/app/lib/documento';
import { draftKeyFor, montarPedido, rascunhoVazio, type PedidoDaLista, type Rascunho } from '../../modules/vendedor/app/lib/pedidos';
import type { LinhaDeRascunho } from '../../modules/vendedor/app/lib/rascunhos-lista';
import { rascunhosDaTela, rascunhosSalvosComoPedidos } from '../../modules/vendedor/app/lib/rascunhos-salvos';

const ler = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const LIBERADO: SituacaoCliente = { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] };
const PODE = { criar: true, editar: true, cancelar: true };
const NADA = { criar: false, editar: false, cancelar: false };

describe('C1 RN-VEN-13: cadastro incompleto com os campos, a mesma frase no alerta, na API e na conversão', () => {
  const campos = ['CNPJ', 'CEP'];
  const frase = 'Cadastro do cliente incompleto: falta CNPJ, CEP.';
  it('RN-VEN-13: a frase lista os campos; sem campos, sem o "falta"', () => {
    expect(textoCadastroIncompleto(campos)).toBe(frase);
    expect(textoCadastroIncompleto([])).toBe('Cadastro do cliente incompleto.');
  });
  it('RN-VEN-42: o alerta do pedido é a frase', () => {
    const a = alertasDoPedido({ cliente: { ...LIBERADO, cadastro_incompleto: true, campos_faltantes: campos } });
    expect(a.map((x) => x.texto)).toEqual([frase]);
    expect(a[0]).toMatchObject({ tipo: 'cliente', so_orcamento: true });
  });
  it('RN-VEN-13: a recusa 422 da API começa pela mesma frase', () => {
    const r = verificarTipoParaCliente('pedido', { ...LIBERADO, cadastro_incompleto: true, campos_faltantes: campos });
    expect(r).toMatchObject({ codigo: 'RN-VEN-13', http: 422 });
    expect(r!.mensagem.startsWith(frase.replace(/\.$/, ''))).toBe(true);
    expect(r!.mensagem).toContain('CNPJ, CEP');
  });
  it('RN-VEN-13: a mudança da conversão é a frase', () => {
    expect(textoDaMudanca({ tipo: 'cliente', motivo: 'cadastro_incompleto', campos }, () => '')).toBe(frase);
  });
});

describe('C2 RN-VEN-38: Salvar do Novo pedido (Orçamento ou Pedido), matriz inteira', () => {
  const clientes: Array<[string, SituacaoCliente, boolean]> = [
    ['liberado', LIBERADO, false],
    ['bloqueado', { ...LIBERADO, bloqueado: true }, true],
    ['inativo', { ...LIBERADO, ativo: false }, true],
    ['incompleto', { ...LIBERADO, cadastro_incompleto: true, campos_faltantes: ['CNPJ'] }, true],
  ];
  const itens: Array<[string, Record<string, unknown>, string | null]> = [
    ['sem bloqueio', {}, null],
    ['acima do máximo (RN-VEN-11)', { itens_acima_do_maximo: ['AGU-1500'] }, 'AGU-1500'],
    ['acima do limite (RN-VEN-11a)', { acima_do_limite: true }, 'acima do desconto máximo'],
    ['sem estoque (RN-VEN-20)', { itens_sem_estoque: ['BIS-400'] }, 'BIS-400 sem estoque'],
  ];
  for (const preVenda of [true, false])
    for (const [nc, cliente, soOrcCliente] of clientes)
      for (const [ni, extra] of itens)
        it(`pré-venda ${preVenda ? 'ligada' : 'desligada'} · cliente ${nc} · ${ni}`, () => {
          const b = botoesDoSalvarNovo({ cliente, pre_venda_ligada: preVenda, ...extra });
          // só Salvar e Cancelar na tela (o rótulo do Cancelar é fixo, ROTULOS_DO_SALVAR_NOVO); Salvar > Pedido só grava, no Campo e no Gestão (RN-VEN-48)
          expect(Object.keys(b).sort()).toEqual(['direto', 'escolha', 'salvar']);
          expect(b.salvar).toMatchObject({ rotulo: 'Salvar' }); // T-0198: habilitado e motivo dependem dos itens
          expect(ROTULOS_DO_SALVAR_NOVO.cancelar).toBe('Cancelar');
          // Pedido: aparece (tocável) sempre; some só com cliente só-orçamento (RN-VEN-13). Item só-orçamento não o esconde.
          expect(b.escolha.pedido.visivel).toBe(!soOrcCliente);
          // Orçamento: pela pré-venda, e sempre para o cliente só-orçamento (a tela nunca fica sem salvar)
          expect(b.escolha.orcamento.visivel).toBe(preVenda || soOrcCliente);
          // opção da folha: aparece ou não aparece; nunca desligada
          for (const k of ['orcamento', 'pedido'] as const) expect(Object.keys(b.escolha[k]).sort()).toEqual(['rotulo', 'visivel']);
          // uma opção só grava direto; duas abrem a folha
          const tocaveis = (['orcamento', 'pedido'] as const).filter((k) => b.escolha[k].visivel);
          expect(tocaveis.length).toBeGreaterThan(0);
          expect(b.direto).toBe(tocaveis.length === 2 ? null : tocaveis[0]);
          // cliente liberado: com ou sem item só-orçamento, duas opções (pré-venda) ou 'pedido' direto (sem pré-venda)
          if (!soOrcCliente) expect(b.direto).toBe(preVenda ? null : 'pedido');
        });

  describe('RN-VEN-48: o item só-orçamento barra o ENVIAR do pedido salvo (motivoDeNaoEnviarOSalvo, usado por enviarPedidoSalvo)', () => {
    // valor × regra: "salve como orçamento" só com pré-venda (o tenant tem orçamento); sem pré-venda, a ação possível no item (ajustar ou retirar)
    const fimSem: Record<string, RegExp> = { 'AGU-1500': /Ajuste o item para enviar\.$/, 'acima do desconto máximo': /Ajuste o item para enviar\.$/, 'BIS-400 sem estoque': /Retire o item para enviar\.$/ };
    it('RN-VEN-11/11a/20: cada item bloqueia o envio com o motivo; sem bloqueio entra na fila (null), com e sem pré-venda', () => {
      for (const pre_venda_ligada of [true, false])
        for (const [ni, extra, trecho] of itens) {
          const m = motivoDeNaoEnviarOSalvo({ cliente: LIBERADO, pre_venda_ligada, ...extra });
          const rot = `${ni} · pré-venda ${pre_venda_ligada}`;
          if (trecho === null) expect(m, rot).toBeNull();
          else {
            expect(m, rot).toContain(trecho);
            if (pre_venda_ligada) expect(m, rot).toMatch(/Edite o item ou salve como orçamento\.$/);
            else {
              expect(m, rot).not.toMatch(/orçamento/i);
              expect(m, rot).toMatch(fimSem[trecho]!);
            }
          }
        }
    });
    it('RN-VEN-13: cliente bloqueado, inativo ou incompleto também barra o envio, pela causa do cliente ("Só orçamento." só com pré-venda)', () => {
      for (const pre_venda_ligada of [true, false])
        for (const [nc, cliente, soOrc] of clientes) {
          const m = motivoDeNaoEnviarOSalvo({ cliente, pre_venda_ligada });
          if (!soOrc) expect(m, nc).toBeNull();
          else if (pre_venda_ligada) expect(m, nc).toMatch(/Só orçamento\.$/);
          else {
            expect(m, nc).not.toBeNull();
            expect(m, nc).not.toMatch(/orçamento/i);
          }
        }
      for (const pre_venda_ligada of [true, false])
        expect(motivoDeNaoEnviarOSalvo({ cliente: { ...LIBERADO, cadastro_incompleto: true, campos_faltantes: ['CNPJ'] }, pre_venda_ligada })).toContain('CNPJ');
    });
    it('RN-VEN-38 × RN-VEN-48: o que o Salvar deixa gravar como Pedido e o Enviar recusa é exatamente o item só-orçamento', () => {
      for (const pre_venda_ligada of [true, false])
        for (const [ni, extra, trecho] of itens) {
          const b = botoesDoSalvarNovo({ cliente: LIBERADO, pre_venda_ligada, ...extra });
          expect(b.escolha.pedido.visivel, ni).toBe(true);
          expect(motivoDeNaoEnviarOSalvo({ cliente: LIBERADO, pre_venda_ligada, ...extra }) !== null, ni).toBe(trecho !== null);
        }
    });
  });
});

describe('C3 RN-VEN-30: destino depois de salvar', () => {
  const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
  const corpo = (nome: string) => {
    const i = tela.indexOf(`const ${nome} = `);
    expect(i, nome).toBeGreaterThan(-1);
    return tela.slice(i, tela.indexOf('\n  };', i));
  };
  it('RN-VEN-30: sempre Pedidos, com ou sem check-in, com ou sem cliente (um destino só, sem contexto)', () => {
    expect(tela).toContain('const irParaPedidosAposSalvar = () => router.replace(hrefPedidos() as never);');
    expect(tela).not.toMatch(/destinoAposSalvar|destino-apos-salvar/);
    // Salvar > Pedido (Campo e Gestão) e o Salvar > Orçamento terminam na lista de Pedidos
    expect(corpo('gravarPedidoSalvo')).toContain('else irParaPedidosAposSalvar();');
    expect(corpo('send')).toContain('irParaPedidosAposSalvar();');
  });
  it('RN-VEN-30 / RN-VEN-48: o aviso "Pedido salvo" fica pendente ao salvar e é lido (uma vez) na aba Pedidos', () => {
    expect(corpo('gravarPedidoSalvo')).toContain('deixarAvisoPendente(AVISO_PEDIDO_SALVO)');
    expect(ler('modules/vendedor/app/screens/orders-screen.tsx')).toContain('pegarAvisoPendente()');
  });
});

describe('RN-VEN-35 × RN-VEN-48: Gestão só grava, igual ao Campo', () => {
  const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
  const pedidos = ler('modules/vendedor/app/screens/orders-screen.tsx');
  const corpo = (fonte: string, nome: string) => {
    const i = fonte.indexOf(`const ${nome} = `);
    expect(i, nome).toBeGreaterThan(-1);
    return fonte.slice(i, fonte.indexOf('\n  };', i));
  };
  const vendedor = { id: 'v-gestor', name: 'Supervisor', branch_id: 'f1' };
  const rasc = (x: Partial<Rascunho> = {}): Rascunho =>
    ({ customer_id: 'c1', lines: { p1: 2 }, discount_pct: 0, payment_terms: '', visit_id: null, route_stop_id: null, updated_at: '2026-11-24T14:00:00Z', salvo_em: '2026-11-24T14:00:00Z', ...x }) as Rascunho;
  const lin = (chave: string, customer_id = 'c1', x: Partial<LinhaDeRascunho> = {}): LinhaDeRascunho =>
    ({ chave, customer_id, edicao_de: null, cliente: 'Mercado A', total_cents: 5000, fato: '', someEm: null, foraDaCarteira: false, ...x }) as LinhaDeRascunho;
  const U1 = '11111111-1111-4111-8111-111111111111';
  const U2 = '22222222-2222-4222-8222-222222222222';

  it('RN-VEN-35: o domain não distingue o app no Salvar (sem envia_ao_salvar nem AppDoSalvar)', () => {
    const dominio = ler('modules/vendedor/domain/botoes-resumo.ts');
    expect(dominio).not.toMatch(/envia_ao_salvar|AppDoSalvar/);
    expect(Object.keys(botoesDoSalvarNovo({ cliente: LIBERADO, pre_venda_ligada: false })).sort()).toEqual(['direto', 'escolha', 'salvar']);
  });

  it('RN-VEN-35: a tela não lê o app do shell; Salvar > Pedido e o Salvar da folha de saída só gravam (salvarPedido), nos dois apps', () => {
    expect(tela).not.toMatch(/appDoSalvar|salvarComoPedido|salvarEEnviarPedido|useVisaoShell\(\)\.app/);
    expect(tela).toContain('botoesDoSalvarNovo({ cliente: situacaoCliente, pre_venda_ligada: app.preVendaLigada'); // T-0198: mais a contagem de itens
    const exec = corpo(tela, 'executarSalvar');
    expect(exec).toContain('comTentativa(salvarComoOrcamento)()');
    expect(exec).toContain('else gravarPedidoSalvo();');
    expect(corpo(tela, 'salvarPedido')).toContain('depoisDeConfirmar(() => gravarPedidoSalvo(depois));');
    expect(corpo(tela, 'aoEscolherNaSaida')).toContain('salvarPedido(destinoDaSaida());');
    // o Pedido não passa pelo envio: o send só é chamado sem tipo (orçamento)
    expect(tela).not.toMatch(/sendRef\.current\('pedido'\)/);
    expect(corpo(tela, 'gravarPedidoSalvo')).not.toMatch(/sendRef|submitOrder|enviar/i);
  });

  it('RN-VEN-35/48: no Gestão, o pedido salvo em nome entra em Pedidos como draft, com o vendedor do rascunho como dono e as 4 Ações', () => {
    const rascunhos = {
      [U1]: rasc({ vendedor_em_nome_id: 'v-ana', vendedor_em_nome_nome: 'Ana' }),
      [U2]: rasc(), // salvo sem "em nome": não entra no Gestão
      c3: rasc({ customer_id: 'c3', salvo_em: null, vendedor_em_nome_id: 'v-ana' }), // em digitação: não entra
    };
    const linhas = [lin(U1), lin(U2), lin('c3', 'c3')];
    const salvos = rascunhosSalvosComoPedidos({ linhas, rascunhos, vendedor, emNome: true, idsNaLista: new Set() });
    expect(salvos.map((o) => [o.id, o.status, o.seller_id, o.seller_name])).toEqual([[U1, 'draft', 'v-ana', 'Ana']]);
    // a tela liga o Gestão ao filtro "em nome" e dá Ações só ao salvo do aparelho (draft); os demais da equipe sem Ações
    expect(pedidos).toContain('emNome: gestao,');
    expect(pedidos).toContain("const ehDoAparelho = (p: PedidoDaLista) => !gestao || p.status === 'draft';");
    const ehDoAparelhoNoGestao = (p: PedidoDaLista) => p.status === 'draft';
    const agora = new Date('2026-11-24T15:00:00Z');
    expect(acoesDaLinha(salvos[0]!, { agora, pode: PODE, comAcoes: ehDoAparelhoNoGestao(salvos[0]!) }).lista).toEqual(['enviar', 'editar', 'duplicar', 'excluir']);
    const equipe = [
      { id: 'o1', number: '100', status: 'received', tipo: 'pedido' },
      { id: 'o2', number: '101', status: 'pending_approval', tipo: 'pedido' },
      { id: 'o3', number: '102', status: 'received', tipo: 'orcamento' },
      { id: 'o4', number: '103', status: 'sent_to_erp', tipo: 'pedido' },
    ].map((x) => ({ items_count: 1, local: false, local_error: '', ...x }) as PedidoDaLista);
    for (const o of equipe) expect(acoesDaLinha(o, { agora, pode: PODE, comAcoes: ehDoAparelhoNoGestao(o) }).lista, o.id).toEqual([]);
    // no Campo, sem "em nome": o salvo do próprio vendedor entra (os dois salvos)
    expect(rascunhosSalvosComoPedidos({ linhas, rascunhos, vendedor: { id: 'v-eu', name: 'Eu', branch_id: 'f1' }, idsNaLista: new Set() }).map((o) => [o.id, o.seller_id])).toEqual([[U1, 'v-ana'], [U2, 'v-eu']]);
  });

  it('RN-VEN-42/48: Rascunhos aplica o mesmo filtro nos dois apps (rascunhosDaTela sem parâmetro de app): o salvo some, digitação fica', () => {
    expect(rascunhosDaTela.length).toBe(2);
    const rascunhos = { [U1]: rasc({ vendedor_em_nome_id: 'v-ana' }), [U2]: rasc(), c3: rasc({ customer_id: 'c3', salvo_em: null }), 'edit:o1': rasc({ edit_order_id: 'o1' }) };
    const linhas = [lin(U1), lin(U2), lin('c3', 'c3'), lin('edit:o1', 'c1', { edicao_de: 'o1' })];
    expect(rascunhosDaTela(linhas, rascunhos).map((l) => l.chave)).toEqual(['c3', 'edit:o1']);
    // as duas telas chamam com os mesmos dois argumentos, sem `gestao`
    expect(ler('modules/vendedor/app/screens/rascunhos-screen.tsx')).toContain('rascunhosDaTela(app.rascunhosDaLista(agora), app.dados.rascunhos)');
    expect(pedidos).toContain('rascunhosDaTela(linhasDosRascunhos, dados.rascunhos)');
    expect(pedidos + ler('modules/vendedor/app/screens/rascunhos-screen.tsx')).not.toMatch(/rascunhosDaTela\([^)]*gestao/);
  });

  it('RN-VEN-35/33: Enviar do salvo em nome — o id do pedido é a chave (UUID), o dono é o vendedor do rascunho e o autor não sai do aparelho (token)', () => {
    expect(idDoPedidoNoEnvio(U1, 'c1', 'novo')).toBe(U1);
    expect(idDoPedidoNoEnvio(`edit:${U2}`, 'c1', 'novo')).toBe(U2);
    expect(idDoPedidoNoEnvio(draftKeyFor('c1'), 'c1', 'novo')).toBe('novo');
    expect(idDoPedidoNoEnvio('edit:nao-uuid', 'c1', 'novo')).toBe('novo');
    const r = { ...rascunhoVazio('c1'), vendedor_em_nome_id: 'v-ana', vendedor_em_nome_nome: 'Ana' } as Rascunho;
    const p = montarPedido({ id: U1, cliente: { id: 'c1' } as never, rascunho: r, v: { totals: { total_cents: 0, lines: [] } } as never, semSinal: false, agora: '2026-11-24T15:00:00Z' });
    expect(p.id).toBe(U1);
    expect((p as Record<string, unknown>).vendedor_id).toBe('v-ana');
    expect(Object.keys(p)).not.toContain('autor_id');
    // sem "em nome", o payload não leva vendedor_id (a API usa o token)
    expect(Object.keys(montarPedido({ id: U2, cliente: { id: 'c1' } as never, rascunho: rascunhoVazio('c1'), v: { totals: { total_cents: 0, lines: [] } } as never, semSinal: false, agora: '2026-11-24T15:00:00Z' }))).not.toContain('vendedor_id');
    expect(ler('modules/vendedor/app/state/use-vendedor.ts')).toContain('const id = idDoPedidoNoEnvio(chave, cliente.id, ambiente.novoId());');
  });
});

describe('RN-VEN-10 × RN-VEN-48: alçada no Enviar do pedido salvo (aba Pedidos)', () => {
  const estado = ler('modules/vendedor/app/state/use-vendedor.ts');
  const pedidos = ler('modules/vendedor/app/screens/orders-screen.tsx');
  const envio = estado.slice(estado.indexOf('const enviarPedidoSalvo = '), estado.indexOf('const converterOrcamento = '));
  /** o nível que o enviarPedidoSalvo calcula: o da alçada (desconto) somado às aprovações financeiras (crédito, título vencido) */
  const nivelDoEnvio = (nivelDesconto: NivelDePreco | null, fin: Parameters<typeof aprovacoesFinanceiras>[0]['financeiro'], total_cents: number, params: Record<string, unknown> = {}) => {
    const aprov = fin ? aprovacoesFinanceiras({ prazo_medio_dias: 30, total_cents, financeiro: fin, niveis: niveisDosParametros(params) }) : [];
    return aprov.length > 0 ? nivelComAprovacoes(nivelDesconto, aprov) : nivelDesconto;
  };
  const FIN_OK = { limite_informado: true, disponivel_cents: 100_000, maior_atraso_dias: 0, limite_dias: 5 };

  it('RN-VEN-10: dentro da alçada envia direto; acima (qualquer nível) pergunta', () => {
    expect(precisaPerguntarAlcadaNoEnvioSalvo({ nivel: null })).toBe(false);
    for (const nivel of ['supervisor', 'gerente', 'analista'] as const) expect(precisaPerguntarAlcadaNoEnvioSalvo({ nivel }), nivel).toBe(true);
    expect(PERGUNTA_DA_ALCADA).toEqual({ titulo: 'Enviar para aprovação?', enviar: 'Enviar', voltar: 'Voltar' });
  });

  it('RN-VEN-12 (limite): total igual ao crédito disponível não pergunta; 1 centavo acima pergunta (nível do parâmetro, padrão gerente)', () => {
    expect(nivelDoEnvio(null, FIN_OK, 100_000)).toBeNull();
    expect(precisaPerguntarAlcadaNoEnvioSalvo({ nivel: nivelDoEnvio(null, FIN_OK, 100_000) })).toBe(false);
    expect(nivelDoEnvio(null, FIN_OK, 100_001)).toBe('gerente');
    expect(precisaPerguntarAlcadaNoEnvioSalvo({ nivel: nivelDoEnvio(null, FIN_OK, 100_001) })).toBe(true);
    expect(nivelDoEnvio(null, FIN_OK, 100_001, { 'aprovacao.credito_nivel': 'supervisor' })).toBe('supervisor');
    // sem limite informado pelo ERP, também pergunta
    expect(precisaPerguntarAlcadaNoEnvioSalvo({ nivel: nivelDoEnvio(null, { ...FIN_OK, limite_informado: false }, 100) })).toBe(true);
    // financeiro indisponível não bloqueia (RN-VEN-13): nível só do desconto
    expect(nivelDoEnvio(null, undefined, 999_999)).toBeNull();
  });

  it('RN-VEN-13 (limite): título vencido há 5 dias (limite 5) não pergunta; 6 dias pergunta; o maior nível vence o do desconto', () => {
    expect(nivelDoEnvio(null, { ...FIN_OK, maior_atraso_dias: 5 }, 100)).toBeNull();
    expect(nivelDoEnvio(null, { ...FIN_OK, maior_atraso_dias: 6 }, 100)).toBe('gerente');
    expect(precisaPerguntarAlcadaNoEnvioSalvo({ nivel: nivelDoEnvio(null, { ...FIN_OK, maior_atraso_dias: 6 }, 100) })).toBe(true);
    expect(nivelDoEnvio('supervisor', { ...FIN_OK, maior_atraso_dias: 6 }, 100)).toBe('gerente');
    expect(nivelDoEnvio('analista', { ...FIN_OK, maior_atraso_dias: 6 }, 100)).toBe('analista');
  });

  it('RN-VEN-10 (estado): o enviarPedidoSalvo usa o mesmo nível (desconto + financeiro) e devolve "pergunta_alcada" ANTES de enfileirar', () => {
    expect(envio).toContain('async (chave: string, confirmouAlcada = false): Promise<ResultadoEnvioSalvo> =>');
    expect(envio).toContain('precisaPerguntarAlcadaNoEnvioSalvo({ nivel: aprov.length > 0 ? nivelComAprovacoes(v.calculo.nivel, aprov) : v.calculo.nivel })');
    // depois do "Enviar" da pergunta (confirmouAlcada), não pergunta de novo: vai direto ao enviarPedido
    expect(envio).toContain('if (!confirmouAlcada && v) {');
    const pergunta = envio.indexOf("return { kind: 'pergunta_alcada' }");
    const enfileira = envio.indexOf('return await enviarPedido(r, cliente, catalogo, chave, true, preparado);');
    expect(pergunta).toBeGreaterThan(-1);
    expect(enfileira).toBeGreaterThan(pergunta);
    expect(envio.slice(envio.indexOf('if (!confirmouAlcada && v)'), pergunta)).not.toMatch(/enfileirar|enviarPedido\(/);
    // o motivo de não enviar (RN-VEN-11/11a/13/20) é conferido antes da alçada: bloqueado não chega a perguntar
    expect(envio.indexOf('if (motivo) throw new Error(motivo);')).toBeLessThan(pergunta);
    // a fila é só a do enviarPedido (motor.enfileirar não aparece no corpo do envio do salvo)
    expect(envio).not.toContain('motor.enfileirar');
  });

  it('RN-VEN-10 (tela): "pergunta_alcada" abre o Dialogo; "Enviar" reenvia com confirmação; "Voltar" só fecha, sem enviar', () => {
    expect(pedidos).toContain('const r = await app.enviarPedidoSalvo(o.id, confirmouAlcada);');
    expect(pedidos).toContain("if (r.kind === 'pergunta_alcada') setPerguntaAlcadaDe(o);");
    const d = pedidos.slice(pedidos.indexOf('<Dialogo\n        visivel={perguntaAlcadaDe !== null}'), pedidos.indexOf('testID="pergunta-alcada"'));
    expect(d.length).toBeGreaterThan(0);
    expect(d).toContain('titulo={PERGUNTA_DA_ALCADA.titulo}');
    expect(d).toContain("cancelar={{ rotulo: PERGUNTA_DA_ALCADA.voltar, onPress: () => setPerguntaAlcadaDe(null), testID: 'alcada-voltar' }}");
    const confirmar = d.slice(d.indexOf('confirmar={{'));
    expect(confirmar).toContain('rotulo: PERGUNTA_DA_ALCADA.enviar');
    expect(confirmar).toContain("if (o) void executarAcao('enviar', o, true);");
    // o Voltar não chama o envio
    const voltar = d.slice(d.indexOf('cancelar={{'), d.indexOf('confirmar={{'));
    expect(voltar).not.toMatch(/executarAcao|enviarPedidoSalvo/);
    // a pergunta não mostra aviso de envio (só o resultado do envio mostra)
    expect(pedidos).toMatch(/else if \(r\.kind !== 'em_envio'\) avisos\.mostrar/);
  });

  // D-S9-1 (valor × rótulo), corrigido: o Enviar do salvo espera o servidor (aguardarEnvio = true) e, com sinal e envio aceito, devolve
  // `sent` (aviso AVISO_PEDIDO_ENVIADO, RD-3400); sem sinal, recusa ou falha, `queued` (AVISO_NA_FILA_SEM_SINAL).
  it('D-S9-1: com sinal, o Enviar do pedido salvo devolve "sent" e diz "Pedido enviado"; sem sinal, "queued" e a fila', () => {
    const envia = estado.slice(estado.indexOf('const enviarPedido = '), estado.indexOf('const unidadesTransportadoras = '));
    expect(envia.match(/return \{ kind: '[a-z_]+'/g)).toEqual(["return { kind: 'sent'", "return { kind: 'queued'"]);
    // `sent` só com sinal, com o envio aguardado e aceito pelo servidor
    expect(envia).toContain('if (aguardarEnvio && ambiente.online() && (await seguirEnvioEmSegundoPlano(id))) {');
    expect(envia.indexOf('aguardarEnvio && ambiente.online()')).toBeLessThan(envia.indexOf("return { kind: 'sent'"));
    // o Enviar do salvo aguarda; o envio do novo pedido continua em segundo plano
    const salvo = estado.slice(estado.indexOf('const enviarPedidoSalvo = '));
    expect(salvo).toContain('return await enviarPedido(r, cliente, catalogo, chave, true, preparado);');
    expect(envia).toContain('if (!aguardarEnvio && ambiente.online()) void seguirEnvioEmSegundoPlano(id);');
    // a tela mostra o aviso conforme o resultado
    expect(pedidos).toContain("avisos.mostrar(r.kind === 'sent' ? AVISO_PEDIDO_ENVIADO : AVISO_NA_FILA_SEM_SINAL)");
  });
  it('D-S9-1 (rótulo × valor): faixa do detalhe na_fila diz "salvo" (sem sinal) ou "enviando" (com sinal); a lista diz "enviado" só no aceito', () => {
    expect(estadoNaFila({ recusado: false, offline: true }).faixa.texto).toBe('Pedido salvo · vai quando houver sinal');
    expect(estadoNaFila({ recusado: false, offline: false }).faixa.texto).toBe(AVISO_SALVO_ENVIANDO);
    expect(AVISO_PEDIDO_ENVIADO).toBe('Pedido enviado');
    expect(AVISO_NA_FILA_SEM_SINAL).toBe('Pedido na fila · vai quando houver sinal');
    // com sinal a faixa nunca promete "quando houver sinal"
    expect(estadoNaFila({ recusado: false, offline: false }).faixa.texto).not.toMatch(/quando houver sinal/);
  });
});

describe('C4 RN-VEN-48: botão Ações da aba Pedidos', () => {
  const lista = (e: Parameters<typeof acoesDoPedidoNaLista>[0]) => acoesDoPedidoNaLista(e).lista;
  // RN-VEN-31: recebido pelo servidor e ainda não enviado ao ERP não se edita (Duplique); lista e detalhe usam a mesma regra
  const RECEBIDOS = ['received', 'pending_approval', 'approved', 'rejected'];
  it('RN-VEN-31: recebido pelo servidor (não enviado ao ERP) não oferece Editar; a recusa diz a causa certa', () => {
    for (const st of RECEBIDOS) {
      expect(lista({ tipo: 'pedido', status: st, pode: PODE }), st).not.toContain('editar');
      const r = verificarAcaoDaLista('editar', { tipo: 'pedido', status: st });
      expect(r, st).toMatchObject({ codigo: CODIGO_ACAO_DA_LISTA, http: 422 });
      expect(r!.mensagem, st).toBe('Pedido já recebido pelo servidor: não pode ser editado. Duplique para fazer um novo.');
    }
    // as outras causas, cada uma com a sua frase
    expect(motivoDaAcaoNegada('editar', { tipo: 'pedido', status: 'sent_to_erp' })).toBe('Pedido já enviado ao ERP: não pode ser editado. Duplique para fazer um novo.');
    expect(motivoDaAcaoNegada('editar', { tipo: 'pedido', status: 'queued', na_fila: true })).toBe('Pedido na fila: aguarde o envio.');
    expect(motivoDaAcaoNegada('editar', { tipo: 'orcamento', status: 'received', orcamento_aberto: false })).toBe('Orçamento fechado: não pode ser editado.');
    expect(motivoDaAcaoNegada('editar', { tipo: 'pedido', status: 'draft', tem_itens: false })).toBe('Itens ainda não sincronizados. Sincronize para ver.');
  });
  it('RN-VEN-31/48: Editar da lista (acoesDoPedidoNaLista) = Editar do detalhe (estadoDasAcoes), com o mesmo motivo', () => {
    const casos: Array<{ status: string; naFila: boolean; recusado?: boolean }> = [
      ...RECEBIDOS.map((status) => ({ status, naFila: false })),
      ...['sent_to_erp', 'integrated', 'invoiced'].map((status) => ({ status, naFila: false })),
      { status: 'queued', naFila: true },
      { status: 'queued', naFila: true, recusado: true },
    ];
    for (const c of casos) {
      const naLista = lista({ tipo: 'pedido', status: c.status, na_fila: c.naFila, recusado: c.recusado, pode: PODE }).includes('editar');
      const det = estadoDasAcoes({ status: c.status, naFila: c.naFila, offline: false, v1: true, ehVendedor: true, temItens: true, recusado: c.recusado, pode: { editar: true, cancelar: true }, acoes: orderActions(c.status as OrderStatus) });
      expect(det.podeEditar, JSON.stringify(c)).toBe(naLista);
    }
    // o motivo do detalhe, para o recebido pelo servidor, é o mesmo da recusa da lista/API
    for (const st of ['received', 'pending_approval']) {
      const det = estadoDasAcoes({ status: st, naFila: false, offline: false, v1: true, ehVendedor: true, temItens: true, pode: { editar: true, cancelar: true }, acoes: orderActions(st as OrderStatus) });
      expect(det.motivoBloqueio, st).toBe(verificarAcaoDaLista('editar', { tipo: 'pedido', status: st })!.mensagem);
    }
  });

  const linha = (x: Partial<PedidoDaLista>): PedidoDaLista => ({ id: 'o1', number: '100', status: 'received', tipo: 'pedido', items_count: 2, local: false, local_error: '', ...x }) as PedidoDaLista;
  const agora = new Date('2026-11-24T15:00:00Z');
  it('RN-VEN-48: no Gestão (comAcoes falso) e para o promotor, a linha não tem Ações', () => {
    for (const o of [linha({ status: 'draft' }), linha({ tipo: 'orcamento', status: 'received' }), linha({ status: 'sent_to_erp' })]) {
      expect(acoesDaLinha(o, { agora, pode: PODE, comAcoes: false }).lista).toEqual([]);
      expect(acoesDaLinha(o, { agora, pode: NADA, comAcoes: true }).lista).toEqual([]);
    }
  });
  it('RN-VEN-48: no Campo, a linha monta a entrada certa (orçamento aberto converte; na fila não envia nem exclui; recusado exclui)', () => {
    expect(acoesDaLinha(linha({ tipo: 'orcamento', status: 'received' }), { agora, pode: PODE, comAcoes: true }).lista).toContain('converter');
    expect(acoesDaLinha(linha({ status: 'queued', local: true }), { agora, pode: PODE, comAcoes: true }).lista).toEqual(['duplicar']);
    expect(acoesDaLinha(linha({ status: 'queued', local: true, local_failed: true }), { agora, pode: PODE, comAcoes: true }).lista).toEqual(['editar', 'duplicar', 'excluir']);
    expect(acoesDaLinha(linha({ status: 'draft' }), { agora, pode: PODE, comAcoes: true }).lista).toEqual(['enviar', 'editar', 'duplicar', 'excluir']);
  });
});

describe('C6 RN-VEN-48 / R-20261123-201347: pedido salvo na aba Pedidos e no Enviar offline', () => {
  const vendedor = { id: 'v1', name: 'Vendedor', branch_id: 'f1' };
  const AGORA = new Date('2026-11-24T15:00:00Z');
  const rasc = (x: Partial<Rascunho> = {}): Rascunho =>
    ({ customer_id: 'c1', lines: { p1: 2 }, discount_pct: 0, payment_terms: '', visit_id: null, route_stop_id: null, updated_at: '2026-11-24T14:00:00Z', salvo_em: '2026-11-24T14:00:00Z', ...x }) as Rascunho;
  const lin = (chave: string, customer_id = chave, x: Partial<LinhaDeRascunho> = {}): LinhaDeRascunho =>
    ({ chave, customer_id, edicao_de: null, cliente: 'Mercado A', total_cents: 5000, fato: '', someEm: null, foraDaCarteira: false, ...x }) as LinhaDeRascunho;

  it('RN-VEN-48 (decisão B): o pedido salvo mora na chave própria (UUID do aparelho), que é o id da linha e o id do pedido no envio', () => {
    const chave = chaveParaSalvar(draftKeyFor('c1'), 'c1', '33333333-3333-4333-8333-333333333333');
    expect(chave).toBe('33333333-3333-4333-8333-333333333333');
    expect(draftKeyFor('c1', null, chave)).toBe(chave);
    const salvos = rascunhosSalvosComoPedidos({ linhas: [lin(chave, 'c1')], rascunhos: { [chave]: rasc() }, vendedor, idsNaLista: new Set() });
    expect(salvos.map((s) => [s.id, s.idempotency_key])).toEqual([[chave, chave]]);
    expect(chaveParaSalvar(chave, 'c1', 'outro-uuid')).toBe(chave);
    // o rascunho em digitação (chave = cliente) não é salvo: envia com id novo
    expect(chaveParaSalvar(draftKeyFor('c1'), 'c1', 'outro-uuid')).toBe('outro-uuid');
    // o envio (enviarPedido) usa a chave como id do pedido (idDoPedidoNoEnvio)
    expect(idDoPedidoNoEnvio(chave, 'c1', 'outro-uuid')).toBe(chave);
  });

  it('RN-VEN-48 (offline): Enviar troca a linha do salvo pela do item da fila (mesmo id), sem sumir nem duplicar', () => {
    const chave = '33333333-3333-4333-8333-333333333333';
    const antes = [...rascunhosSalvosComoPedidos({ linhas: [lin(chave, 'c1')], rascunhos: { [chave]: rasc() }, vendedor, idsNaLista: new Set() })];
    expect(antes.map((o) => [o.id, o.status])).toEqual([[chave, 'draft']]);
    // fila com o id da chave do salvo: mesmo antes de apagar o rascunho, a linha do salvo não duplica (idsNaLista)
    const fila = { id: chaveParaSalvar(chave, 'c1', 'nao-usado'), status: 'queued', local: true } as PedidoDaLista;
    const meio = [...rascunhosSalvosComoPedidos({ linhas: [lin(chave, 'c1')], rascunhos: { [chave]: rasc() }, vendedor, idsNaLista: new Set([fila.id]) }), fila];
    expect(meio.map((o) => [o.id, o.status])).toEqual([[chave, 'queued']]);
    const depois = [...rascunhosSalvosComoPedidos({ linhas: [], rascunhos: {}, vendedor, idsNaLista: new Set([fila.id]) }), fila];
    expect(depois.map((o) => [o.id, o.status])).toEqual([[chave, 'queued']]);
    expect(acoesDaLinha(depois[0]!, { agora: AGORA, pode: PODE, comAcoes: true }).lista).not.toContain('enviar');
  });

  it('RN-VEN-42/48: Rascunhos e "Rascunhos (n)" sem o pedido salvo; digitação, edição e orçamento salvo ficam', () => {
    const rascunhos = { u1: rasc(), c2: rasc({ customer_id: 'c2', salvo_em: null }), 'edit:o1': rasc({ edit_order_id: 'o1' }), c4: rasc({ customer_id: 'c4', tipo: 'orcamento' } as Partial<Rascunho>) };
    const linhas = [lin('u1', 'c1'), lin('c2'), lin('edit:o1', 'c1', { edicao_de: 'o1' }), lin('c4')];
    const ficam = rascunhosDaTela(linhas, rascunhos).map((l) => l.chave);
    expect(ficam).toEqual(['c2', 'edit:o1', 'c4']);
    expect(ficam).toHaveLength(3); // a contagem "Rascunhos (n)" usa a mesma função
    const naAbaPedidos = rascunhosSalvosComoPedidos({ linhas, rascunhos, vendedor, idsNaLista: new Set() }).map((o) => o.id);
    expect(naAbaPedidos).toEqual(['u1']);
    // cada rascunho num lugar só: na aba Pedidos ou em Rascunhos, nunca nos dois nem em nenhum
    expect([...ficam, ...naAbaPedidos].sort()).toEqual(linhas.map((l) => l.chave).sort());
  });

  // R-20261123-201347 (RN-VEN-39 "some 24 h depois ... a não ser que vire orçamento ou pedido"): corrigido pelo modulo-vendedor.
  it('R-20261123-201347: o pedido salvo (RN-VEN-48) não é apagado pela limpeza de 24 h dos rascunhos', () => {
    const salvo = rasc({ updated_at: '2026-11-23T14:00:00Z', salvo_em: '2026-11-23T14:00:00Z' });
    const { mantidos, removidos } = limparRascunhosExpirados({ u1: salvo }, AGORA);
    expect(removidos).toEqual([]);
    expect(mantidos.u1).toBeDefined();
  });
});

describe('C8 RN-VEN-39/48 (decisão B): vários pedidos salvos por cliente, Duplicar em chave nova, migração sem perda', () => {
  const vendedor = { id: 'v1', name: 'Vendedor', branch_id: 'f1' };
  const rasc = (x: Partial<Rascunho> = {}): Rascunho =>
    ({ customer_id: 'c1', lines: { p1: 2 }, discount_pct: 0, payment_terms: '', visit_id: null, route_stop_id: null, updated_at: '2026-11-24T14:00:00Z', salvo_em: '2026-11-24T14:00:00Z', ...x }) as Rascunho;
  const lin = (chave: string, customer_id: string, total_cents = 5000): LinhaDeRascunho =>
    ({ chave, customer_id, edicao_de: null, cliente: 'Mercado A', total_cents, fato: '', someEm: null, foraDaCarteira: false }) as LinhaDeRascunho;
  const ids = (() => {
    let n = 0;
    return () => `uuid-${++n}`;
  })();

  it('RN-VEN-48: dois Salvar > Pedido do mesmo cliente viram duas linhas na aba Pedidos, cada uma com o próprio id e o próprio total', () => {
    // 1º salvo: sai da chave do cliente para a própria; o cliente fica livre para o próximo Novo pedido
    const k1 = chaveParaSalvar(draftKeyFor('c1'), 'c1', 'uuid-a');
    const k2 = chaveParaSalvar(draftKeyFor('c1'), 'c1', 'uuid-b');
    expect([k1, k2]).toEqual(['uuid-a', 'uuid-b']);
    // salvar de novo um salvo (Editar) mantém a chave dele: não cria um terceiro
    expect(chaveParaSalvar(k1, 'c1', 'uuid-c')).toBe(k1);
    const rascunhos = { [k1]: rasc({ lines: { p1: 1 } }), [k2]: rasc({ lines: { p2: 3 } }), c1: rasc({ salvo_em: null, lines: { p3: 1 } }) };
    const linhas = [lin(k1, 'c1', 1000), lin(k2, 'c1', 3000), lin('c1', 'c1', 700)];
    const naLista = rascunhosSalvosComoPedidos({ linhas, rascunhos, vendedor, idsNaLista: new Set() });
    expect(naLista.map((o) => [o.id, o.customer_id, o.status, o.total_cents])).toEqual([
      [k1, 'c1', 'draft', 1000],
      [k2, 'c1', 'draft', 3000],
    ]);
    // o em digitação (chave = cliente) fica em Rascunhos, um só
    expect(rascunhosDaTela(linhas, rascunhos).map((l) => l.chave)).toEqual(['c1']);
    // cada salvo tem as quatro ações e envia com o próprio id (dois salvos = dois pedidos; o reenvio do mesmo não duplica)
    for (const o of naLista) expect(acoesDaLinha(o, { agora: new Date('2026-11-24T15:00:00Z'), pode: PODE, comAcoes: true }).lista, o.id).toEqual(['enviar', 'editar', 'duplicar', 'excluir']);
    const enviados = naLista.map((o) => chaveParaSalvar(o.id, 'c1', ids()));
    expect(new Set(enviados).size).toBe(2);
    expect(enviados).toEqual([k1, k2]);
    expect(chaveParaSalvar(k1, 'c1', ids())).toBe(enviados[0]);
    // e abre o editor pelo `rascunhoId` da própria chave; o em digitação abre sem
    expect(naLista.map((o) => rascunhoIdNaRota(o.id, 'c1'))).toEqual([k1, k2]);
    expect(rascunhoIdNaRota('c1', 'c1')).toBeUndefined();
    expect(rascunhoIdNaRota('edit:o1', 'c1')).toBeUndefined();
  });

  it('RN-VEN-39/48: Duplicar (do salvo e de pedido/orçamento existente) grava em chave nova, sem tocar o rascunho em digitação do cliente', () => {
    const digitando = rasc({ salvo_em: null, lines: { p9: 7 } });
    const salvo = { ...rasc({ lines: { p1: 2, p2: 1 } }), notice: 'preços atualizados' } as Rascunho;
    // Duplicar do salvo: cópia dos itens e condições, ainda não salva, no Resumo; o original fica igual
    const copia = copiaDoPedidoSalvo(salvo, '2026-11-24T16:00:00Z') as Rascunho & { aba?: string; notice?: string };
    expect(copia.lines).toEqual(salvo.lines);
    expect(copia.lines).not.toBe(salvo.lines);
    expect([copia.salvo_em, copia.updated_at, copia.aba, copia.notice]).toEqual([null, '2026-11-24T16:00:00Z', 'resumo', undefined]);
    expect(salvo.salvo_em).toBe('2026-11-24T14:00:00Z');
    // a chave da cópia nunca é a do cliente (onde mora o em digitação), nem a do original
    const chaveCopiaSalvo = ids();
    const chaveCopiaPedido = chaveDaCopiaDoPedido('duplicate', 'o-servidor', ids());
    expect(chaveDaCopiaDoPedido('edit', 'o-servidor', ids())).toBe('edit:o-servidor');
    for (const k of [chaveCopiaSalvo, chaveCopiaPedido]) {
      expect(k).not.toBe(draftKeyFor('c1'));
      expect(k).not.toBe('u-salvo');
      expect(rascunhoIdNaRota(k, 'c1')).toBe(k);
    }
    const depois: Record<string, Rascunho> = { c1: digitando, 'u-salvo': salvo, [chaveCopiaSalvo]: copia, [chaveCopiaPedido]: rasc({ salvo_em: null, lines: { p5: 1 } }) };
    expect(depois.c1).toBe(digitando);
    expect(depois.c1!.lines).toEqual({ p9: 7 });
    expect(Object.keys(depois)).toHaveLength(4);
  });

  it('RN-VEN-48 (tela): Duplicar da lista e do detalhe abrem a cópia por `rascunhoId: r.chave`; Editar do servidor por `editId`', () => {
    const lista = ler('modules/vendedor/app/screens/orders-screen.tsx');
    expect(lista).toMatch(/const r = await app\.duplicarPedidoSalvo\(o\.id\);\s*irParaNovoPedido\(\{ customerId: r\.customerId, rascunhoId: r\.chave \}\)/);
    expect(lista).toContain("irParaNovoPedido(acao === 'editar' ? { customerId: r.customerId, editId: o.id } : { customerId: r.customerId, rascunhoId: r.chave })");
    // Editar do salvo abre a própria chave
    expect(lista).toContain('irParaNovoPedido({ customerId: o.customer_id, rascunhoId: o.id })');
    const det = ler('modules/vendedor/app/screens/order-detail-screen.tsx');
    expect(det).toContain("irParaNovoPedido(mode === 'edit' ? { customerId: r.customerId, editId: id } : { customerId: r.customerId, rascunhoId: r.chave })");
    // o estado grava a cópia na chave de chaveDaCopiaDoPedido (UUID novo), nunca em draftKeyFor(cliente)
    const estado = ler('modules/vendedor/app/state/use-vendedor.ts');
    expect(estado).toContain('const chave = chaveDaCopiaDoPedido(modo, orderId, ambiente.novoId());');
    const dup = estado.slice(estado.indexOf('const duplicarPedidoSalvo = useCallback('), estado.indexOf('// ---------- pedido ----------'));
    expect(dup).toMatch(/const nova = ambiente\.novoId\(\);[\s\S]*repo\.guardarRascunho\(nova, copia\)/);
    expect(dup).not.toMatch(/draftKeyFor|limparRascunho/);
  });

  describe('RN-VEN-39/48: migração dos salvos antigos (chave = cliente) para a chave própria', () => {
    const antigos = (): Record<string, Rascunho> => ({
      c1: rasc({ lines: { p1: 2 } }), // salvo antigo, na chave do cliente
      c2: rasc({ customer_id: 'c2', salvo_em: null, lines: { p2: 1 } }), // em digitação: fica
      'edit:o1': rasc({ edit_order_id: 'o1', salvo_em: '2026-11-24T10:00:00Z' }), // edição: fica
      c3: rasc({ customer_id: 'c3', tipo: 'orcamento' } as Partial<Rascunho>), // orçamento salvo: fica
      'u-ja': rasc({ customer_id: 'c4' }), // salvo já na chave própria: fica
    });

    it('sem perda: o salvo antigo vai para chave nova com o mesmo conteúdo; o resto não muda; a lista mostra o mesmo pedido', () => {
      const r = antigos();
      const { rascunhos, movidos } = migrarSalvosParaChavePropria(r, () => 'u-novo');
      expect(movidos).toEqual([{ de: 'c1', para: 'u-novo' }]);
      expect(rascunhos['u-novo']).toEqual(r.c1);
      expect(rascunhos.c1).toBeUndefined();
      for (const k of ['c2', 'edit:o1', 'c3', 'u-ja']) expect(rascunhos[k], k).toEqual(r[k]);
      expect(Object.keys(rascunhos).sort()).toEqual(['c2', 'c3', 'edit:o1', 'u-ja', 'u-novo']);
      // nenhum item perdido: soma das quantidades igual antes e depois
      const soma = (x: Record<string, Rascunho>) => Object.values(x).reduce((s, y) => s + Object.values(y.lines).reduce((a, b) => a + b, 0), 0);
      expect(soma(rascunhos)).toBe(soma(r));
      // o cliente fica livre para o próximo Novo pedido
      expect(rascunhos[draftKeyFor('c1')]).toBeUndefined();
    });

    it('idempotente: rodar de novo não move nada; gravação interrompida (cópia já gravada) só apaga a antiga, sem duplicar', () => {
      const r1 = migrarSalvosParaChavePropria(antigos(), () => 'u-novo');
      const r2 = migrarSalvosParaChavePropria(r1.rascunhos, () => 'u-outro');
      expect(r2.movidos).toEqual([]);
      expect(r2.rascunhos).toEqual(r1.rascunhos);
      // parou entre gravar a cópia e apagar a antiga: as duas existem
      const meio = { ...antigos(), 'u-novo': antigos().c1! };
      const r3 = migrarSalvosParaChavePropria(meio, () => 'u-outro');
      expect(r3.movidos).toEqual([{ de: 'c1', para: 'u-novo' }]);
      expect(Object.keys(r3.rascunhos).sort()).toEqual(['c2', 'c3', 'edit:o1', 'u-ja', 'u-novo']);
    });

    function repoFalso(inicial: Record<string, Rascunho>, falharAoLimpar = false) {
      const dados = { ...inicial };
      const ops: string[] = [];
      let falhar = falharAoLimpar;
      const repo: RepositorioDeRascunhos = {
        carregar: async () => ({ rascunhos: { ...dados } }),
        guardarRascunho: async (k, r) => {
          ops.push(`guardar:${k}`);
          dados[k] = r;
        },
        limparRascunho: async (k) => {
          if (falhar) {
            falhar = false;
            throw new Error('queda no meio');
          }
          ops.push(`limpar:${k}`);
          delete dados[k];
        },
      };
      return { repo, dados, ops };
    }

    it('no aparelho (migrarSalvosGuardados): grava a nova ANTES de apagar a antiga; queda no meio e reabertura terminam sem perda nem cópia dupla', async () => {
      const ok = repoFalso(antigos());
      expect(await migrarSalvosGuardados(ok.repo, () => 'u-novo')).toEqual([{ de: 'c1', para: 'u-novo' }]);
      expect(ok.ops).toEqual(['guardar:u-novo', 'limpar:c1']);
      expect(ok.dados['u-novo']).toEqual(antigos().c1);
      expect(ok.dados.c1).toBeUndefined();
      expect(await migrarSalvosGuardados(ok.repo, () => 'u-x')).toEqual([]);

      const queda = repoFalso(antigos(), true);
      await expect(migrarSalvosGuardados(queda.repo, () => 'u-novo')).rejects.toThrow('queda no meio');
      expect(Object.keys(queda.dados).sort()).toEqual(['c1', 'c2', 'c3', 'edit:o1', 'u-ja', 'u-novo']); // nada perdido
      // reabertura: reconhece a cópia já gravada e só apaga a antiga
      expect(await migrarSalvosGuardados(queda.repo, () => 'u-outro')).toEqual([{ de: 'c1', para: 'u-novo' }]);
      expect(Object.keys(queda.dados).sort()).toEqual(['c2', 'c3', 'edit:o1', 'u-ja', 'u-novo']);
      expect(queda.ops.filter((o) => o.startsWith('guardar'))).toEqual(['guardar:u-novo']);
      expect(rascunhosSalvosComoPedidos({ linhas: Object.keys(queda.dados).map((k) => lin(k, queda.dados[k]!.customer_id)), rascunhos: queda.dados, vendedor, idsNaLista: new Set() }).map((o) => o.id).sort()).toEqual(['u-ja', 'u-novo']);
    });
  });
});
