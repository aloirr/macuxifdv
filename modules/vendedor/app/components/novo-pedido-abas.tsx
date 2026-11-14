/**
 * Novo pedido em 4 abas — Venda · Itens (n) · Entrega · Resumo (RF-VEN-11, T-0136; spec docs/design/pedido-v2.md) sobre os componentes do
 * `packages/ui`. Venda: dados do cliente, forma, prazo e crédito. Itens: Desc./Acrésc. geral, busca e itens (na tela). Entrega: frete, transportadora, endereço e observação da entrega. Resumo: tudo em tabela, a Observação do pedido e os Totais (T-0165).
 * Textos só os da referência enxuta, vindos de `lib/textos-pedido` (com teste). Só lê e escreve o rascunho do aparelho
 * (offline-first); o cálculo vem de `lib/novo-pedido`. Alvos de toque ≥ 48 dp (o ui já garante).
 */
import { formatBRL } from '@macuxi/comum';
import {
  Botao,
  Cartao,
  CartaoLeveMais,
  colors,
  fonts,
  VALOR_SEM_DADO,
  Icon,
  ListaSuspensa,
  RotuloSecao,
  Segmentado,
  Selo,
  TabelaValores,
  textoAtualizacao,
  textosLeveMais,
  type as t,
  type ItemLeveMais,
} from '@macuxi/ui/mobile';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { type BotaoDoResumo, type BotoesDoResumo } from '../../domain/botoes-resumo';
import type { FormaDePagamento, PrazoDePagamento } from '../../domain/pagamento';
import type { ModeloDoCredito } from '../lib/credito-cliente';
import { comForma, comPrazo, opcoesDeForma, opcoesDePrazo, TEXTO_ESCOLHA_A_FORMA, type LimitesDoCliente } from '../lib/pagamento-pedido';
import { enderecosDoCliente, lerChaveDaLinha, type CalculoPedido, type EnderecoDaTela, type FreteDoRascunho, type TransportadoraDaTela } from '../lib/novo-pedido';
import type { Rascunho } from '../lib/pedidos';
import type { SugestaoDaTela, SugestoesDaTela } from '../lib/sugestoes-pedido';
import { nomeDaSugestao, seloDaSugestao, TITULO_COMBINA } from '../lib/textos-pedido';
import { ROTULO_CREDITO, tabelaDoCredito, TEXTO_ENDERECO_DO_CADASTRO } from '../lib/textos-venda';
import { dividirPagamentoPrazo, itensDoResumoEmTabela, textoDoFrete } from '../lib/resumo-tabela';
import { linhasDosTotais } from '../lib/detalhe-pedido';
import { CampoTransportadora } from './campo-transportadora';
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
  faltaForma,
  faltaPrazo,
}: {
  rascunho: Rascunho;
  formas: readonly FormaDePagamento[];
  prazos: readonly PrazoDePagamento[];
  cliente: LimitesDoCliente;
  /** condições de antes (APK anterior / tenant sem formas) */
  legado: Array<{ id: string | null; rotulo: string }>;
  onRascunho: OnRascunho;
  /** RD-0170/RD-0189: "Obrigatório" no campo Forma, depois da tentativa (a aba Venda aberta não repete em Alertas) */
  faltaForma?: string | null;
  faltaPrazo?: string | null;
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
      ) : opcoesForma.every((o) => o.desabilitada) ? (
        <ListaSuspensa testID="forma" rotulo="Forma de pagamento" opcoes={opcoesForma} valor={null} desligado placeholder={VALOR_SEM_DADO} rotuloFechar="Fechar a lista" onChange={() => undefined} />
      ) : (
        <View style={s.linhaPagamento}>
          <ListaSuspensa
            testID="forma"
            style={{ flex: 1 }}
            rotulo="Forma de pagamento"
            opcoes={opcoesForma}
            valor={r.forma_pagamento_id ?? null}
            falta={faltaForma ?? null}
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
            falta={faltaPrazo ?? null}
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

/**
 * Aba Venda (RF-VEN-11): forma e prazo (RN-VEN-24/25), limite (os alertas de cliente, crédito e título vão para a área Alertas do topo, RN-VEN-42)
 * total e disponível e prazo médio do cliente, com a data da última sincronização. `credito`: `undefined` = lendo; `null` =
 * consulta indisponível (as linhas de crédito não aparecem). Tudo do aparelho (vale offline).
 */
export function AbaVenda({
  clienteLinhas,
  pagamento,
  credito,
  prazoMedioDias,
  sincronizadoEm,
  agora,
  tz,
  semSinal,
}: {
  /** T-0165: Endereço, Filial e CNPJ do cadastro; a linha sem dado não aparece (a Filial só vem quando o aparelho a conhece) */
  clienteLinhas: ReadonlyArray<{ rotulo: string; valor: string }>;
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
      {clienteLinhas.length > 0 ? (
        <View style={{ gap: 8 }} testID="venda-cliente">
          <RotuloSecao texto="Cliente" />
          <TabelaRotuloValor testID="venda-cliente-tabela" linhas={clienteLinhas} />
        </View>
      ) : null}
      {pagamento}
      <View style={{ gap: 8 }} testID="venda-credito-bloco">
        <RotuloSecao texto={ROTULO_CREDITO} />
        <TabelaValores
          testID="venda-credito"
          linhas={tabela.linhas.map((l) => ({ id: l.id, rotulo: l.rotulo, valor: l.valor }))}
          carregando={tabela.estado === 'carregando'}
          rodape={tabela.estado === 'tabela' ? { icone: semSinal ? 'wifiOff' : 'sync', texto: textoAtualizacao(sincronizadoEm, agora, tz) } : null}
        />
      </View>
    </View>
  );
}

/** Frete CIF/FOB (RN-VEN-16), na aba Entrega: primeiro de tudo; no FOB, a Transportadora em lista (T-0165) e, em "Outra", Nome e CNPJ. */
export function CartaoFrete({
  rascunho: r,
  fretePadrao,
  transportadoras,
  faltaTransportadora,
  onRascunho,
}: {
  rascunho: Rascunho;
  fretePadrao: 'CIF' | 'FOB';
  transportadoras: readonly TransportadoraDaTela[];
  /** RD-0170: "Obrigatório" no campo da transportadora, só depois da tentativa de avançar ou enviar */
  faltaTransportadora?: string | null;
  onRascunho: OnRascunho;
}) {
  const frete: FreteDoRascunho = r.frete ?? { modalidade: fretePadrao };
  const digitando = frete.modalidade === 'FOB' && !frete.transportadora_id && frete.transportadora_digitada != null;
  const setFrete = (f: FreteDoRascunho) => onRascunho((d) => ({ ...d, frete: f }));
  return (
    <View style={{ gap: 12 }} testID="card-frete">
      <View style={{ gap: 8 }}>
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
      </View>
      {frete.modalidade === 'FOB' ? (
        <View style={{ gap: 8 }} testID="frete-transportadora">
          <CampoTransportadora
            frete={frete}
            transportadoras={transportadoras}
            aoEscolher={(tr) => setFrete({ modalidade: 'FOB', transportadora_id: tr.id, transportadora_digitada: null })}
            falta={faltaTransportadora}
            aoEscolherOutra={() => setFrete({ modalidade: 'FOB', transportadora_id: null, transportadora_digitada: frete.transportadora_digitada ?? { nome: '', cnpj: '', telefone: '' } })}
          />
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
  onRascunho,
  fretePadrao,
  transportadoras,
  faltaTransportadora,
}: {
  rascunho: Rascunho;
  clienteId: string;
  enderecos: readonly EnderecoDaTela[];
  onRascunho: OnRascunho;
  fretePadrao: 'CIF' | 'FOB';
  transportadoras: readonly TransportadoraDaTela[];
  faltaTransportadora?: string | null;
}) {
  const [folha, setFolha] = useState<'nenhuma' | 'lista' | 'formulario'>('nenhuma');
  const lista = enderecosDoCliente(enderecos, clienteId);
  const principal = lista.find((e) => e.principal || e.tipo === 'principal') ?? null;
  return (
    <View style={{ gap: 12 }} testID="aba-entrega-conteudo">
      <CartaoFrete rascunho={r} fretePadrao={fretePadrao} transportadoras={transportadoras} faltaTransportadora={faltaTransportadora} onRascunho={onRascunho} />
      <CartaoEndereco rascunho={r} lista={lista} onAcao={(abre) => setFolha(abre === 'folha' ? 'lista' : 'formulario')} />
      <View style={{ gap: 8 }} testID="card-observacoes">
        <RotuloSecao texto="Observação" />
        <TextInput
          testID="observacao-entrega"
          value={r.observacao_entrega ?? ''}
          onChangeText={(v) => onRascunho((d) => ({ ...d, observacao_entrega: v.slice(0, 500) }))}
          multiline
          accessibilityLabel="Observação da entrega"
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
 * Resumo completo (RF-VEN-11, T-0137, T-0165; docs/design/pedido-v4.md §5.4): Cliente, Condição de pagamento, Itens (só o código, com balão), Entrega,
 * a Observação do pedido (editável), os Totais e os botões. Não há desconto do pedido: o ajuste fica no item. Os botões e
 * os estados vêm do domain (`botoesDoResumo`); aqui só desenha. Sem folha intermediária: cada botão faz o que diz em 1 toque.
 */
export function AbaResumo({
  rascunho: r,
  clienteRazao,
  clienteCnpj,
  calculo,
  nomes,
  codigos,
  marcas,
  prazo,
  endereco,
  transportadora,
  fretePadrao,
  onRascunho,
  aoAbrirItem,
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
  /** marca do produto: o balão do código diz "nome - marca" */
  marcas: ReadonlyMap<string, string>;
  prazo: string;
  endereco: string | null;
  /** nome da transportadora escolhida ou digitada (só vale no FOB) */
  transportadora: string | null;
  fretePadrao: 'CIF' | 'FOB';
  onRascunho: OnRascunho;
  /** tocar na linha do item (fora do código) abre a folha do item */
  aoAbrirItem: (produtoId: string) => void;
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
  const pagamentoEPrazo = dividirPagamentoPrazo(prazo);
  const semDado = '—';
  const obsEntrega = (r.observacao_entrega ?? '').trim();
  const linhasEntrega = [
    { rotulo: 'Frete', valor: textoDoFrete(frete.modalidade, transportadora) },
    { rotulo: 'Endereço', valor: [endereco ?? TEXTO_ENDERECO_DO_CADASTRO, r.endereco_entrega_editado ? `(${TEXTOS_ENDERECO.editadoNestePedido})` : ''].filter(Boolean).join(' ') },
    ...(obsEntrega ? [{ rotulo: 'Observação', valor: obsEntrega }] : []),
  ];
  // RN-VEN-42: os alertas ficam na área do topo da tela (todas as abas); o Resumo só lê e mostra, em tabela
  return (
    <View style={{ gap: 12 }} testID="aba-resumo-conteudo">
      <View style={{ gap: 6 }} testID="resumo-pedido">
        <RotuloSecao texto="Cliente" />
        <TabelaRotuloValor testID="resumo-cliente" linhas={[{ rotulo: 'Razão social', valor: clienteRazao }, { rotulo: 'CNPJ', valor: clienteCnpj || semDado }]} />
      </View>
      <View style={{ gap: 6 }}>
        <RotuloSecao texto="Condição de pagamento" />
        <TabelaRotuloValor testID="resumo-venda" linhas={[{ rotulo: 'Forma', valor: pagamentoEPrazo.pagamento }, { rotulo: 'Prazo', valor: pagamentoEPrazo.prazo }]} />
      </View>
      <View style={{ gap: 6 }} testID="resumo-itens">
        <RotuloSecao texto="Itens" />
        {calculo.linhas.length > 0 ? (
          <TabelaDeItens itens={itensDoResumoEmTabela(calculo.linhas, (id) => nomes.get(id) ?? '', (id) => codigos.get(id) ?? '', (id) => marcas.get(id))} aoTocarLinha={somenteLeitura ? undefined : (chave) => aoAbrirItem(lerChaveDaLinha(chave).product_id)} />
        ) : (
          <Text style={t.sub}>{semDado}</Text>
        )}
      </View>
      <View style={{ gap: 6 }}>
        <RotuloSecao texto="Entrega" />
        <TabelaRotuloValor testID="resumo-entrega" linhas={linhasEntrega} />
      </View>
      <View style={{ gap: 6 }} testID="resumo-obs">
        <RotuloSecao texto="Observação do pedido" />
        <TextInput
          testID="observacao"
          value={r.observacao ?? ''}
          onChangeText={(v) => onRascunho((d) => ({ ...d, observacao: v.slice(0, 500) }))}
          editable={!somenteLeitura}
          multiline
          accessibilityLabel="Observação do pedido"
          style={[s.texto, { minHeight: 64, textAlignVertical: 'top', paddingTop: 10 }]}
        />
      </View>
      <View style={{ gap: 6 }}>
        <RotuloSecao texto="Totais" />
        <CartaoDeTotais linhas={linhasDosTotais({ subtotal_cents: calculo.total_tabela_cents, total_cents: calculo.total_cents }, { fixas: true })} total={formatBRL(calculo.total_cents)} testIDTotal="totais-pedido-total" />
      </View>
      {somenteLeitura ? null : (
        <BotoesDoResumoView botoes={botoes} salvando={salvando} onEnviar={onEnviar} onApenasSalvar={onApenasSalvar} onOrcamento={onOrcamento} onSalvarOrcamento={onSalvarOrcamento} onTransformar={onTransformar} onCancelar={onCancelar} />
      )}
    </View>
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
        rotuloAcessivel={principal.botao.rotulo}
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
            rotuloAcessivel={x.botao.rotulo}
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

const s = StyleSheet.create({
  linhaPagamento: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
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
