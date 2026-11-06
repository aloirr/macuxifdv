/**
 * T-0077 — Pedidos: busca (fantasia, razão social, nº), período Dia | Mês | Ano, linha única de situações e, no Gestão,
 * o filtro por vendedor. SEM BANCO (roda local). Matriz: docs/testes/T-0077.md.
 *
 * - Critério 2: pelo `contracts` PÚBLICO do Vendedor (`@macuxi/vendedor/contracts`, o que o Gestão pode importar): busca
 *   sem acento/maiúscula, número com e sem zeros, período no fuso do TENANT (Manaus, São Paulo, Noronha e Rio Branco, com a
 *   virada do dia em UTC), "emitido 31/10 e aprovado 02/11" em outubro e em novembro, texto ignora período e situação.
 *   O que a tela usa e não está no contrato (`situacaoEfetiva`, `periodoParcialNaJanela`, `resumoDaSituacao`) vem do domain.
 * - Critério 3: o MOTOR DE SYNC real do platform-sdk (`criarMotorSync`, armazenamento em memória, registro com as entidades
 *   do Core e do Vendedor) puxa as linhas de um servidor falso; depois, em modo avião, as linhas locais passam pelo mesmo
 *   caminho da tela (`lerLinhas` → `listaDePedidos`/`listaDeClientes` → `ItemDaBusca`) e a busca/período respondem sem rede.
 *   A montagem do `ItemDaBusca` é conferida no fonte da tela (a tela importa React Native e não roda no Node).
 * - Critério 4: o filtro por vendedor (`domain/filtro-vendedor`) só lista quem tem pedido no aparelho e nunca devolve pedido
 *   de outro vendedor; o seletor só existe no Gestão (fonte da tela); o promotor não recebe a página Pedidos no `criarShell`
 *   (páginas lidas do fonte de modules/vendedor/app/index.ts COM o `perfis` de cada uma, RN-PRO-01).
 *   O escopo da equipe no servidor (o que chega ao aparelho) fica no teste de banco tests/integracao/api/pedidos-equipe-t0077.test.ts (CI).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import type { ClienteSync, HistoricoCompraSync, ParametroSync } from '@macuxi/core/contracts';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as gestor } from '@macuxi/gestor/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import {
  casaComBusca,
  contarPorSituacao,
  deslocarPeriodo,
  destacarTrecho,
  diasComPedido,
  filtrarLista,
  itemNaSituacao,
  itemNoPeriodo,
  JANELA_DIAS,
  mesesDoPeriodo,
  normalizarTexto,
  numeroSemZeros,
  periodoDe,
  periodoForaDaJanela,
  resumoDaLista,
  rotuloDoPeriodo,
  situacaoDoItem,
  type ItemDaBusca,
  type Order,
  type PedidoSync,
  type Periodo,
} from '@macuxi/vendedor/contracts';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import {
  ambienteIndisponivel,
  criarArmazenamentoEmMemoria,
  criarMotorSync,
  criarRegistroSync,
  criarShell,
  ehAcaoDeEscritaDePedido,
  ehAcaoDePedido,
  type AmbienteAparelho,
  type LinhaSync,
  type ModuloShell,
  type PaginaShell,
  type PaginaSync,
  type Perfil,
  type TransporteSync,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { montarCliente360Local } from '../../modules/core/app/lib/cliente360-local';
import { entidadesCliente } from '../../modules/core/app/lib/entidades-cliente';
import { entidadesRota } from '../../modules/core/app/lib/entidades-rota';
import { filtrarExtensoesDePedido, pedidosVisiveisNoAparelho } from '../../modules/core/domain';
import { LINHAS_VAZIAS as LINHAS_VAZIAS_T, lerLinhas, listaDeClientes, listaDePedidos } from '../../modules/vendedor/app/lib/pull';
import { ENTIDADES_VENDEDOR } from '../../modules/vendedor/contracts/entidades';
import { periodoParcialNaJanela, resumoDaSituacao, situacaoEfetiva } from '../../modules/vendedor/domain/busca-periodo';
import { filtrarPorVendedor, opcoesDeVendedor, TODOS_OS_VENDEDORES } from '../../modules/vendedor/domain/filtro-vendedor';
import { estadoDaConsulta, mensagemForaDaJanela, textoDoVazio } from '../../modules/vendedor/app/lib/consulta-periodo';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const TELA = ler('modules/vendedor/app/screens/orders-screen.tsx');

/**
 * O vazio da lista mostra `vazio` quando não há linha visível, em qualquer das duas formas da tela:
 * - ternário explícito: `visiveis.length === 0 ? <Empty text={vazio} /> : null`;
 * - lista virtualizada: `<FlatList ... data={visiveis} ... ListEmptyComponent={ ... <Empty text={vazio} /> ... }`
 *   (a FlatList só desenha o ListEmptyComponent com `data` vazia).
 */
function vazioLigadoAosVisiveis(fonte: string): boolean {
  if (/visiveis\.length === 0\s*\?\s*(?:\(\s*)?<Empty text=\{vazio\}\s*\/>/.test(fonte)) return true;
  const inicio = fonte.indexOf('<FlatList');
  if (inicio < 0) return false;
  const lista = fonte.slice(inicio);
  // `data={visiveis}` nas props da própria FlatList (antes do primeiro filho/cabeçalho) e o <Empty text={vazio}> dentro do
  // ListEmptyComponent (sem atravessar para outra prop da lista)
  const props = lista.slice(0, lista.search(/ListHeaderComponent=|ListEmptyComponent=/) + 1 || 3_000);
  return /\bdata=\{visiveis\}/.test(props) && /ListEmptyComponent=\{(?:(?!ListHeaderComponent=|ListFooterComponent=|renderItem=)[\s\S]){0,200}<Empty text=\{vazio\}\s*\/>/.test(lista);
}

const MANAUS = 'America/Manaus'; // UTC−4
const SP = 'America/Sao_Paulo'; // UTC−3
const NORONHA = 'America/Noronha'; // UTC−2
const RIO_BRANCO = 'America/Rio_Branco'; // UTC−5
/** "Agora" fixo: quarta, 04/11/2026 11:00 em Manaus. */
const AGORA = '2026-11-04T15:00:00.000Z';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ---------------------------------------------------------------------------------------------------------------------
// Massa da tela (ItemDaBusca), igual ao que a orders-screen monta a partir do `Order` (received_at / updated_at)
// ---------------------------------------------------------------------------------------------------------------------
const it_ = (o: Partial<ItemDaBusca> & Pick<ItemDaBusca, 'id'>): ItemDaBusca => ({
  numero: '',
  nome_fantasia: '',
  razao_social: '',
  tipo: 'pedido',
  status: 'received',
  local: false,
  total_cents: 0,
  emitido_em: AGORA,
  status_alterado_em: null,
  ...o,
});

/** P11: emitido 31/10 (11h Manaus) e aprovado 02/11 (10h Manaus) — o caso do critério 2. */
const P11 = it_({ id: 'P11', numero: '000011', nome_fantasia: 'Mercadinho São João', razao_social: 'Comércio de Alimentos Açaí Ltda', status: 'approved', total_cents: 150_000, emitido_em: '2026-10-31T15:00:00.000000Z', status_alterado_em: '2026-11-02T14:00:00.000000Z' });
/** P112: emitido 03/11 02:30 UTC = 02/11 22:30 em Manaus, 23:30 em SP, 21:30 em Rio Branco, 03/11 00:30 em Noronha. */
const P112 = it_({ id: 'P112', numero: '000112', nome_fantasia: 'Padaria Pão Quente', razao_social: 'Panificadora Ávila ME', status: 'pending_approval', total_cents: 80_000, emitido_em: '2026-11-03T02:30:00.000Z', status_alterado_em: '2026-11-03T02:30:00.000Z' });
/** P13: emitido 01/11 03:30 UTC = 31/10 23:30 em Manaus e 01/11 00:30 em SP (a virada do mês depende do fuso). */
const P13 = it_({ id: 'P13', numero: '000013', nome_fantasia: 'Auto Peças Um', razao_social: 'AUTO PECAS UM LTDA', status: 'rejected', total_cents: 50_000, emitido_em: '2026-11-01T03:30:00.000Z', status_alterado_em: '2026-11-01T03:30:00.000Z' });
const P14 = it_({ id: 'P14', numero: '000014', nome_fantasia: 'Atacadão Japiim', razao_social: 'Japiim Atacado S/A', tipo: 'orcamento', status: 'received', total_cents: 99_900, emitido_em: '2026-11-04T13:00:00.000Z' });
const P15 = it_({ id: 'P15', numero: '000015', nome_fantasia: 'Bar do Zé', razao_social: 'José Silva ME', status: 'cancelled', total_cents: 10_000, emitido_em: '2026-11-04T12:00:00.000Z', status_alterado_em: '2026-11-04T12:30:00.000Z' });
/** P16: agosto (dentro da janela de 90 dias, que começa em 06/08). */
const P16 = it_({ id: 'P16', numero: '000016', nome_fantasia: 'Supermercado Ávila', razao_social: 'Ávila Supermercados Ltda', status: 'invoiced', total_cents: 200_000, emitido_em: '2026-08-20T12:00:00.000Z', status_alterado_em: '2026-08-21T12:00:00.000Z' });
/** Na fila do aparelho: ainda sem número. */
const FILA = it_({ id: 'FILA', numero: '', nome_fantasia: 'Mercearia Nossa Senhora', razao_social: 'N. Sra. Comércio', status: 'queued', local: true, total_cents: 12_300, emitido_em: '2026-11-04T14:00:00.000Z', status_alterado_em: '2026-11-04T14:00:00.000Z' });
const TODOS = [P11, P112, P13, P14, P15, P16, FILA];

const ids = (l: readonly ItemDaBusca[]) => l.map((i) => i.id).sort();
const busca = (q: string) => ids(TODOS.filter((i) => casaComBusca(i, q)));
const lista = (periodo: Periodo, tz = MANAUS, q = '') => ids(filtrarLista(TODOS, { periodo, busca: q, tz }));
const mes = (valor: string): Periodo => ({ tipo: 'mes', valor });
const dia = (valor: string): Periodo => ({ tipo: 'dia', valor });
const ano = (valor: string): Periodo => ({ tipo: 'ano', valor });

describe('T-0077 critério 2 — busca pelo contrato público do Vendedor (RF-VEN-05)', () => {
  it('nome fantasia sem acento e sem maiúscula', () => {
    expect(busca('sao joao')).toEqual(['P11']);
    expect(busca('SÃO JOÃO')).toEqual(['P11']);
    expect(busca('  pão quente ')).toEqual(['P112']);
    expect(busca('pao')).toEqual(['P112']);
  });

  it('razão social sem acento e sem maiúscula (inclusive quando a razão está toda em maiúscula sem acento)', () => {
    expect(busca('comercio de alimentos acai')).toEqual(['P11']);
    expect(busca('panificadora')).toEqual(['P112']);
    expect(busca('auto peças um ltda')).toEqual(['P13']);
    // "ávila" está na razão do P112 e na fantasia/razão do P16
    expect(busca('avila')).toEqual(['P112', 'P16']);
  });

  it('número com e sem zeros à esquerda acha o mesmo conjunto ("11" = "011" = "000011")', () => {
    const com11 = busca('11');
    expect(com11).toContain('P11');
    expect(busca('000011')).toEqual(com11);
    expect(busca('011')).toEqual(com11);
    expect(busca('13')).toEqual(['P13']);
    expect(busca('000013')).toEqual(['P13']);
    expect(numeroSemZeros('000011')).toBe('11');
    expect(numeroSemZeros('000000')).toBe('0');
  });

  it('pedido na fila (sem número) não casa por número, mas casa por nome', () => {
    expect(casaComBusca(FILA, '0')).toBe(false);
    expect(busca('nossa senhora')).toEqual(['FILA']);
  });

  it('texto que não existe não acha nada; busca vazia ou só espaços casa tudo', () => {
    expect(busca('farmácia')).toEqual([]);
    expect(busca('999')).toEqual([]);
    expect(busca('   ')).toEqual(ids(TODOS));
    expect(normalizarTexto(' ÁÉÍÕÇ ')).toBe('aeioc');
  });

  it('o destaque marca o trecho no texto ORIGINAL (com acento), achado sem acento', () => {
    expect(destacarTrecho('Mercadinho São João', 'sao')).toEqual([
      { texto: 'Mercadinho ', destaque: false },
      { texto: 'São', destaque: true },
      { texto: ' João', destaque: false },
    ]);
    expect(destacarTrecho('Padaria Pão Quente', 'xyz')).toEqual([{ texto: 'Padaria Pão Quente', destaque: false }]);
  });
});

describe('T-0077 critério 2 — período Dia | Mês | Ano no fuso do tenant (RF-VEN-05)', () => {
  it('emitido em 31/10 e aprovado em 02/11: aparece em OUTUBRO (emissão) e em NOVEMBRO (mudança de status), uma vez em cada', () => {
    expect(itemNoPeriodo(P11, mes('2026-10'), MANAUS)).toBe(true);
    expect(itemNoPeriodo(P11, mes('2026-11'), MANAUS)).toBe(true);
    expect(itemNoPeriodo(P11, mes('2026-09'), MANAUS)).toBe(false);
    expect(itemNoPeriodo(P11, dia('2026-10-31'), MANAUS)).toBe(true);
    expect(itemNoPeriodo(P11, dia('2026-11-02'), MANAUS)).toBe(true);
    expect(itemNoPeriodo(P11, dia('2026-11-01'), MANAUS)).toBe(false);
    const doAno = filtrarLista(TODOS, { periodo: ano('2026'), busca: '', tz: MANAUS });
    expect(doAno.filter((i) => i.id === 'P11')).toHaveLength(1);
  });

  it('Mês no fuso de Manaus: 01/11 03:30 UTC ainda é OUTUBRO (P13); em São Paulo (UTC−3) já é NOVEMBRO', () => {
    expect(lista(mes('2026-10'), MANAUS)).toEqual(['P11', 'P13']);
    expect(lista(mes('2026-11'), MANAUS)).toEqual(['FILA', 'P11', 'P112', 'P14', 'P15']);
    expect(lista(mes('2026-10'), SP)).toEqual(['P11']);
    expect(lista(mes('2026-11'), SP)).toEqual(['FILA', 'P11', 'P112', 'P13', 'P14', 'P15']);
  });

  it('Dia com a virada em UTC: 03/11 02:30 UTC é 02/11 em Manaus, SP e Rio Branco, mas 03/11 em Noronha (UTC−2)', () => {
    for (const tz of [MANAUS, SP, RIO_BRANCO]) {
      expect(itemNoPeriodo(P112, dia('2026-11-02'), tz), tz).toBe(true);
      expect(itemNoPeriodo(P112, dia('2026-11-03'), tz), tz).toBe(false);
    }
    expect(itemNoPeriodo(P112, dia('2026-11-03'), NORONHA)).toBe(true);
    expect(itemNoPeriodo(P112, dia('2026-11-02'), NORONHA)).toBe(false);
    // mesmo dia civil em Manaus: aprovado 02/11 10h (P11) e emitido 02/11 22:30 (P112)
    expect(lista(dia('2026-11-02'), MANAUS)).toEqual(['P11', 'P112']);
    expect(lista(dia('2026-10-31'), MANAUS)).toEqual(['P11', 'P13']);
    expect(lista(dia('2026-10-31'), SP)).toEqual(['P11']);
  });

  it('Ano: todos os de 2026 uma vez; 2025 vazio', () => {
    expect(lista(ano('2026'))).toEqual(ids(TODOS));
    expect(lista(ano('2025'))).toEqual([]);
  });

  it('padrão = mês atual NO FUSO: 01/11 03:30 UTC abre outubro em Manaus e novembro em São Paulo', () => {
    expect(periodoDe('mes', AGORA, MANAUS)).toEqual(mes('2026-11'));
    expect(periodoDe('mes', '2026-11-01T03:30:00.000Z', MANAUS)).toEqual(mes('2026-10'));
    expect(periodoDe('mes', '2026-11-01T03:30:00.000Z', SP)).toEqual(mes('2026-11'));
    expect(periodoDe('dia', '2026-11-03T02:30:00.000Z', NORONHA)).toEqual(dia('2026-11-03'));
    expect(periodoDe('ano', '2027-01-01T03:00:00.000Z', MANAUS)).toEqual(ano('2026'));
  });

  it('‹ › atravessa mês, ano e fevereiro (bissexto); rótulos da referência', () => {
    expect(deslocarPeriodo(mes('2026-01'), -1)).toEqual(mes('2025-12'));
    expect(deslocarPeriodo(mes('2026-12'), 1)).toEqual(mes('2027-01'));
    expect(deslocarPeriodo(dia('2026-03-01'), -1)).toEqual(dia('2026-02-28'));
    expect(deslocarPeriodo(dia('2028-03-01'), -1)).toEqual(dia('2028-02-29'));
    expect(deslocarPeriodo(dia('2026-12-31'), 1)).toEqual(dia('2027-01-01'));
    expect(deslocarPeriodo(ano('2026'), -1)).toEqual(ano('2025'));
    expect(rotuloDoPeriodo(dia('2026-11-02'))).toBe('Seg, 02/11/2026');
    expect(rotuloDoPeriodo(mes('2026-11'))).toBe('Novembro 2026');
    expect(rotuloDoPeriodo(ano('2026'))).toBe('2026');
    expect(mesesDoPeriodo('2026')).toHaveLength(12);
  });

  it('marca do calendário: dias com pedido no fuso (emissão e mudança de status)', () => {
    expect(diasComPedido(TODOS, '2026-10', MANAUS)).toEqual(['2026-10-31']);
    expect(diasComPedido(TODOS, '2026-11', MANAUS)).toEqual(['2026-11-02', '2026-11-04']);
    expect(diasComPedido(TODOS, '2026-11', NORONHA)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  });
});

describe('T-0077 critério 2 — com texto na busca, período e situação são ignorados (R1 da revisão de UX)', () => {
  it('a busca procura em toda a janela do aparelho, fora do período escolhido', () => {
    expect(lista(dia('2026-11-04'), MANAUS, 'padaria')).toEqual(['P112']);
    expect(lista(mes('2025-01'), MANAUS, 'avila')).toEqual(['P112', 'P16']);
    expect(lista(ano('2020'), MANAUS, '000013')).toEqual(['P13']);
    // sem texto vale o período
    expect(lista(dia('2026-11-04'), MANAUS, '')).toEqual(['FILA', 'P14', 'P15']);
  });

  it('a situação escolhida vira Todos enquanto há texto, e volta quando o texto sai', () => {
    expect(situacaoEfetiva('aprovados', true)).toBe('todos');
    expect(situacaoEfetiva('orc_abertos', true)).toBe('todos');
    expect(situacaoEfetiva('aprovados', false)).toBe('aprovados');
    const achados = filtrarLista(TODOS, { periodo: mes('2026-11'), busca: 'auto', tz: MANAUS });
    // P13 é rejeitado; com o chip Aprovados escolhido antes, continua visível porque a situação efetiva é Todos
    expect(achados.filter((i) => itemNaSituacao(i, situacaoEfetiva('aprovados', true))).map((i) => i.id)).toEqual(['P13']);
    expect(achados.filter((i) => itemNaSituacao(i, situacaoEfetiva('aprovados', false)))).toEqual([]);
  });

  it('a tela usa exatamente isso: filtrarLista com o texto e situacaoEfetiva(…, buscando)', () => {
    expect(TELA).toMatch(/const buscando = normalizarTexto\(busca\) !== ''/);
    expect(TELA).toMatch(/filtrarLista\(itens, \{ periodo, busca, tz \}\)/);
    expect(TELA).toMatch(/situacaoEfetiva<Situacao>\([\s\S]{0,160}, buscando\)/);
  });
});

describe('T-0077 critérios 3 e 4 da referência — linha de situações e resumo', () => {
  it('cada item cai num chip só; os chips mostram só as situações com itens, com contagem', () => {
    expect(TODOS.map((i) => [i.id, situacaoDoItem(i)])).toEqual([
      ['P11', 'aprovados'],
      ['P112', 'aguardando'],
      ['P13', 'rejeitados'],
      ['P14', 'orcamentos'],
      ['P15', null],
      ['P16', 'aprovados'],
      ['FILA', 'na_fila'],
    ]);
    const c = contarPorSituacao(filtrarLista(TODOS, { periodo: mes('2026-10'), busca: '', tz: MANAUS }));
    expect(c.chips.map((x) => `${x.rotulo} ${x.quantidade}`)).toEqual(['Todos 2', 'Aprovados 1', 'Rejeitados 1']);
  });

  it('resumo "N pedidos · R$ X": sem orçamento e sem cancelado; no chip Orçamentos conta os orçamentos', () => {
    const nov = filtrarLista(TODOS, { periodo: mes('2026-11'), busca: '', tz: MANAUS });
    expect(resumoDaLista(nov)).toEqual({ quantidade: 3, total_cents: 150_000 + 80_000 + 12_300 });
    expect(resumoDaSituacao(nov.filter((i) => itemNaSituacao(i, 'orcamentos')), 'orcamentos')).toEqual({ quantidade: 1, total_cents: 99_900, orcamentos: true });
  });
});

describe('T-0077 critério 3 — janela do aparelho (90 dias) e "Disponível com conexão"', () => {
  it('limite da janela no fuso do tenant: 04/11 → começa em 06/08', () => {
    expect(JANELA_DIAS).toBe(90);
    expect(periodoForaDaJanela(mes('2026-07'), AGORA, MANAUS)).toBe(true);
    expect(periodoForaDaJanela(mes('2026-08'), AGORA, MANAUS)).toBe(false);
    expect(periodoParcialNaJanela(mes('2026-08'), AGORA, MANAUS)).toBe(true);
    expect(periodoForaDaJanela(dia('2026-08-05'), AGORA, MANAUS)).toBe(true);
    expect(periodoForaDaJanela(dia('2026-08-06'), AGORA, MANAUS)).toBe(false);
    expect(periodoForaDaJanela(ano('2025'), AGORA, MANAUS)).toBe(true);
    expect(periodoForaDaJanela(ano('2026'), AGORA, MANAUS)).toBe(false);
    expect(periodoParcialNaJanela(ano('2026'), AGORA, MANAUS)).toBe(true);
    expect(periodoParcialNaJanela(mes('2026-11'), AGORA, MANAUS)).toBe(false);
  });

  it('a virada do dia em UTC muda o limite: 04/11 03:00 UTC (03/11 23h em Manaus) → janela começa em 05/08 em Manaus e 06/08 em SP', () => {
    const quase = '2026-11-04T03:00:00.000Z';
    expect(periodoForaDaJanela(dia('2026-08-05'), quase, MANAUS)).toBe(false);
    expect(periodoForaDaJanela(dia('2026-08-05'), quase, SP)).toBe(true);
  });

  it('a tela: fora da janela e sem sinal mostra "Disponível com conexão"; com texto na busca não vale a janela', () => {
    // a decisão (função pura de app/lib/consulta-periodo, a mesma que a tela chama)
    expect(estadoDaConsulta({ fora: true, offline: true })).toBe('disponivel_com_conexao');
    expect(estadoDaConsulta({ fora: true, offline: false })).toBe('consultar');
    expect(estadoDaConsulta({ fora: false, offline: true })).toBe('local');
    expect(estadoDaConsulta({ fora: false, offline: false })).toBe('local');
    expect(mensagemForaDaJanela('disponivel_com_conexao')).toBe('Disponível com conexão');
    expect(mensagemForaDaJanela('carregando')).not.toBe('Disponível com conexão');
    expect(mensagemForaDaJanela('erro')).not.toBe('Disponível com conexão');
    // o que a tela calcula, com as mesmas peças: julho/2026 fica fora da janela; com texto na busca a janela não vale
    const foraNaTela = (buscando: boolean, p: Periodo) => !buscando && periodoForaDaJanela(p, AGORA, MANAUS);
    expect(estadoDaConsulta({ fora: foraNaTela(false, mes('2026-07')), offline: true })).toBe('disponivel_com_conexao');
    expect(estadoDaConsulta({ fora: foraNaTela(true, mes('2026-07')), offline: true })).toBe('local');
    expect(estadoDaConsulta({ fora: foraNaTela(false, mes('2026-11')), offline: true })).toBe('local');
    // o texto do vazio (função pura textoDoVazio, a mesma que a tela chama): fora da janela e sem sinal → "Disponível com
    // conexão"; com texto na busca `fora` é falso e vale o texto da busca, nunca o da janela
    const vazioDe = (buscando: boolean, p: Periodo, semSinal: boolean) => {
      const fora = foraNaTela(buscando, p);
      return textoDoVazio({ fora, modoConsulta: estadoDaConsulta({ fora, offline: semSinal }), estadoDoServidor: null, buscando, situacao: 'todos', gestao: false });
    };
    expect(textoDoVazio({ fora: true, modoConsulta: 'disponivel_com_conexao', estadoDoServidor: null, buscando: false, situacao: 'todos', gestao: false })).toBe('Disponível com conexão');
    expect(vazioDe(false, mes('2026-07'), true)).toBe('Disponível com conexão');
    expect(vazioDe(true, mes('2026-07'), true)).not.toBe('Disponível com conexão');
    expect(vazioDe(true, mes('2026-07'), true)).toBe(textoDoVazio({ fora: false, modoConsulta: 'local', estadoDoServidor: null, buscando: true, situacao: 'todos', gestao: false }));
    expect(vazioDe(false, mes('2026-11'), true)).not.toBe('Disponível com conexão');
    // com sinal, fora da janela: enquanto consulta não é "Disponível com conexão"; com a resposta 'ok' vazia, o texto do período
    expect(textoDoVazio({ fora: true, modoConsulta: 'consultar', estadoDoServidor: null, buscando: false, situacao: 'todos', gestao: false })).not.toBe('Disponível com conexão');
    expect(textoDoVazio({ fora: true, modoConsulta: 'consultar', estadoDoServidor: 'ok', buscando: false, situacao: 'todos', gestao: false })).not.toBe('Disponível com conexão');
    // a fiação na tela (nomes estáveis): `fora` exige busca vazia; sem sinal = offline do sync OU ambiente sem rede;
    // o texto do vazio vem de textoDoVazio com o `fora` e o `modoConsulta` da tela e aparece no <Empty>
    expect(TELA).toMatch(/const fora = !buscando && !semPeriodo && periodoForaDaJanela\(periodo, agora, tz\)/);
    expect(TELA).toMatch(/const semSinal = offline \|\| !ambiente\.online\(\)/);
    expect(TELA).toMatch(/const modoConsulta = estadoDaConsulta\(\{ fora, offline: semSinal \}\)/);
    expect(TELA).toMatch(/const vazio = textoDoVazio\(\{ fora, modoConsulta,/);
    // o <Empty text={vazio}> aparece quando `visiveis` está vazia: na lista virtualizada (V9) é o ListEmptyComponent da
    // FlatList com data={visiveis}; na forma antiga, o ternário explícito. O texto já é decidido pela função pura
    // textoDoVazio (R-20261105-121758-testes, atendido); aqui fica só a fiação do JSX, sem depender da forma dele.
    expect(vazioLigadoAosVisiveis(TELA), 'orders-screen.tsx: <Empty text={vazio} /> não aparece quando `visiveis` está vazia').toBe(true);
    // sem sinal não há consulta ao servidor: o efeito só roda no estado 'consultar'
    expect(TELA).toMatch(/if \(modoConsulta !== 'consultar'\) return;/);
  });

  it('a conferência do vazio aceita as duas formas da tela e recusa o vazio desligado dos visíveis', () => {
    expect(vazioLigadoAosVisiveis('{visiveis.length === 0 ? <Empty text={vazio} /> : null}')).toBe(true);
    expect(vazioLigadoAosVisiveis('<FlatList data={visiveis} renderItem={r} ListEmptyComponent={\n<Card>\n<Empty text={vazio} />\n</Card>} />')).toBe(true);
    expect(vazioLigadoAosVisiveis('<FlatList data={outros} ListEmptyComponent={<Empty text={vazio} />} />')).toBe(false);
    expect(vazioLigadoAosVisiveis('<FlatList data={visiveis} ListEmptyComponent={null} ListFooterComponent={<Empty text={vazio} />} />')).toBe(false);
    expect(vazioLigadoAosVisiveis('<ScrollView><Empty text={vazio} /></ScrollView>')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Critério 3 — motor de sync REAL (sem banco): pull de um servidor falso, depois modo avião
// ---------------------------------------------------------------------------------------------------------------------
const baseLinha = (em: string) => ({ created_at: em, updated_at: em, deleted_at: null, external_id: null });
const CLIENTE = { a: U(101), b: U(102), c: U(103) };
const VEND = { lucas: U(1), maria: U(2) };

function pedidoSync(o: Partial<PedidoSync> & Pick<PedidoSync, 'id' | 'cliente_id' | 'vendedor_id' | 'numero' | 'cliente_nome' | 'vendedor_nome' | 'status' | 'recebido_em' | 'updated_at'>): PedidoSync {
  return {
    ...baseLinha(o.recebido_em!),
    autor_id: o.vendedor_id,
    condicao_pagamento: null,
    desconto_pct: 0,
    total_tabela_cents: o.total_cents ?? 10_000,
    total_cents: 10_000,
    observacao: null,
    visita_id: null,
    rota_parada_id: null,
    criado_no_aparelho_em: null,
    numero_erp: null,
    motivo_cancelamento: null,
    condicao_pagamento_descricao: 'À vista',
    nivel_aprovacao: null,
    motivos_aprovacao: [],
    tipo: 'pedido',
    ...o,
  } as PedidoSync;
}
const clienteSync = (id: string, fantasia: string, razao: string): ClienteSync =>
  ({ ...baseLinha('2026-09-01T12:00:00.000Z'), id, documento: null, razao_social: razao, nome_fantasia: fantasia, segmento: null, telefone: null, email: null, logradouro: null, numero: null, bairro: null, cidade: 'Manaus', uf: 'AM', cep: null, latitude: null, longitude: null, ativo: true }) as ClienteSync;

const SERVIDOR: Record<string, LinhaSync[]> = {
  cliente: [clienteSync(CLIENTE.a, 'Mercadinho São João', 'Comércio de Alimentos Açaí Ltda'), clienteSync(CLIENTE.b, 'Padaria Pão Quente', 'Panificadora Ávila ME'), clienteSync(CLIENTE.c, 'Auto Peças Um', 'AUTO PECAS UM LTDA')],
  pedido: [
    pedidoSync({ id: U(11), numero: '000011', cliente_id: CLIENTE.a, cliente_nome: 'Mercadinho São João', vendedor_id: VEND.lucas, vendedor_nome: 'Lucas Andrade', status: 'approved', recebido_em: '2026-10-31T15:00:00.000000Z', updated_at: '2026-11-02T14:00:00.000000Z', total_cents: 150_000 }),
    pedidoSync({ id: U(12), numero: '000112', cliente_id: CLIENTE.b, cliente_nome: 'Padaria Pão Quente', vendedor_id: VEND.maria, vendedor_nome: 'Maria Souza', status: 'pending_approval', recebido_em: '2026-11-03T02:30:00.000000Z', updated_at: '2026-11-03T02:30:00.000000Z', total_cents: 80_000 }),
    pedidoSync({ id: U(13), numero: '000013', cliente_id: CLIENTE.c, cliente_nome: 'Auto Peças Um', vendedor_id: VEND.lucas, vendedor_nome: 'Lucas Andrade', status: 'rejected', recebido_em: '2026-11-01T03:30:00.000000Z', updated_at: '2026-11-01T03:30:00.000000Z', total_cents: 50_000 }),
  ],
};

/** Monta o aparelho: registro com as entidades do Core (cliente…) e do Vendedor, transporte falso, armazenamento em memória. */
async function aparelho() {
  const chamadas: string[] = [];
  const rede = { online: true };
  const transporte: TransporteSync = {
    async push(itens) {
      chamadas.push('push');
      return itens.map((i) => ({ id: i.id, status: 'aceito' as const }));
    },
    async pull(entidade: string): Promise<PaginaSync<LinhaSync>> {
      if (!rede.online) throw new Error('sem rede');
      chamadas.push(`pull:${entidade}`);
      return { itens: SERVIDOR[entidade] ?? [], proximo_cursor: null };
    },
  };
  const registro = criarRegistroSync([core, catalogo, vendedor]);
  for (const e of [...entidadesCliente, ...ENTIDADES_VENDEDOR]) if (!registro.entidade(e.nome)) registro.registrar(e);
  const motor = criarMotorSync({ registro, armazenamento: criarArmazenamentoEmMemoria(), transporte, online: () => rede.online, agora: () => new Date(AGORA) });
  await motor.carregar();
  await motor.aplicarModulosAtivos(['core', 'catalogo', 'vendedor']);
  return { motor, rede, chamadas };
}

/** O mesmo `ItemDaBusca` que a orders-screen monta (conferido no fonte abaixo). */
function itensDaTela(pedidos: readonly Order[], razaoDe: ReadonlyMap<string, string>): ItemDaBusca[] {
  return pedidos.map((o) => ({
    id: o.id,
    numero: o.number,
    nome_fantasia: o.customer_name,
    razao_social: razaoDe.get(o.customer_id) ?? '',
    tipo: o.tipo,
    status: o.status,
    local: false,
    total_cents: o.total_cents,
    emitido_em: o.received_at,
    status_alterado_em: o.status_changed_at !== undefined ? o.status_changed_at : o.updated_at || null,
  }));
}

describe('T-0077 critério 3 — busca e período offline sobre as linhas que o motor de sync real puxou', () => {
  it('a tela monta o ItemDaBusca do Order assim (emissão = received_at; mudança de status = status_changed_at dos eventos, sem eles updated_at; razão do cliente local)', () => {
    expect(TELA).toMatch(/razaoDe = useMemo\(\(\) => new Map\(dados\.clientes\.map\(\(c\) => \[c\.id, c\.legal_name\]\)\)/);
    expect(TELA).toMatch(/numero: o\.number,/);
    expect(TELA).toMatch(/nome_fantasia: o\.customer_name,/);
    expect(TELA).toMatch(/razao_social: razaoDe\.get\(o\.customer_id\) \?\? '',/);
    expect(TELA).toMatch(/emitido_em: o\.received_at,/);
    expect(TELA).toMatch(/status_alterado_em: o\.status_changed_at !== undefined \? o\.status_changed_at : o\.updated_at \|\| null,/);
  });

  it('pull online → modo avião: fantasia, razão social e nº acham; outubro e novembro no fuso; nenhuma chamada de rede', async () => {
    const { motor, rede, chamadas } = await aparelho();
    expect(await motor.sincronizar(), motor.estado().erro ?? '').toBe(true);
    expect(chamadas).toEqual(expect.arrayContaining(['pull:pedido', 'pull:cliente']));

    rede.online = false; // modo avião
    const antes = chamadas.length;
    const l = await lerLinhas(motor);
    const pedidos = listaDePedidos(l, {});
    const razaoDe = new Map(listaDeClientes(l, { id: VEND.lucas, name: 'Lucas' }).map((c) => [c.id, c.legal_name]));
    const itens = itensDaTela(pedidos, razaoDe);
    const q = (busca: string, periodo: Periodo = mes('2026-11'), tz = MANAUS) => filtrarLista(itens, { periodo, busca, tz }).map((i) => i.numero).sort();

    expect(q('sao joao')).toEqual(['000011']);
    expect(q('panificadora avila')).toEqual(['000112']);
    expect(q('auto pecas um ltda')).toEqual(['000013']);
    expect(q('11')).toEqual(q('000011'));
    expect(q('11')).toContain('000011');
    expect(q('', mes('2026-10'))).toEqual(['000011', '000013']);
    expect(q('', mes('2026-11'))).toEqual(['000011', '000112']);
    expect(q('', mes('2026-11'), SP)).toEqual(['000011', '000013', '000112']);
    expect(q('', dia('2026-11-02'))).toEqual(['000011', '000112']);
    // o sincronizar sem sinal não apaga nada e não sai do aparelho
    expect(await motor.sincronizar()).toBe(false);
    expect(listaDePedidos(await lerLinhas(motor), {})).toHaveLength(3);
    expect(chamadas.length).toBe(antes);
  });
});

/**
 * T-0077-D1 (🟡, CORRIGIDO pelo modulo-vendedor em 04/11, R-20261104-205600): a premissa da tarefa diz que "mudou de status no período" usa a data da
 * ÚLTIMA MUDANÇA DE STATUS; a tela usava `updated_at` da linha `pedido` (agora usa `Order.status_changed_at`, do último `pedido_evento` com `de`), que muda também sem mudança de status (edição do
 * pendente, número do ERP, reenvio do pull quando o servidor reescreve a linha). O histórico (`pedido_evento.ocorrido_em`,
 * com `de`/`para`) já está no aparelho. Convenção: `it.fails` = ainda quebrado; quando corrigir, vira `it` (e o espelho
 * `itensDaTela` acompanha a tela).
 */
describe('T-0077 premissa "mudou de status" = data da última mudança de status (D1, corrigido pelo modulo-vendedor R-20261104-205600)', () => {
  it('D1: pedido aprovado em 16/10 e só regravado em 03/11 (sem mudar de status) NÃO entra em novembro por status', () => {
    const p = pedidoSync({ id: U(21), numero: '000021', cliente_id: CLIENTE.a, cliente_nome: 'Mercadinho São João', vendedor_id: VEND.lucas, vendedor_nome: 'Lucas Andrade', status: 'approved', recebido_em: '2026-10-15T15:00:00.000000Z', updated_at: '2026-11-03T15:00:00.000000Z' });
    const eventos = [
      { ...baseLinha('2026-10-15T15:00:00.000000Z'), id: U(31), pedido_id: U(21), de: null, para: 'received', autor_id: VEND.lucas, autor_nome: 'Lucas', autor_perfil: 'vendedor', motivo: null, nivel: null, acima_do_nivel: false, ocorrido_em: '2026-10-15T15:00:00.000000Z' },
      { ...baseLinha('2026-10-16T15:00:00.000000Z'), id: U(32), pedido_id: U(21), de: 'received', para: 'approved', autor_id: VEND.lucas, autor_nome: 'Lucas', autor_perfil: 'vendedor', motivo: null, nivel: null, acima_do_nivel: false, ocorrido_em: '2026-10-16T15:00:00.000000Z' },
    ];
    const l = { ...LINHAS_VAZIAS_T, pedidos: [p], eventos } as Parameters<typeof listaDePedidos>[0];
    const [item] = itensDaTela(listaDePedidos(l, {}), new Map());
    expect(itemNoPeriodo(item!, mes('2026-10'), MANAUS)).toBe(true);
    expect(itemNoPeriodo(item!, mes('2026-11'), MANAUS)).toBe(false);
  });

  it('D1 (positivo): aprovado em 02/11 pelo evento e regravado em 03/11 entra em novembro pelo DIA DO EVENTO (02/11), não pelo da regravação', () => {
    const p = pedidoSync({ id: U(22), numero: '000022', cliente_id: CLIENTE.a, cliente_nome: 'Mercadinho São João', vendedor_id: VEND.lucas, vendedor_nome: 'Lucas Andrade', status: 'approved', recebido_em: '2026-10-31T15:00:00.000000Z', updated_at: '2026-11-03T15:00:00.000000Z' });
    const ev = (n: number, de: string | null, para: string, em: string) => ({ ...baseLinha(em), id: U(n), pedido_id: U(22), de, para, autor_id: VEND.lucas, autor_nome: 'Lucas', autor_perfil: 'vendedor', motivo: null, nivel: null, acima_do_nivel: false, ocorrido_em: em });
    const eventos = [ev(41, null, 'received', '2026-10-31T15:00:00.000000Z'), ev(42, 'received', 'approved', '2026-11-02T14:00:00.000000Z')];
    const l = { ...LINHAS_VAZIAS_T, pedidos: [p], eventos } as Parameters<typeof listaDePedidos>[0];
    const [item] = itensDaTela(listaDePedidos(l, {}), new Map());
    expect(item!.status_alterado_em).toBe('2026-11-02T14:00:00.000000Z');
    expect(itemNoPeriodo(item!, mes('2026-10'), MANAUS)).toBe(true);
    expect(itemNoPeriodo(item!, mes('2026-11'), MANAUS)).toBe(true);
    expect(itemNoPeriodo(item!, dia('2026-11-02'), MANAUS)).toBe(true);
    expect(itemNoPeriodo(item!, dia('2026-11-03'), MANAUS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Critério 4 — filtro por vendedor (Gestão), seletor só no Gestão, promotor sem a tela Pedidos
// ---------------------------------------------------------------------------------------------------------------------
describe('T-0077 critério 4 — filtro por vendedor no Gestão (RN-CORE-04, RN-PRO-01)', () => {
  const pedidos = [
    { id: 'a', seller_id: VEND.lucas, seller_name: 'Lucas Andrade' },
    { id: 'b', seller_id: VEND.maria, seller_name: 'Maria Souza' },
    { id: 'c', seller_id: VEND.lucas, seller_name: 'Lucas Andrade' },
    { id: 'd', seller_id: U(3), seller_name: '  ' },
  ];

  it('opções = "Todos os vendedores" + só quem tem pedido no aparelho (o que o sync da equipe entregou), sem repetir, em ordem alfabética', () => {
    expect(opcoesDeVendedor(pedidos)).toEqual([
      { id: TODOS_OS_VENDEDORES, nome: 'Todos os vendedores' },
      { id: VEND.lucas, nome: 'Lucas Andrade' },
      { id: VEND.maria, nome: 'Maria Souza' },
      { id: U(3), nome: 'Vendedor sem nome' },
    ]);
    expect(opcoesDeVendedor([])).toEqual([{ id: TODOS_OS_VENDEDORES, nome: 'Todos os vendedores' }]);
  });

  it('o filtro nunca devolve pedido de outro vendedor; vendedor que não está na lista → nenhum pedido (a tela volta a Todos)', () => {
    expect(filtrarPorVendedor(pedidos, VEND.lucas).map((p) => p.id)).toEqual(['a', 'c']);
    expect(filtrarPorVendedor(pedidos, VEND.maria).every((p) => p.seller_id === VEND.maria)).toBe(true);
    expect(filtrarPorVendedor(pedidos, U(999))).toEqual([]);
    expect(filtrarPorVendedor(pedidos, TODOS_OS_VENDEDORES)).toHaveLength(4);
    expect(TELA).toMatch(/const vendedorAtivo = gestao && opcoes\.some\(\(o\) => o\.id === vendedorId\) \? vendedorId : TODOS_OS_VENDEDORES/);
  });

  it('com o motor real: as opções saem dos pedidos puxados (equipe que o servidor entregou), nunca de fora', async () => {
    const { motor } = await aparelho();
    expect(await motor.sincronizar()).toBe(true);
    const pedidosLocais = listaDePedidos(await lerLinhas(motor), {});
    const opcoes = opcoesDeVendedor(pedidosLocais).map((o) => o.id);
    expect(opcoes).toEqual([TODOS_OS_VENDEDORES, VEND.lucas, VEND.maria]);
    const vendedoresNoAparelho = new Set(pedidosLocais.map((p) => p.seller_id));
    for (const id of opcoes.slice(1)) expect(vendedoresNoAparelho.has(id)).toBe(true);
  });

  it('no Campo o seletor não existe: opções e filtro só com `gestao`, o botão "orders-vendedor" só no ramo do Gestão', () => {
    expect(TELA).toMatch(/const gestao = useVisaoShell\(\)\.app === 'gestao'/);
    expect(TELA).toMatch(/const opcoes = useMemo\(\(\) => \(gestao \? opcoesDeVendedor\(orders\) : \[\]\)/);
    // a fonte é a mesma nos dois ramos (aparelho ou, fora dos 90 dias, a consulta ao servidor); só o Gestão filtra
    const doVendedor = /const doVendedor = useMemo\(\(\) => \(gestao \? filtrarPorVendedor\((\w+), vendedorAtivo\) : (\w+)\)/.exec(TELA);
    expect(doVendedor, 'doVendedor filtrado só no ramo do Gestão').not.toBeNull();
    expect(doVendedor![1]).toBe(doVendedor![2]);
    expect(TELA).toMatch(new RegExp(`const ${doVendedor![1]} = doServidor\\?\\.estado === 'ok' \\? doServidor\\.itens : orders`));
    expect(TELA).toMatch(/\{gestao \? \(\s*<Folha [^\n]{0,300}testID="orders-vendedor-folha"/);
    expect((TELA.match(/filtrarPorVendedor\(/g) ?? []).length).toBe(1);
    expect((TELA.match(/opcoesDeVendedor\(/g) ?? []).length).toBe(1);
    expect(TELA).toMatch(/\{gestao \? \(\s*<Pressable\s+testID="orders-vendedor"/);
    // o filtro vale antes da busca, do período, dos chips e do resumo: os itens nascem de `doVendedor`
    expect(TELA).toMatch(/doVendedor\.map\(/);
    expect((TELA.match(/testID="orders-vendedor"/g) ?? []).length).toBe(1);
  });
});

/** Páginas do Vendedor lidas do fonte (a tela importa React Native), COM o `perfis` de cada página. */
function paginasDoFonte(): PaginaShell<string>[] {
  const fonte = ler('modules/vendedor/app/index.ts');
  expect(fonte).toMatch(/const PERFIS_PAGINAS = manifest\.perfis;/);
  const trecho = fonte.slice(fonte.indexOf('paginas:'), fonte.indexOf('entidadesSync:'));
  return trecho
    .split('\n')
    .filter((l) => /\bid: '/.test(l))
    .map((l) => {
      const apps = /apps: \[([^\]]*)\]/.exec(l)?.[1]?.match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)) as Array<'campo' | 'gestao'> | undefined;
      const acao = /\bacao: '([^']+)'/.exec(l)?.[1];
      const navegacao = /navegacao: '([^']+)'/.exec(l)?.[1];
      return {
        id: /\bid: '([^']+)'/.exec(l)![1]!,
        caminho: /caminho: '([^']+)'/.exec(l)![1]!,
        titulo: 'x',
        componente: 'x',
        ...(/perfis: PERFIS_PAGINAS/.test(l) ? { perfis: vendedor.perfis as readonly Perfil[] } : {}),
        ...(apps ? { apps } : {}),
        ...(acao ? { acao } : {}),
        ...(navegacao ? { navegacao } : {}),
      };
    });
}

describe('T-0077 critério 4 — promotor não vê a tela Pedidos (RN-PRO-01), pelo criarShell do platform-sdk', () => {
  const paginas = paginasDoFonte();
  const modulos = (): ModuloShell<string>[] => [{ manifesto: core }, { manifesto: catalogo }, { manifesto: vendedor, paginas }, { manifesto: promotor }, { manifesto: gestor }];
  const TUDO = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor'] as const;

  it('a leitura do fonte achou as páginas e todas restritas aos perfis do manifesto (sem promotor)', () => {
    expect(paginas.map((p) => p.id)).toEqual(['pedidos', 'pedido', 'novo-pedido']);
    for (const p of paginas) {
      expect(p.perfis, p.id).toBeDefined();
      expect(p.perfis, p.id).not.toContain('promotor');
    }
    expect(paginas.find((p) => p.id === 'pedidos')!.apps).toEqual(['campo', 'gestao']);
  });

  it('pior caso: promotor com o Vendedor efetivo — sem a aba Pedidos, sem a lista e sem o detalhe no Campo', () => {
    const v = criarShell('campo', modulos()).montar({ perfil: 'promotor', modulosAtivos: [...TUDO] });
    expect(v.pagina('pedidos')).toBeNull();
    expect(v.pagina('pedido')).toBeNull();
    expect(v.pagina('novo-pedido')).toBeNull();
    expect(v.navegacao.filter((n) => n.modulo === 'vendedor')).toEqual([]);
  });

  it('controle positivo: o vendedor vê Pedidos no Campo; supervisor e gerente veem Pedidos no Gestão e (T-0085) a página novo-pedido do pedido em nome, sem aba própria', () => {
    const campo = criarShell('campo', modulos()).montar({ perfil: 'vendedor', modulosAtivos: [...TUDO] });
    expect(campo.pagina('pedidos')).not.toBeNull();
    expect(campo.pagina('novo-pedido')).not.toBeNull();
    expect(campo.navegacao.filter((n) => n.modulo === 'vendedor').map((n) => n.rotulo)).toEqual(['Pedidos']);
    expect(paginas.find((p) => p.id === 'novo-pedido')).toMatchObject({ apps: ['campo', 'gestao'], acao: 'pedido.criar' });
    for (const perfil of ['supervisor', 'gerente'] as const) {
      const g = criarShell('gestao', modulos()).montar({ perfil, modulosAtivos: [...TUDO] });
      expect(g.pagina('pedidos'), perfil).not.toBeNull();
      expect(g.pagina('novo-pedido'), perfil).not.toBeNull();
      expect(g.navegacao.filter((n) => n.modulo === 'vendedor').map((n) => n.rotulo), perfil).toEqual(['Pedidos']);
    }
  });

  it('regra 7 (T-0085): o promotor não recebe novo-pedido nem a lista no Gestão, com o Vendedor efetivo', () => {
    const g = criarShell('gestao', modulos()).montar({ perfil: 'promotor', modulosAtivos: [...TUDO] });
    expect(g.pagina('novo-pedido')).toBeNull();
    expect(g.pagina('pedidos')).toBeNull();
    expect(g.pagina('pedido')).toBeNull();
    expect(g.pode('pedido.criar')).toBe(false);
    expect(g.pode('pedido.criar_em_nome')).toBe(false);
  });

  it('sem o Vendedor licenciado nem o vendedor vê Pedidos (módulo inativo some do app)', () => {
    const v = criarShell('campo', modulos()).montar({ perfil: 'vendedor', modulosAtivos: ['core', 'catalogo', 'promotor'] });
    expect(v.pagina('pedidos')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Critério 4 (reescrito pela decisão do gerente R-20261104-204823): o promotor LÊ os pedidos da carteira só no Cliente 360
// do Core, conforme `promotor_ve_pedidos` (doc 03 §2, R-20261102-204544), e nunca escreve (RN-PRO-01). No aparelho a leitura
// é a seção "Compras dos últimos 12 meses" (N pedidos · N itens · valor por mês) e o resumo de compras, montados pelo Core
// com as linhas do sync (`historico_compra`) e o parâmetro sincronizado (`parametro`). As telas importam React Native: o
// encadeamento do hook (`useClientesLocais` → `montarFichaLocal`) é reproduzido aqui com as MESMAS funções e conferido no fonte.
// ---------------------------------------------------------------------------------------------------------------------
const HOJE_MANAUS = '2026-11-04';
const HIST = (id: number, ano_mes: string, pedidos: number, valor_cents: number, ultima: string): HistoricoCompraSync => ({
  id: U(id),
  updated_at: '2026-11-01T12:00:00.000Z',
  deleted_at: null,
  external_id: null,
  cliente_id: CLIENTE.a,
  ano_mes,
  valor_cents,
  pedidos,
  itens: pedidos * 3,
  ultima_compra_em: ultima,
  origem: 'erp',
});
const PARAM = (valor: unknown): ParametroSync => ({ id: U(950), updated_at: '2026-11-03T12:00:00.000Z', deleted_at: null, external_id: null, modulo: 'core', chave: 'promotor_ve_pedidos', valor });

/** Aparelho de um perfil (Campo), com o Vendedor efetivo (pior caso); `servidor.parametro` muda entre um sync e outro. */
async function aparelhoDoPerfil(perfil: Perfil, servidor: { parametro: LinhaSync[] }) {
  const chamadas: string[] = [];
  const rede = { online: true };
  const dados: Record<string, LinhaSync[]> = {
    cliente: [clienteSync(CLIENTE.a, 'Mercadinho São João', 'Comércio de Alimentos Açaí Ltda')],
    historico_compra: [HIST(960, '2026-10', 2, 800_000, '2026-10-20'), HIST(961, '2026-09', 1, 300_000, '2026-09-12')],
  };
  const transporte: TransporteSync = {
    async push(itens) {
      chamadas.push('push');
      return itens.map((i) => ({ id: i.id, status: 'aceito' as const }));
    },
    async pull(entidade: string): Promise<PaginaSync<LinhaSync>> {
      if (!rede.online) throw new Error('sem rede');
      chamadas.push(`pull:${entidade}`);
      return { itens: entidade === 'parametro' ? servidor.parametro : (dados[entidade] ?? []), proximo_cursor: null };
    },
  };
  const ambiente: AmbienteAparelho = { ...ambienteIndisponivel(), online: () => rede.online, usuario: () => ({ id: U(900), nome: `Usuário ${perfil}`, perfil, fuso: MANAUS }) };
  const registro = criarRegistroSync([core, catalogo, vendedor]);
  for (const e of [...entidadesCliente, ...entidadesRota, ...ENTIDADES_VENDEDOR]) if (!registro.entidade(e.nome)) registro.registrar(e);
  const motor = criarMotorSync({ registro, armazenamento: criarArmazenamentoEmMemoria(), transporte, ambiente, online: () => rede.online, agora: () => new Date(AGORA) });
  await motor.carregar();
  await motor.aplicarModulosAtivos(['core', 'catalogo', 'vendedor']);
  return { motor, rede, chamadas };
}

type MotorDeTeste = Awaited<ReturnType<typeof aparelhoDoPerfil>>['motor'];

/** O mesmo encadeamento do Core: `useClientesLocais` (perfil do ambiente + `parametro` local) → `montarFichaLocal`. */
async function fichaNoAparelho(motor: MotorDeTeste, clienteId: string) {
  const [clientes, historico, parametros] = await Promise.all([
    motor.linhas<ClienteSync & LinhaSync>('cliente'),
    motor.linhas<HistoricoCompraSync & LinhaSync>('historico_compra'),
    motor.linhas<ParametroSync & LinhaSync>('parametro'),
  ]);
  const verPedidos = pedidosVisiveisNoAparelho(motor.ambiente.usuario()?.perfil, parametros);
  const cliente = clientes.find((c) => c.id === clienteId && c.deleted_at === null);
  expect(cliente, 'cliente da carteira no aparelho').toBeDefined();
  return montarCliente360Local({ cliente: cliente!, contatos: [], financeiro: null, titulos: [], historico: historico.filter((h) => h.cliente_id === clienteId), enderecos: [] }, HOJE_MANAUS, { verPedidos });
}

describe('T-0077 critério 4 — promotor lê os pedidos da carteira no Cliente 360 conforme promotor_ve_pedidos (RN-PRO-01, R-20261104-204823)', () => {
  const ACOES_ESCRITA = Object.keys(vendedor.acoes).filter((a) => ehAcaoDePedido(a) && ehAcaoDeEscritaDePedido(a));
  const shellDoPromotor = () =>
    criarShell('campo', [{ manifesto: core }, { manifesto: catalogo }, { manifesto: vendedor, paginas: paginasDoFonte() }, { manifesto: promotor }]).montar({ perfil: 'promotor', modulosAtivos: ['core', 'catalogo', 'vendedor', 'promotor'] });

  it('o app encadeia assim (fonte): parâmetro sincronizado + perfil → verPedidos → ficha; abas/ações de pedido filtradas; seção de compras só com pedidos_visiveis', () => {
    const hook = ler('modules/core/app/lib/usar-clientes-locais.ts');
    expect(hook).toMatch(/motor\.linhas<ParametroSync & LinhaSync>\('parametro'\)/);
    expect(hook).toMatch(/const verPedidos = pedidosVisiveisNoAparelho\(motor\.ambiente\.usuario\(\)\?\.perfil, parametros\);/);
    expect(hook).toMatch(/\{ verPedidos: dados\.verPedidos \}/);
    const tela = ler('modules/core/app/telas/cliente.tsx');
    expect(tela).toMatch(/const abas = filtrarExtensoesDePedido\(abasTodas, locais\.verPedidos\);/);
    expect(tela).toMatch(/const acoes = filtrarExtensoesDePedido\(acoesTodas, locais\.verPedidos\);/);
    expect(tela).toMatch(/const ficha = montarFichaLocal\(locais, id, hoje\);/);
    const secoes = ler('modules/core/app/components/cliente360.tsx');
    expect(secoes).toMatch(/\{ficha\.pedidos_visiveis \? \(\s*<View[^>]*testID="cliente-historico"/);
  });

  it('LIGADA (padrão de fábrica, sem registro): o promotor lê no Cliente 360 os pedidos/mês, os valores e a última compra — offline', async () => {
    const { motor, rede } = await aparelhoDoPerfil('promotor', { parametro: [] });
    expect(await motor.sincronizar(), motor.estado().erro ?? '').toBe(true);
    rede.online = false; // modo avião: só as linhas do aparelho
    const f = await fichaNoAparelho(motor, CLIENTE.a);
    expect(f.pedidos_visiveis).toBe(true);
    expect(f.historico.map((h) => [h.ano_mes, h.pedidos, h.valor_cents])).toEqual([
      ['2026-10', 2, 800_000],
      ['2026-09', 1, 300_000],
    ]);
    expect(f.resumo_compras).toMatchObject({ ultima_compra_em: '2026-10-20', total_12m_cents: 1_100_000 });
  });

  it('LIGADA explicitamente (valor true no parâmetro): o mesmo', async () => {
    const { motor, rede } = await aparelhoDoPerfil('promotor', { parametro: [PARAM(true)] });
    expect(await motor.sincronizar(), motor.estado().erro ?? '').toBe(true);
    rede.online = false;
    const f = await fichaNoAparelho(motor, CLIENTE.a);
    expect(f.pedidos_visiveis).toBe(true);
    expect(f.historico).toHaveLength(2);
    expect(f.resumo_compras.total_12m_cents).toBe(1_100_000);
  });

  it('DESLIGADA: o promotor NÃO lê pedidos no Cliente 360 (sem histórico, sem contagem, sem valores), mesmo com as linhas no aparelho e offline', async () => {
    const { motor, rede } = await aparelhoDoPerfil('promotor', { parametro: [PARAM(false)] });
    expect(await motor.sincronizar(), motor.estado().erro ?? '').toBe(true);
    rede.online = false;
    expect(await motor.linhas('historico_compra'), 'as linhas estão no aparelho (o pull não filtra)').toHaveLength(2);
    const f = await fichaNoAparelho(motor, CLIENTE.a);
    expect(f.pedidos_visiveis).toBe(false);
    expect(f.historico).toEqual([]);
    expect(f.resumo_compras).toMatchObject({ ultima_compra_em: null, total_12m_cents: 0, ticket_medio_cents: 0 });
    // as abas/ações de pedido que chegassem ao ponto de montagem também saem (filtro do Core)
    expect(filtrarExtensoesDePedido([{ id: 'ultimos-pedidos', acao: 'pedido.ver' }, { id: 'loja' }], f.pedidos_visiveis).map((i) => i.id)).toEqual(['loja']);
  });

  it('a troca vale no sync seguinte (sem cache): ligada → desligada some; religada volta', async () => {
    const servidor = { parametro: [] as LinhaSync[] };
    const { motor } = await aparelhoDoPerfil('promotor', servidor);
    expect(await motor.sincronizar()).toBe(true);
    expect((await fichaNoAparelho(motor, CLIENTE.a)).pedidos_visiveis).toBe(true);
    servidor.parametro = [PARAM(false)];
    expect(await motor.sincronizar()).toBe(true);
    expect((await fichaNoAparelho(motor, CLIENTE.a)).historico).toEqual([]);
    servidor.parametro = [{ ...PARAM(true), updated_at: '2026-11-04T12:00:00.000Z' }];
    expect(await motor.sincronizar()).toBe(true);
    expect((await fichaNoAparelho(motor, CLIENTE.a)).historico).toHaveLength(2);
  });

  it('controle: vendedor com a opção DESLIGADA continua lendo o Cliente 360 completo (a opção é só do promotor)', async () => {
    const { motor } = await aparelhoDoPerfil('vendedor', { parametro: [PARAM(false)] });
    expect(await motor.sincronizar()).toBe(true);
    const f = await fichaNoAparelho(motor, CLIENTE.a);
    expect(f.pedidos_visiveis).toBe(true);
    expect(f.historico).toHaveLength(2);
  });

  it('RN-PRO-01 nos dois estados: nenhuma escrita — sem aba Pedidos, sem Novo pedido na ficha, nenhuma ação de escrita, nada na fila nem push', async () => {
    const v = shellDoPromotor();
    expect(v.pagina('pedidos')).toBeNull();
    expect(v.pagina('pedido')).toBeNull();
    expect(v.pagina('novo-pedido')).toBeNull();
    expect(v.extensoes('cliente.acoes')).toEqual([]);
    expect(ACOES_ESCRITA.length).toBeGreaterThanOrEqual(6);
    for (const a of ACOES_ESCRITA) expect(v.pode(a), a).toBe(false);
    expect(v.pode('pedido.ver')).toBe(true);
    for (const parametro of [[], [PARAM(false)]] as LinhaSync[][]) {
      const { motor, chamadas } = await aparelhoDoPerfil('promotor', { parametro });
      expect(await motor.sincronizar()).toBe(true);
      await fichaNoAparelho(motor, CLIENTE.a);
      expect(motor.estado().fila).toEqual([]);
      expect(chamadas.filter((c) => c === 'push')).toEqual([]);
    }
  });
});
