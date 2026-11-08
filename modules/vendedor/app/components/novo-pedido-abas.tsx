/**
 * Novo pedido em 4 abas — Venda · Itens (n) · Entrega · Resumo (RF-VEN-11, T-0136; spec docs/design/pedido-v2.md) sobre os componentes do
 * `packages/ui`. Venda: alertas, forma, prazo e crédito. Itens: busca e itens (na tela). Entrega: endereço, frete e observações.
 * Textos só os da referência enxuta, vindos de `lib/textos-pedido` (com teste). Só lê e escreve o rascunho do aparelho
 * (offline-first); o cálculo vem de `lib/novo-pedido`. Alvos de toque ≥ 48 dp (o ui já garante).
 */
import { formatBRL } from '@macuxi/comum';
import {
  BlocoTotais,
  Button,
  Card,
  Cartao,
  CartaoLeveMais,
  Chip,
  colors,
  Dialogo,
  Faixa,
  Folha,
  fonts,
  leituraDoSalvar,
  Icon,
  LinhaValor,
  ListaSuspensa,
  OpcaoFolha,
  RotuloSecao,
  Segmentado,
  Selo,
  textoAtualizacao,
  textosLeveMais,
  type as t,
  type ItemLeveMais,
} from '@macuxi/ui/mobile';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { opcoesDoSalvar } from '../../domain/orcamento';
import type { FormaDePagamento, PrazoDePagamento } from '../../domain/pagamento';
import type { AlertaDaVenda } from '../../domain/alertas-venda';
import type { ModeloDoCredito } from '../lib/credito-cliente';
import { comForma, comPrazo, opcoesDeForma, opcoesDePrazo, rotuloTotalDoPedido, TEXTO_ESCOLHA_A_FORMA, TEXTO_SEM_FORMAS, type LimitesDoCliente } from '../lib/pagamento-pedido';
import { enderecosDoCliente, freteValido, textoDoEndereco, transportadorasAtivas, trocarModoDoAjuste, type CalculoPedido, type EnderecoDaTela, type FreteDoRascunho, type TransportadoraDaTela } from '../lib/novo-pedido';
import { aplicarAjusteDoPedido, type Rascunho } from '../lib/pedidos';
import type { SugestaoDaTela, SugestoesDaTela } from '../lib/sugestoes-pedido';
import { linhaDoAjusteSomenteLeitura, nomeDaSugestao, seloDaSugestao, TEXTO_SEM_ITEM_NO_RESUMO, TITULO_COMBINA, itemCompacto, linhaDeEntrega, linhasDeTotais, rotuloDoAjusteDoPedido, textoDaFaixa, textoEquivalente, tituloDaFolhaSalvar } from '../lib/textos-pedido';
import { fraseDoFrete, linhaDoLimite, ROTULO_ALERTAS, ROTULO_ENDERECO_ENTREGA, ROTULO_LIMITE, ROTULO_PRAZO_MEDIO, TEXTO_ENDERECO_DO_CADASTRO, TEXTO_SEM_ALERTA, TEXTO_SEM_DADOS_DE_CREDITO, textoDoAlerta, textoDoPrazoMedio } from '../lib/textos-venda';
import { CampoPct, CampoReais } from './novo-pedido';

type OpcoesDoSalvar = ReturnType<typeof opcoesDoSalvar>;
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
    <Cartao gap={10} testID="card-pagamento">
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
    </Cartao>
  );
}

/** Total do pedido no topo da aba Itens ("Total do pedido · 2 itens" · R$ x). Sem rodapé fixo. */
export function TotalDoPedido({ itens, totalCents }: { itens: number; totalCents: number }) {
  return (
    <Cartao gap={0} testID="card-total-do-pedido">
      <View style={s.totalDoPedido} testID="total-do-pedido">
        <Text style={s.totalRotulo}>{rotuloTotalDoPedido(itens)}</Text>
        <Text style={s.totalValor} testID="total-do-pedido-valor">
          {formatBRL(totalCents)}
        </Text>
      </View>
    </Cartao>
  );
}

/**
 * Aba Venda (RF-VEN-11): caixa Alertas (RN-VEN-12/13) ou a linha "Cliente liberado", forma e prazo (RN-VEN-24/25), limite
 * total e disponível e prazo médio do cliente, com a data da última sincronização. `credito`: `undefined` = lendo; `null` =
 * consulta indisponível (as linhas de crédito não aparecem). Tudo do aparelho (vale offline).
 */
export function AbaVenda({
  alertas,
  pagamento,
  credito,
  prazoMedioDias,
  sincronizadoEm,
  agora,
  tz,
  semSinal,
}: {
  alertas: readonly AlertaDaVenda[];
  /** cartão de forma e prazo já montado pela tela (`CardPagamento`) */
  pagamento: ReactNode;
  credito: ModeloDoCredito | null | undefined;
  prazoMedioDias: number | null | undefined;
  sincronizadoEm: string | null;
  agora: Date;
  tz: string;
  semSinal: boolean;
}) {
  const limite = linhaDoLimite(credito);
  const prazoMedio = textoDoPrazoMedio(prazoMedioDias);
  const mostraCredito = credito !== undefined && credito !== null;
  const disponivelNegativo = credito?.tipo === 'dados' && credito.disponivel_cents < 0;
  return (
    <View style={{ gap: 12 }} testID="aba-venda-conteudo">
      <View style={{ gap: 6 }} testID="venda-alertas">
        {alertas.length > 0 ? (
          <>
            <RotuloSecao texto={ROTULO_ALERTAS} />
            {alertas.map((a) => {
              const x = textoDoAlerta(a);
              return <Faixa key={a.tipo} tom={x.tom} texto={x.texto} apoio={x.apoio} testID={`alerta-${a.tipo}`} />;
            })}
          </>
        ) : (
          <Faixa tom="ok" texto={TEXTO_SEM_ALERTA} testID="alerta-liberado" />
        )}
      </View>
      {pagamento}
      {mostraCredito || prazoMedio ? (
        <Cartao gap={8} testID="venda-credito">
          {mostraCredito ? (
            limite ? (
              <LinhaValor rotulo={ROTULO_LIMITE} valor={limite} tomValor={disponivelNegativo ? 'erro' : undefined} testID="venda-limite" />
            ) : (
              <Text style={t.small} testID="venda-sem-credito">
                {TEXTO_SEM_DADOS_DE_CREDITO}
              </Text>
            )
          ) : null}
          {prazoMedio ? <LinhaValor rotulo={ROTULO_PRAZO_MEDIO} valor={prazoMedio} testID="venda-prazo-medio" /> : null}
          {mostraCredito ? (
            <View style={s.linha} testID="venda-atualizacao">
              <Icon name={semSinal ? 'wifiOff' : 'sync'} size={13} color={colors.ink2} />
              <Text style={t.small}>{textoAtualizacao(sincronizadoEm, agora, tz)}</Text>
            </View>
          ) : null}
        </Cartao>
      ) : null}
    </View>
  );
}

/** Frete CIF/FOB e transportadora (RN-VEN-16), na aba Entrega: só a frase da modalidade, sem valor de frete. */
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
  const msgFrete = freteValido(frete);
  return (
    <Card style={s.card} testID="card-frete">
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
      <Text style={t.small} testID="frete-frase">
        {fraseDoFrete({ modalidade: frete.modalidade, transportadora: frete.transportadora_id ? (ativas.find((x) => x.id === frete.transportadora_id)?.nome ?? null) : (frete.transportadora_digitada?.nome ?? null) })}
      </Text>
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
          {msgFrete ? (
            <Text style={[t.smallStrong, { color: colors.danger }]} testID="frete-aviso">
              {msgFrete}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
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
  const [trocando, setTrocando] = useState(false);
  const lista = enderecosDoCliente(enderecos, clienteId);
  const principal = lista.find((e) => e.principal || e.tipo === 'principal') ?? null;
  const escolhido = r.endereco_entrega_id ? (lista.find((e) => e.id === r.endereco_entrega_id) ?? null) : principal;
  return (
    <View style={{ gap: 12 }} testID="aba-entrega-conteudo">
      <Card style={s.card}>
        <RotuloSecao texto={ROTULO_ENDERECO_ENTREGA} acao={lista.length > 1 ? { rotulo: 'Trocar', onPress: () => setTrocando(true), testID: 'entrega-trocar' } : undefined} />
        <Text style={t.body} testID="entrega-endereco">
          {escolhido ? textoDoEndereco(escolhido) : TEXTO_ENDERECO_DO_CADASTRO}
        </Text>
      </Card>
      <CartaoFrete rascunho={r} fretePadrao={fretePadrao} transportadoras={transportadoras} onRascunho={onRascunho} />
      <Card style={s.card}>
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
      </Card>
      <Folha visivel={trocando} onFechar={() => setTrocando(false)} rotuloFechar="Fechar" titulo="Entrega" testID="folha-entrega" rodape={{ rotulo: 'Voltar', onPress: () => setTrocando(false) }}>
        {lista.map((e) => {
          const ehPrincipal = e.principal || e.tipo === 'principal';
          return (
            <OpcaoFolha
              key={e.id}
              testID={`endereco-${e.id}`}
              icone={escolhido?.id === e.id ? 'check' : 'pin'}
              tom={escolhido?.id === e.id ? 'destaque' : 'neutro'}
              titulo={e.descricao || (ehPrincipal ? 'Principal' : 'Entrega')}
              subtitulo={textoDoEndereco(e)}
              onPress={() => {
                onRascunho((d) => ({ ...d, endereco_entrega_id: ehPrincipal ? null : e.id }));
                setTrocando(false);
              }}
            />
          );
        })}
      </Folha>
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
export function AbaResumo({
  rascunho: r,
  calculo,
  nomes,
  prazo,
  endereco,
  limiteVendedor,
  fretePadrao,
  onRascunho,
  onSalvar,
  onCancelar,
  salvando,
  podeSalvar,
  rotuloSalvar,
  somenteLeitura,
  pendencias,
  nPendencias = 0,
}: {
  rascunho: Rascunho;
  calculo: CalculoPedido;
  nomes: ReadonlyMap<string, string>;
  prazo: string;
  endereco: string | null;
  limiteVendedor: number;
  fretePadrao: 'CIF' | 'FOB';
  onRascunho: OnRascunho;
  onSalvar: () => void;
  onCancelar: () => void;
  salvando: boolean;
  podeSalvar: boolean;
  rotuloSalvar: string;
  somenteLeitura: boolean;
  pendencias?: ReactNode;
  nPendencias?: number;
}) {
  const frete = r.frete ?? { modalidade: fretePadrao };
  // T-0071 (RN-VEN-02): o ajuste do pedido é em % ou em R$ sobre o total dos itens
  const modoPedido: 'pct' | 'valor' = r.ajuste_em === 'valor' ? 'valor' : 'pct';
  const tipoPedido: 'desconto' | 'acrescimo' = modoPedido === 'valor' ? ((r.acrescimo_valor_cents ?? 0) > 0 ? 'acrescimo' : 'desconto') : (r.acrescimo_pct ?? 0) > 0 ? 'acrescimo' : 'desconto';
  const valorPct = tipoPedido === 'acrescimo' ? (r.acrescimo_pct ?? 0) : r.discount_pct;
  const valorCents = tipoPedido === 'acrescimo' ? (r.acrescimo_valor_cents ?? 0) : (r.desconto_valor_cents ?? 0);
  const valorPedido = modoPedido === 'valor' ? valorCents : valorPct;
  const equivalentePedido = textoEquivalente({ ajuste_em: modoPedido, equivalente: calculo.ajuste_pedido });
  const totais = linhasDeTotais({ total_tabela_cents: calculo.total_tabela_cents, desconto_cents: Math.max(0, calculo.descontos_cents), acrescimo_cents: Math.max(0, -calculo.descontos_cents), total_cents: calculo.total_cents });
  const faixa = textoDaFaixa(calculo, limiteVendedor);
  const linhaSomenteLeitura = linhaDoAjusteSomenteLeitura(calculo.ajuste_pedido);
  return (
    <View style={{ gap: 12 }} testID="aba-resumo-conteudo">
      <Card style={s.card} testID="resumo-pedido">
        {calculo.linhas.map((l) => (
          <LinhaValor key={l.chave} rotulo={itemCompacto(nomes.get(l.product_id) ?? '', l.quantity, l.unidade_sigla)} valor={formatReais(l.total_cents)} />
        ))}
        <Text style={t.small} testID="resumo-entrega">
          {linhaDeEntrega({ modalidade: frete.modalidade, prazo, endereco })}
        </Text>
      </Card>
      {somenteLeitura ? (
        linhaSomenteLeitura ? (
          <Card style={s.card} testID="resumo-ajuste-leitura">
            <LinhaValor rotulo={linhaSomenteLeitura.rotulo} valor={linhaSomenteLeitura.valor} />
          </Card>
        ) : null
      ) : (
      <Card style={s.card}>
        <RotuloSecao texto={rotuloDoAjusteDoPedido(tipoPedido)} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Segmentado
            testID="pedido-ajuste-tipo"
            rotuloAcessivel="Tipo do ajuste do pedido"
            compacto
            style={{ flex: 1 }}
            valor={tipoPedido}
            opcoes={[
              { id: 'desconto', rotulo: 'Desc.', rotuloAcessivel: 'Desconto' },
              { id: 'acrescimo', rotulo: 'Acrésc.', rotuloAcessivel: 'Acréscimo' },
            ]}
            onChange={(novo) => onRascunho((d) => aplicarAjusteDoPedido(d, { modo: modoPedido, sentido: novo, valor: valorPedido }))}
          />
          <Segmentado
            testID="pedido-ajuste-modo"
            rotuloAcessivel="Ajuste do pedido em porcentagem ou em reais"
            compacto
            style={{ flex: 1 }}
            valor={modoPedido}
            opcoes={[
              { id: 'pct', rotulo: '%', rotuloAcessivel: 'Porcentagem' },
              { id: 'valor', rotulo: 'R$', rotuloAcessivel: 'Reais sobre o total dos itens' },
            ]}
            onChange={(novo) => {
              const atual: Parameters<typeof trocarModoDoAjuste>[0] = modoPedido === 'valor' ? { em: 'valor', desconto_cents: tipoPedido === 'desconto' ? valorCents : 0, acrescimo_cents: tipoPedido === 'acrescimo' ? valorCents : 0 } : { em: 'pct', desconto_pct: tipoPedido === 'desconto' ? valorPct : 0, acrescimo_pct: tipoPedido === 'acrescimo' ? valorPct : 0 };
              const convertido = trocarModoDoAjuste(atual, novo, calculo.ajuste_pedido);
              const v = novo === 'valor' ? (tipoPedido === 'acrescimo' ? (convertido.acrescimo_cents ?? 0) : (convertido.desconto_cents ?? 0)) : tipoPedido === 'acrescimo' ? (convertido.acrescimo_pct ?? 0) : (convertido.desconto_pct ?? 0);
              onRascunho((d) => aplicarAjusteDoPedido(d, { modo: novo, sentido: tipoPedido, valor: v }));
            }}
          />
        </View>
        {modoPedido === 'valor' ? (
          <CampoReais valor={valorCents} rotulo={rotuloDoAjusteDoPedido(tipoPedido).toLowerCase()} testID="discount-valor" onChange={(n) => onRascunho((d) => aplicarAjusteDoPedido(d, { modo: 'valor', sentido: tipoPedido, valor: n }))} />
        ) : (
          <CampoPct valor={valorPct} rotulo={rotuloDoAjusteDoPedido(tipoPedido).toLowerCase()} testID="discount-input" onChange={(n) => onRascunho((d) => aplicarAjusteDoPedido(d, { modo: 'pct', sentido: tipoPedido, valor: n }))} />
        )}
        {equivalentePedido ? (
          <Text style={[t.smallStrong, { color: tipoPedido === 'acrescimo' ? colors.ink2 : colors.success }]} testID="pedido-equivalente">
            {equivalentePedido}
          </Text>
        ) : null}
      </Card>
      )}
      <BlocoTotais linhas={totais.linhas} total={totais.total} testID="totais-pedido">
        {faixa ? <Faixa tom={faixa.tom} texto={faixa.texto} icone={faixa.icone} testID="faixa-alcada" /> : null}
      </BlocoTotais>
      {somenteLeitura ? null : calculo.linhas.length === 0 ? (
        <Text style={t.small} testID="resumo-sem-itens">
          {TEXTO_SEM_ITEM_NO_RESUMO}
        </Text>
      ) : null}
      {somenteLeitura ? null : pendencias}
      {somenteLeitura ? null : (
        <View style={s.botoes}>
          <Button testID="cancelar-pedido" label="Cancelar" variant="outline" height={52} style={{ flex: 1 }} onPress={onCancelar} />
          <Button testID="send-order" label={rotuloSalvar} height={52} style={{ flex: 1 }} loading={salvando} disabled={!podeSalvar} accessibilityLabel={leituraDoSalvar(rotuloSalvar, nPendencias)} onPress={onSalvar} />
        </View>
      )}
    </View>
  );
}

function formatReais(cents: number): string {
  return linhasDeTotais({ total_tabela_cents: cents, desconto_cents: 0, acrescimo_cents: 0, total_cents: cents }).total.valor;
}

// ---------- Salvar e Cancelar ----------
/** Folha do Salvar (RN-VEN-13/16/10): "Enviar pedido" e "Salvar como orçamento"; cliente incompleto ou bloqueado, só o orçamento. */
export function FolhaSalvar({ visivel, opcoes, comOrcamento, onEnviar, onOrcamento, onFechar }: { visivel: boolean; opcoes: OpcoesDoSalvar; comOrcamento: boolean; onEnviar: () => void; onOrcamento: () => void; onFechar: () => void }) {
  return (
    <Folha visivel={visivel} onFechar={onFechar} rotuloFechar="Fechar" titulo={tituloDaFolhaSalvar()} testID="folha-salvar" rodape={{ rotulo: 'Voltar', onPress: onFechar, testID: 'salvar-voltar' }}>
      {opcoes.enviar.visivel ? (
        <OpcaoFolha
          testID="salvar-enviar"
          icone="send"
          titulo="Enviar pedido"
          subtitulo={opcoes.enviar.erro ?? opcoes.enviar.subtitulo}
          subtituloErro={opcoes.enviar.erro !== null}
          desligado={!opcoes.enviar.habilitado}
          onPress={onEnviar}
        />
      ) : null}
      {comOrcamento ? <OpcaoFolha testID="salvar-orcamento" icone="edit" tom="neutro" titulo="Salvar como orçamento" subtitulo={opcoes.motivo_so_orcamento ?? opcoes.orcamento.subtitulo} subtituloErro={opcoes.motivo_so_orcamento !== null} onPress={onOrcamento} /> : opcoes.motivo_so_orcamento ? <Text style={[t.smallStrong, { color: colors.danger }]}>{opcoes.motivo_so_orcamento}</Text> : null}
    </Folha>
  );
}

/** Cancelar: o rascunho só é descartado depois de confirmar. */
export function DialogoDescartar({ visivel, onVoltar, onDescartar }: { visivel: boolean; onVoltar: () => void; onDescartar: () => void }) {
  return <Dialogo visivel={visivel} titulo="Descartar este pedido?" cancelar={{ rotulo: 'Voltar', onPress: onVoltar, testID: 'descartar-voltar' }} confirmar={{ rotulo: 'Descartar', onPress: onDescartar, testID: 'descartar-confirmar' }} perigo testID="dialogo-descartar" />;
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
  botoes: { flexDirection: 'row', gap: 10 },
  sugestao: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 6 },
  sugestaoPressionada: { backgroundColor: colors.ground },
  sugestaoBotao: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  texto: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
});
