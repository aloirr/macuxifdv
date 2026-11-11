/**
 * Novo pedido em 4 abas — Venda · Itens (n) · Entrega · Resumo (RF-VEN-11, T-0136; spec docs/design/pedido-v2.md) sobre os componentes do
 * `packages/ui`. Venda: alertas, forma, prazo e crédito. Itens: busca e itens (na tela). Entrega: endereço, frete e observações.
 * Textos só os da referência enxuta, vindos de `lib/textos-pedido` (com teste). Só lê e escreve o rascunho do aparelho
 * (offline-first); o cálculo vem de `lib/novo-pedido`. Alvos de toque ≥ 48 dp (o ui já garante).
 */
import { formatBRL } from '@macuxi/comum';
import {
  Botao,
  Card,
  Cartao,
  CartaoLeveMais,
  Chip,
  colors,
  DescontoCompacto,
  fonts,
  leituraDoSalvar,
  Icon,
  LinhaValor,
  ListaSuspensa,
  RotuloSecao,
  sanearDecimal,
  Segmentado,
  Selo,
  TabelaValores,
  textoAtualizacao,
  textosLeveMais,
  type as t,
  type ItemLeveMais,
} from '@macuxi/ui/mobile';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { type BotaoDoResumo, type BotoesDoResumo } from '../../domain/botoes-resumo';
import type { FormaDePagamento, PrazoDePagamento } from '../../domain/pagamento';
import type { ModeloDoCredito } from '../lib/credito-cliente';
import { comForma, comPrazo, opcoesDeForma, opcoesDePrazo, rotuloTotalDoPedido, TEXTO_ESCOLHA_A_FORMA, TEXTO_SEM_FORMAS, type LimitesDoCliente } from '../lib/pagamento-pedido';
import { ajusteDoPedidoDoRascunho, rascunhoComTextoDoPedido, rascunhoComTipoDoPedido, textoDoAjuste, valorDoTexto } from '../lib/ajuste-pedido';
import { enderecosDoCliente, transportadorasAtivas, type CalculoPedido, type TipoDoAjuste, type EnderecoDaTela, type FreteDoRascunho, type TransportadoraDaTela } from '../lib/novo-pedido';
import type { Rascunho } from '../lib/pedidos';
import type { SugestaoDaTela, SugestoesDaTela } from '../lib/sugestoes-pedido';
import { linhaDoAjusteSomenteLeitura, nomeDaSugestao, seloDaSugestao, TITULO_COMBINA, linhasDeTotais, rotuloDoAjusteDoPedido } from '../lib/textos-pedido';
import { linhaDaObsNoResumo, ROTULO_CREDITO, tabelaDoCredito, TEXTO_ENDERECO_DO_CADASTRO } from '../lib/textos-venda';
import { dividirPagamentoPrazo, itensDoResumoEmTabela, textoDoFrete } from '../lib/resumo-tabela';
import { linhaLiquidaDosTotais } from '../lib/detalhe-pedido';
import { CartaoDeTotais, TabelaDeItens, TabelaRotuloValor } from './tabelas-pedido';
import { rascunhoComEnderecoEditado, rascunhoComEnderecoEscolhido, enderecoDoRascunho, TEXTOS_ENDERECO } from '../lib/endereco-pedido';
import { CartaoEndereco, FolhaEnderecos, FormularioEndereco } from './endereco-pedido';

type OnRascunho = (fn: (r: Rascunho) => Rascunho) => void;

// ---------- aba 1 · Venda ----------
export const TITULO_LEVE_MAIS_PAGUE_MENOS = 'Leve mais e pague menos';

/**
 * Forma de pagamento e Prazo lado a lado em lista suspensa (RN-VEN-24/25), na aba Venda. O Prazo mostra só os prazos da forma, só o texto do prazo; o que passa do prazo médio do cliente fica desabilitado.
 * Sem formas no aparelho (antes do primeiro sync com a 0037) vale a lista de condições de antes.
 */
export function CardPagamento({
  rascunho: r,
  formas,
  prazos,
  cliente,
  legado,
  onRascunho,
}: {
  rascunho: Rascunho;
  formas: readonly FormaDePagamento[];
  prazos: readonly PrazoDePagamento[];
  cliente: LimitesDoCliente;
  /** condições de antes (APK anterior / tenant sem formas) */
  legado: Array<{ id: string | null; rotulo: string }>;
  onRascunho: OnRascunho;
}) {
  const semFormas = formas.length === 0;
  const opcoesForma = opcoesDeForma(formas, cliente);
  const opcoesPrazo = opcoesDePrazo(prazos, r.forma_pagamento_id ?? null, cliente);
  return (
    <View style={{ gap: 10 }} testID="card-pagamento">
      {semFormas ? (
        <ListaSuspensa
          testID="condicao"
          rotulo="Prazo"
          opcoes={legado.map((op) => ({ id: op.id ?? op.rotulo, rotulo: op.rotulo }))}
          valor={r.condicao_pagamento_id ?? (legado.find((op) => op.id === null && op.rotulo === r.payment_terms)?.rotulo ?? null)}
          placeholder="Escolha"
          rotuloFechar="Fechar a lista"
          onChange={(id) => {
            const op = legado.find((x) => (x.id ?? x.rotulo) === id);
            if (op) onRascunho((d) => ({ ...d, payment_terms: op.rotulo, condicao_pagamento_id: op.id }));
          }}
        />
      ) : opcoesForma.length === 0 ? (
        <Text style={[t.smallStrong, { color: colors.danger }]} testID="pagamento-sem-formas">
          {TEXTO_SEM_FORMAS}
        </Text>
      ) : (
        <View style={s.linhaPagamento}>
          <ListaSuspensa
            testID="forma"
            style={{ flex: 1 }}
            rotulo="Forma de pagamento"
            opcoes={opcoesForma}
            valor={r.forma_pagamento_id ?? null}
            placeholder="Escolha"
            rotuloFechar="Fechar a lista"
            onChange={(id) => {
              const forma = formas.find((f) => f.id === id);
              if (forma) onRascunho((d) => comForma(d, forma, prazos, cliente));
            }}
          />
          <ListaSuspensa
            testID="prazo"
            style={{ flex: 1 }}
            rotulo="Prazo"
            opcoes={opcoesPrazo.map((o) => ({ id: o.id, rotulo: o.rotulo, desabilitada: o.desabilitada, motivo: o.motivo }))}
            valor={r.prazo_pagamento_id ?? null}
            desligado={!r.forma_pagamento_id}
            placeholder={r.forma_pagamento_id ? 'Escolha' : TEXTO_ESCOLHA_A_FORMA}
            rotuloFechar="Fechar a lista"
            onChange={(id) => onRascunho((d) => comPrazo(d, id, formas, prazos))}
          />
        </View>
      )}
    </View>
  );
}

/** Total do pedido no topo da aba Itens ("Total do pedido" · R$ x). Sem rodapé fixo. */
export function TotalDoPedido({ totalCents }: { totalCents: number }) {
  return (
    <Cartao gap={0} testID="card-total-do-pedido">
      <View style={s.totalDoPedido} testID="total-do-pedido">
        <Text style={s.totalRotulo}>{rotuloTotalDoPedido()}</Text>
        <Text style={s.totalValor} testID="total-do-pedido-valor">
          {formatBRL(totalCents)}
        </Text>
      </View>
    </Cartao>
  );
}

/**
 * Aba Venda (RF-VEN-11): forma e prazo (RN-VEN-24/25), limite (os alertas de cliente, crédito e título vão para a área Alertas do topo, RN-VEN-42)
 * total e disponível e prazo médio do cliente, com a data da última sincronização. `credito`: `undefined` = lendo; `null` =
 * consulta indisponível (as linhas de crédito não aparecem). Tudo do aparelho (vale offline).
 */
export function AbaVenda({
  pagamento,
  credito,
  prazoMedioDias,
  sincronizadoEm,
  agora,
  tz,
  semSinal,
}: {
  /** cartão de forma e prazo já montado pela tela (`CardPagamento`) */
  pagamento: ReactNode;
  credito: ModeloDoCredito | null | undefined;
  prazoMedioDias: number | null | undefined;
  sincronizadoEm: string | null;
  agora: Date;
  tz: string;
  semSinal: boolean;
}) {
  const tabela = tabelaDoCredito(credito, prazoMedioDias);
  return (
    <View style={{ gap: 12 }} testID="aba-venda-conteudo">
      {pagamento}
      {tabela.estado === 'indisponivel' ? (
        <Text style={t.small} testID="venda-credito-indisponivel">
          {tabela.apoio}
        </Text>
      ) : (
        <View style={{ gap: 8 }} testID="venda-credito-bloco">
          <RotuloSecao texto={ROTULO_CREDITO} />
          <TabelaValores
            testID="venda-credito"
            linhas={tabela.linhas.map((l) => ({ id: l.id, rotulo: l.rotulo, valor: l.valor }))}
            carregando={tabela.estado === 'carregando'}
            rodape={tabela.estado === 'tabela' ? { icone: semSinal ? 'wifiOff' : 'sync', texto: textoAtualizacao(sincronizadoEm, agora, tz) } : null}
          />
          {tabela.apoio && tabela.estado === 'tabela' ? (
            <Text style={t.small} testID="venda-sem-credito">
              {tabela.apoio}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** Frete CIF/FOB e transportadora (RN-VEN-16), na aba Entrega: sem frase explicativa (T-0141 B) e sem valor de frete. */
export function CartaoFrete({
  rascunho: r,
  fretePadrao,
  transportadoras,
  onRascunho,
}: {
  rascunho: Rascunho;
  fretePadrao: 'CIF' | 'FOB';
  transportadoras: readonly TransportadoraDaTela[];
  onRascunho: OnRascunho;
}) {
  const frete: FreteDoRascunho = r.frete ?? { modalidade: fretePadrao };
  const ativas = transportadorasAtivas(transportadoras);
  const digitando = frete.modalidade === 'FOB' && !frete.transportadora_id && frete.transportadora_digitada != null;
  const setFrete = (f: FreteDoRascunho) => onRascunho((d) => ({ ...d, frete: f }));
  return (
    <View style={{ gap: 8 }} testID="card-frete">
      <RotuloSecao texto="Frete" />
      <Segmentado
        testID="frete"
        rotuloAcessivel="Frete"
        valor={frete.modalidade}
        opcoes={[
          { id: 'CIF', rotulo: 'CIF' },
          { id: 'FOB', rotulo: 'FOB' },
        ]}
        onChange={(m) => setFrete(m === 'CIF' ? { modalidade: 'CIF' } : { modalidade: 'FOB', transportadora_id: frete.transportadora_id ?? null, transportadora_digitada: frete.transportadora_digitada ?? null })}
      />
      {frete.modalidade === 'FOB' ? (
        <View style={{ gap: 8 }} testID="frete-transportadora">
          <Text style={s.rotuloLinha}>Transportadora</Text>
          <View style={s.chips}>
            {ativas.map((tr) => (
              <Chip key={tr.id} testID={`transp-${tr.nome}`} label={tr.nome} active={frete.transportadora_id === tr.id} onPress={() => setFrete({ modalidade: 'FOB', transportadora_id: tr.id, transportadora_digitada: null })} />
            ))}
            <Chip
              testID="transp-outra"
              label="Outra"
              active={digitando}
              onPress={() => setFrete({ modalidade: 'FOB', transportadora_id: null, transportadora_digitada: frete.transportadora_digitada ?? { nome: '', cnpj: '', telefone: '' } })}
            />
          </View>
          {digitando && frete.transportadora_digitada ? (
            <View style={{ gap: 8 }} testID="transp-digitada">
              <CampoTexto rotulo="Nome" valor={frete.transportadora_digitada.nome} testID="transp-nome" onChange={(v) => setFrete({ ...frete, transportadora_digitada: { ...frete.transportadora_digitada!, nome: v } })} />
              <CampoTexto rotulo="CNPJ" valor={frete.transportadora_digitada.cnpj} testID="transp-cnpj" teclado="number-pad" onChange={(v) => setFrete({ ...frete, transportadora_digitada: { ...frete.transportadora_digitada!, cnpj: v.replace(/\D/g, '').slice(0, 14) } })} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function CampoTexto({ rotulo, valor, onChange, testID, teclado }: { rotulo: string; valor: string; onChange: (v: string) => void; testID: string; teclado?: 'number-pad' | 'phone-pad' }) {
  return <TextInput testID={testID} value={valor} onChangeText={onChange} keyboardType={teclado} placeholder={rotulo} placeholderTextColor={colors.ink3} accessibilityLabel={rotulo} style={s.texto} autoCorrect={false} />;
}

// ---------- aba 3 · Entrega ----------
export function AbaEntrega({
  rascunho: r,
  clienteId,
  enderecos,
  motivoCadastro,
  onRascunho,
  fretePadrao,
  transportadoras,
}: {
  rascunho: Rascunho;
  clienteId: string;
  enderecos: readonly EnderecoDaTela[];
  /** RN-CORE-17: linha automática só de leitura (não é copiada para a observação do pedido) */
  motivoCadastro: string | null;
  onRascunho: OnRascunho;
  fretePadrao: 'CIF' | 'FOB';
  transportadoras: readonly TransportadoraDaTela[];
}) {
  const [folha, setFolha] = useState<'nenhuma' | 'lista' | 'formulario'>('nenhuma');
  const lista = enderecosDoCliente(enderecos, clienteId);
  const principal = lista.find((e) => e.principal || e.tipo === 'principal') ?? null;
  return (
    <View style={{ gap: 12 }} testID="aba-entrega-conteudo">
      <CartaoEndereco rascunho={r} lista={lista} onAcao={(abre) => setFolha(abre === 'folha' ? 'lista' : 'formulario')} />
      <CartaoFrete rascunho={r} fretePadrao={fretePadrao} transportadoras={transportadoras} onRascunho={onRascunho} />
      <View style={{ gap: 8 }} testID="card-observacoes">
        <RotuloSecao texto="Observações" />
        {motivoCadastro ? (
          <Text style={t.small} testID="observacao-cadastro">
            {motivoCadastro}
          </Text>
        ) : null}
        <TextInput
          testID="observacao"
          value={r.observacao ?? ''}
          onChangeText={(v) => onRascunho((d) => ({ ...d, observacao: v.slice(0, 500) }))}
          multiline
          placeholder="Observação para a entrega ou o pedido"
          placeholderTextColor={colors.ink3}
          accessibilityLabel="Observações"
          style={[s.texto, { minHeight: 72, textAlignVertical: 'top', paddingTop: 10 }]}
        />
      </View>
      <FolhaEnderecos
        visivel={folha === 'lista'}
        rascunho={r}
        lista={lista}
        onEscolher={(e) => {
          onRascunho((d) => rascunhoComEnderecoEscolhido(d, e, principal?.id ?? null));
          setFolha('nenhuma');
        }}
        onEditar={() => setFolha('formulario')}
        onFechar={() => setFolha('nenhuma')}
      />
      <FormularioEndereco
        visivel={folha === 'formulario'}
        base={enderecoDoRascunho(r, lista)}
        onUsar={(v) => {
          onRascunho((d) => rascunhoComEnderecoEditado(d, v, lista));
          setFolha('nenhuma');
        }}
        onFechar={() => setFolha('nenhuma')}
      />
    </View>
  );
}

/** "Leve mais e pague menos" (RN-VEN-23) e "Combina com o pedido" (RF-CAT-03): vieram do antigo Detalhes para o fim da aba Itens. */
export function FimDaAbaItens({
  sugestoes,
  nomeDoProduto,
  onAdicionar,
  onTrocar,
  leveMais,
}: {
  /** do aparelho (offline) */
  sugestoes: SugestoesDaTela;
  nomeDoProduto: (produtoId: string) => string;
  onAdicionar: (produtoId: string) => void;
  onTrocar: (s: Extract<SugestaoDaTela, { origem: 'embalagem_maior' }>) => void;
  /** linhas do cartão; vazio = o cartão some */
  leveMais: ReadonlyArray<ItemLeveMais>;
}) {
  return (
    <View style={{ gap: 12 }} testID="itens-fim">
      <CartaoLeveMais titulo={TITULO_LEVE_MAIS_PAGUE_MENOS} itens={leveMais} />
      <BlocoSugestoes titulo={TITULO_COMBINA} testID="sugestoes-combina" itens={sugestoes.combina} nomeDoProduto={nomeDoProduto} onAdicionar={onAdicionar} onTrocar={onTrocar} />
    </View>
  );
}

/** Linhas do cartão "Leve mais e pague menos" no formato do kit (textos de `textosLeveMais`). */
export function linhasDoLeveMais(
  itens: ReadonlyArray<{ chave: string; produto: string; quantidadeMinima: number; medida: string; precoMedidaCents: number; precoHojeCents: number; faltam: number }>,
  aoAjustar: (chave: string, quantidade: number, texto: string) => void,
): ItemLeveMais[] {
  return itens.map((i) => {
    const tx = textosLeveMais({ produto: i.produto, quantidadeMinima: i.quantidadeMinima, medida: i.medida, precoMedidaCents: i.precoMedidaCents, precoHojeCents: i.precoHojeCents, faltam: i.faltam });
    return { id: i.chave, titulo: tx.titulo, apoio: tx.apoio, leitura: tx.leitura, rotuloAjustar: tx.rotuloAjustar, onAjustar: () => aoAjustar(i.chave, i.quantidadeMinima, `${i.produto}: ${i.quantidadeMinima} ${i.medida}`) };
  });
}

/** Até 5 sugestões com 1 toque: "+" adiciona 1 unidade; "⇄" troca pela embalagem maior (selo "−5%"). Alvo de toque de 48 dp. */
function BlocoSugestoes({
  titulo,
  testID,
  itens,
  nomeDoProduto,
  onAdicionar,
  onTrocar,
}: {
  titulo: string;
  testID: string;
  itens: readonly SugestaoDaTela[];
  nomeDoProduto: (produtoId: string) => string;
  onAdicionar: (produtoId: string) => void;
  onTrocar: (s: Extract<SugestaoDaTela, { origem: 'embalagem_maior' }>) => void;
}) {
  if (itens.length === 0) return null;
  return (
    <Cartao gap={4} testID={testID}>
      <RotuloSecao texto={titulo} />
      {itens.map((sg) => {
        const troca = sg.origem === 'embalagem_maior';
        const nome = nomeDaSugestao(nomeDoProduto(sg.produto_id), sg);
        const selo = seloDaSugestao(sg);
        return (
          <Pressable
            key={`${sg.origem}-${sg.produto_id}`}
            testID={`${troca ? 'sug-troca' : 'sug-add'}-${sg.produto_id}`}
            accessibilityRole="button"
            accessibilityLabel={troca ? `Trocar por ${nome}` : `Adicionar ${nome}`}
            onPress={() => (sg.origem === 'embalagem_maior' ? onTrocar(sg) : onAdicionar(sg.produto_id))}
            style={({ pressed }) => [s.sugestao, pressed && s.sugestaoPressionada]}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={t.bodyStrong} numberOfLines={2}>
                {nome}
              </Text>
              {selo.tipo === 'selo' ? <Selo texto={selo.texto} tom="sucesso" rotuloAcessivel={`${selo.texto.replace('−', '')} mais barato`} /> : <Text style={t.small}>{selo.texto}</Text>}
            </View>
            <View style={s.sugestaoBotao}>
              <Icon name={troca ? 'swap' : 'plus'} size={20} color={colors.accentInk} strokeWidth={2.2} />
            </View>
          </Pressable>
        );
      })}
    </Cartao>
  );
}

// ---------- aba 4 · Resumo ----------
/**
 * Resumo completo (RF-VEN-11, T-0137; docs/design/pedido-v2.md §2): só leitura (cliente, venda, itens, entrega, observações), o
 * desconto do pedido numa linha (o mesmo `DescontoCompacto` do item), totais, "Falta para salvar" e os botões. Os botões e
 * os estados vêm do domain (`botoesDoResumo`); aqui só desenha. Sem folha intermediária: cada botão faz o que diz em 1 toque.
 */
export function AbaResumo({
  rascunho: r,
  clienteRazao,
  clienteCnpj,
  calculo,
  nomes,
  codigos,
  prazo,
  endereco,
  transportadora,
  fretePadrao,
  onRascunho,
  botoes,
  onEnviar,
  onApenasSalvar,
  onOrcamento,
  onSalvarOrcamento,
  onTransformar,
  onCancelar,
  salvando,
  somenteLeitura,
}: {
  rascunho: Rascunho;
  /** razão social e CNPJ: o nome fantasia e o código já estão no cabeçalho da tela */
  clienteRazao: string;
  clienteCnpj: string;
  calculo: CalculoPedido;
  nomes: ReadonlyMap<string, string>;
  codigos: ReadonlyMap<string, string>;
  prazo: string;
  endereco: string | null;
  /** nome da transportadora escolhida ou digitada (só vale no FOB) */
  transportadora: string | null;
  fretePadrao: 'CIF' | 'FOB';
  onRascunho: OnRascunho;
  botoes: BotoesDoResumo;
  onEnviar: () => void;
  onApenasSalvar: () => void;
  onOrcamento: () => void;
  onSalvarOrcamento: () => void;
  onTransformar: () => void;
  onCancelar: () => void;
  salvando: boolean;
  somenteLeitura: boolean;
}) {
  const frete = r.frete ?? { modalidade: fretePadrao };
  const linhaSomenteLeitura = linhaDoAjusteSomenteLeitura(calculo.ajuste_pedido);
  const pagamentoEPrazo = dividirPagamentoPrazo(prazo);
  const semDado = '—';
  // RN-VEN-42: os alertas ficam na área do topo da tela (todas as abas); o Resumo só lê e mostra, em tabela
  return (
    <View style={{ gap: 12 }} testID="aba-resumo-conteudo">
      <View style={{ gap: 6 }} testID="resumo-pedido">
        <RotuloSecao texto="Cliente" />
        <TabelaRotuloValor testID="resumo-cliente" linhas={[{ rotulo: 'Razão social', valor: clienteRazao }, { rotulo: 'CNPJ', valor: clienteCnpj || semDado }]} />
      </View>
      <View style={{ gap: 6 }}>
        <RotuloSecao texto="Venda" />
        <TabelaRotuloValor testID="resumo-venda" linhas={[{ rotulo: 'Pagamento', valor: pagamentoEPrazo.pagamento }, { rotulo: 'Prazo', valor: pagamentoEPrazo.prazo }]} />
      </View>
      <View style={{ gap: 6 }} testID="resumo-itens">
        <RotuloSecao texto="Itens" />
        {calculo.linhas.length > 0 ? <TabelaDeItens itens={itensDoResumoEmTabela(calculo.linhas, (id) => nomes.get(id) ?? '', (id) => codigos.get(id) ?? '')} /> : <Text style={t.sub}>{semDado}</Text>}
      </View>
      <View style={{ gap: 6 }}>
        <RotuloSecao texto="Entrega" />
        <TabelaRotuloValor testID="resumo-entrega" linhas={[{ rotulo: 'Frete', valor: textoDoFrete(frete.modalidade, transportadora) }, { rotulo: 'Endereço', valor: [endereco ?? TEXTO_ENDERECO_DO_CADASTRO, r.endereco_entrega_editado ? `(${TEXTOS_ENDERECO.editadoNestePedido})` : ''].filter(Boolean).join(' ') }]} />
      </View>
      <View style={{ gap: 6 }}>
        <RotuloSecao texto="Observações" />
        <TabelaRotuloValor testID="resumo-obs" linhas={[{ rotulo: 'Observação', valor: linhaDaObsNoResumo(r.observacao) }]} />
      </View>
      {somenteLeitura ? (
        linhaSomenteLeitura ? (
          <Card style={s.card} testID="resumo-ajuste-leitura">
            <LinhaValor rotulo={linhaSomenteLeitura.rotulo} valor={linhaSomenteLeitura.valor} />
          </Card>
        ) : null
      ) : (
        <Card style={s.card}>
          <DescontoDoPedido rascunho={r} calculo={calculo} onRascunho={onRascunho} />
        </Card>
      )}
      <View style={{ gap: 6 }}>
        <RotuloSecao texto="Totais" />
        <CartaoDeTotais tabela={formatReais(calculo.total_tabela_cents)} liquida={linhaLiquidaDosTotais({ subtotal_cents: calculo.total_tabela_cents, total_cents: calculo.total_cents })} total={formatReais(calculo.total_cents)} testIDTotal="totais-pedido-total" />
      </View>
      {somenteLeitura ? null : (
        <BotoesDoResumoView botoes={botoes} salvando={salvando} onEnviar={onEnviar} onApenasSalvar={onApenasSalvar} onOrcamento={onOrcamento} onSalvarOrcamento={onSalvarOrcamento} onTransformar={onTransformar} onCancelar={onCancelar} />
      )}
    </View>
  );
}

/**
 * Desconto do pedido numa linha (RN-VEN-02): o `DescontoCompacto` do kit, o mesmo do item. Tipo (Desc %, Desc R$, Acrésc %, Acrésc R$)
 * e valor digitável; cada número válido vale na hora; o equivalente (% ↔ R$) fica ao lado. A alçada não aparece aqui: só a pergunta ao salvar (RN-VEN-10, T-0151).
 */
export function DescontoDoPedido({ rascunho: r, calculo, onRascunho }: { rascunho: Rascunho; calculo: CalculoPedido; onRascunho: OnRascunho }) {
  const atual = ajusteDoPedidoDoRascunho(r);
  const [escolhido, setEscolhido] = useState<TipoDoAjuste>(atual.tipo);
  // com valor, o tipo é o do rascunho; sem valor, o que a pessoa escolheu
  const tipo = atual.valor > 0 ? atual.tipo : escolhido;
  const [texto, setTexto] = useState(textoDoAjuste(tipo, atual.valor));
  // mudança de fora (trocar o tipo, desfazer): o texto acompanha; o que foi digitado e já vale não é reescrito
  useEffect(() => {
    setTexto((digitado) => (valorDoTexto(tipo, digitado) === atual.valor ? digitado : textoDoAjuste(tipo, atual.valor)));
  }, [atual.valor, tipo]);
  const eq = calculo.ajuste_pedido;
  const equivalente = eq ? { cents: eq.cents, pct: eq.pct_exibicao } : null;
  return (
    <DescontoCompacto
      testID="desconto-pedido"
      rotulo={rotuloDoAjusteDoPedido(tipo.startsWith('acresc') ? 'acrescimo' : 'desconto')}
      tipo={tipo}
      onChangeTipo={(novo) => {
        setEscolhido(novo);
        if (atual.valor > 0) onRascunho((d) => rascunhoComTipoDoPedido(d, novo, equivalente));
        else setTexto('');
      }}
      texto={texto}
      onChangeTexto={(digitado) => {
        const limpo = sanearDecimal(digitado, 2);
        setTexto(limpo);
        onRascunho((d) => rascunhoComTextoDoPedido(d, tipo, limpo, calculo.total_itens_cents));
      }}
      onConfirmar={() => setTexto(textoDoAjuste(tipo, ajusteDoPedidoDoRascunho(r).valor))}
      equivalente={equivalente}
      placeholder="0"
      rotuloAcessivel="Valor do desconto do pedido"
      rotuloTipo="Tipo do ajuste do pedido"
      rotuloFechar="Fechar a lista"
    />
  );
}

interface BotaoNaTela {
  chave: string;
  botao: BotaoDoResumo;
  onPress: () => void;
  testID: string;
}

/** Os botões do Resumo, na hierarquia da spec (§2.2): um principal de largura total, os secundários e o Cancelar em texto. */
function BotoesDoResumoView({
  botoes: b,
  salvando,
  onEnviar,
  onApenasSalvar,
  onOrcamento,
  onSalvarOrcamento,
  onTransformar,
  onCancelar,
}: {
  botoes: BotoesDoResumo;
  salvando: boolean;
  onEnviar: () => void;
  onApenasSalvar: () => void;
  onOrcamento: () => void;
  onSalvarOrcamento: () => void;
  onTransformar: () => void;
  onCancelar: () => void;
}) {
  const principal: BotaoNaTela =
    b.principal === 'enviar'
      ? { chave: 'enviar', botao: b.enviar, onPress: onEnviar, testID: 'send-order' }
      : b.principal === 'orcamento'
        ? { chave: 'orcamento', botao: b.orcamento, onPress: onOrcamento, testID: 'salvar-orcamento' }
        : { chave: 'salvar_orcamento', botao: b.salvarOrcamento, onPress: onSalvarOrcamento, testID: 'send-order' };
  const secundarios = [
    b.apenasSalvar.visivel ? { chave: 'apenas', botao: b.apenasSalvar, onPress: onApenasSalvar, testID: 'apenas-salvar' } : null,
    b.principal !== 'orcamento' && b.orcamento.visivel ? { chave: 'orcamento', botao: b.orcamento, onPress: onOrcamento, testID: 'salvar-orcamento' } : null,
    b.transformar.visivel ? { chave: 'transformar', botao: b.transformar, onPress: onTransformar, testID: 'transformar-em-pedido' } : null,
  ].filter((x): x is BotaoNaTela => x !== null);
  // dois secundários dividem a linha (metade cada); um só ocupa a largura toda
  const linhaDupla = secundarios.length === 2;
  return (
    <View style={s.botoesResumo} testID="botoes-resumo">
      <Botao
        testID={principal.testID}
        nivel="principal"
        rotulo={principal.botao.rotulo}
        rotuloAcessivel={principal.botao.habilitado ? principal.botao.rotulo : leituraDoSalvar(principal.botao.rotulo, b.pendencias)}
        desligado={!principal.botao.habilitado}
        ocupado={salvando}
        onPress={principal.onPress}
      />
      <View style={linhaDupla ? s.linhaDupla : s.colunaSecundarios}>
        {secundarios.map((x) => (
          <Botao
            key={x.chave}
            testID={x.testID}
            nivel="secundario"
            alto
            quebrarLinha
            rotulo={x.botao.rotulo}
            rotuloAcessivel={x.botao.habilitado ? x.botao.rotulo : leituraDoSalvar(x.botao.rotulo, b.pendencias)}
            desligado={!x.botao.habilitado}
            style={linhaDupla ? { flex: 1 } : undefined}
            onPress={x.onPress}
          />
        ))}
      </View>
      <Pressable testID="cancelar-pedido" accessibilityRole="button" accessibilityLabel="Cancelar" onPress={onCancelar} style={({ pressed }) => [s.cancelar, pressed && { opacity: 0.6 }]}>
        <Text style={s.cancelarTexto}>Cancelar</Text>
      </Pressable>
    </View>
  );
}

function formatReais(cents: number): string {
  return linhasDeTotais({ total_tabela_cents: cents, desconto_cents: 0, acrescimo_cents: 0, total_cents: cents }).total.valor;
}

const s = StyleSheet.create({
  card: { padding: 12, gap: 10 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linhaPagamento: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  totalDoPedido: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 10 },
  totalRotulo: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink2 },
  totalValor: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  rotuloLinha: { width: 64, fontFamily: fonts.bold, fontSize: 12, color: colors.ink2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  botoesResumo: { gap: 10 },
  linhaDupla: { flexDirection: 'row', gap: 8 },
  colunaSecundarios: { gap: 8 },
  cancelar: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  cancelarTexto: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  sugestao: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 6 },
  sugestaoPressionada: { backgroundColor: colors.ground },
  sugestaoBotao: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  texto: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
});
