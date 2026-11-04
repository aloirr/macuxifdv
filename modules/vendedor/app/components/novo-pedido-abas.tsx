/**
 * Novo pedido em 3 abas — Itens · Detalhes · Resumo (T-0071, desenho §6.2) sobre os componentes do `packages/ui`.
 * Textos só os da referência enxuta, vindos de `lib/textos-pedido` (com teste). Só lê e escreve o rascunho do aparelho
 * (offline-first); o cálculo vem de `lib/novo-pedido`. Alvos de toque ≥ 48 dp (o ui já garante).
 */
import {
  BlocoTotais,
  Button,
  Card,
  Chip,
  colors,
  Dialogo,
  Faixa,
  Folha,
  LinhaValor,
  OpcaoFolha,
  RotuloSecao,
  Segmentado,
  type as t,
} from '@macuxi/ui/mobile';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type { opcoesDoSalvar } from '../../domain/orcamento';
import { enderecosDoCliente, freteValido, textoDoEndereco, transportadorasAtivas, type CalculoPedido, type EnderecoDaTela, type FreteDoRascunho, type TransportadoraDaTela } from '../lib/novo-pedido';
import type { Rascunho } from '../lib/pedidos';
import { itemCompacto, linhaDeEntrega, linhasDeTotais, rotuloCurtoDaCondicao, textoDaFaixa, tituloDaFolhaSalvar } from '../lib/textos-pedido';
import { CampoPct } from './novo-pedido';

type OpcoesDoSalvar = ReturnType<typeof opcoesDoSalvar>;
type OnRascunho = (fn: (r: Rascunho) => Rascunho) => void;

// ---------- aba 1 · Itens: frete e prazo no topo ----------
export function CardFreteEPrazo({
  rascunho: r,
  fretePadrao,
  prazos,
  transportadoras,
  onRascunho,
}: {
  rascunho: Rascunho;
  fretePadrao: 'CIF' | 'FOB';
  prazos: Array<{ id: string | null; rotulo: string }>;
  transportadoras: readonly TransportadoraDaTela[];
  onRascunho: OnRascunho;
}) {
  const frete: FreteDoRascunho = r.frete ?? { modalidade: fretePadrao };
  const ativas = transportadorasAtivas(transportadoras);
  const digitando = frete.modalidade === 'FOB' && !frete.transportadora_id && frete.transportadora_digitada != null;
  const setFrete = (f: FreteDoRascunho) => onRascunho((d) => ({ ...d, frete: f }));
  const msgFrete = freteValido(frete);
  return (
    <Card style={s.card} testID="card-frete-prazo">
      <View style={s.linha}>
        <Text style={s.rotuloLinha}>Frete</Text>
        <View style={{ flex: 1 }}>
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
      </View>
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
      <View style={s.linha}>
        <Text style={s.rotuloLinha}>Prazo</Text>
        <View style={[s.chips, { flex: 1 }]}>
          {prazos.map((op) => {
            const on = op.id ? r.condicao_pagamento_id === op.id : r.payment_terms === op.rotulo;
            return <Chip key={op.id ?? op.rotulo} testID={`terms-${op.rotulo}`} label={rotuloCurtoDaCondicao(op.rotulo)} active={on} onPress={() => onRascunho((d) => ({ ...d, payment_terms: op.rotulo, condicao_pagamento_id: op.id }))} />;
          })}
        </View>
      </View>
    </Card>
  );
}

function CampoTexto({ rotulo, valor, onChange, testID, teclado }: { rotulo: string; valor: string; onChange: (v: string) => void; testID: string; teclado?: 'number-pad' | 'phone-pad' }) {
  return <TextInput testID={testID} value={valor} onChangeText={onChange} keyboardType={teclado} placeholder={rotulo} placeholderTextColor={colors.ink3} accessibilityLabel={rotulo} style={s.texto} autoCorrect={false} />;
}

// ---------- aba 2 · Detalhes ----------
export function AbaDetalhes({
  rascunho: r,
  clienteId,
  enderecos,
  motivoCadastro,
  onRascunho,
}: {
  rascunho: Rascunho;
  clienteId: string;
  enderecos: readonly EnderecoDaTela[];
  /** RN-CORE-17: linha automática só de leitura (não é copiada para a observação do pedido) */
  motivoCadastro: string | null;
  onRascunho: OnRascunho;
}) {
  const [trocando, setTrocando] = useState(false);
  const lista = enderecosDoCliente(enderecos, clienteId);
  const principal = lista.find((e) => e.principal || e.tipo === 'principal') ?? null;
  const escolhido = r.endereco_entrega_id ? (lista.find((e) => e.id === r.endereco_entrega_id) ?? null) : principal;
  return (
    <View style={{ gap: 12 }} testID="aba-detalhes-conteudo">
      <Card style={s.card}>
        <RotuloSecao texto="Entrega" acao={lista.length > 1 ? { rotulo: 'Trocar', onPress: () => setTrocando(true), testID: 'entrega-trocar' } : undefined} />
        <Text style={t.body} testID="entrega-endereco">
          {escolhido ? textoDoEndereco(escolhido) : 'Endereço do cadastro'}
        </Text>
      </Card>
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

// ---------- aba 3 · Resumo ----------
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
}) {
  const frete = r.frete ?? { modalidade: fretePadrao };
  const tipoPedido: 'desconto' | 'acrescimo' = (r.acrescimo_pct ?? 0) > 0 ? 'acrescimo' : 'desconto';
  const valorPedido = tipoPedido === 'acrescimo' ? (r.acrescimo_pct ?? 0) : r.discount_pct;
  const totais = linhasDeTotais(calculo);
  const faixa = textoDaFaixa(calculo, limiteVendedor);
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
      <Card style={s.card}>
        <RotuloSecao texto="Desconto do pedido" />
        <Segmentado
          testID="pedido-ajuste-tipo"
          rotuloAcessivel="Tipo do ajuste do pedido"
          valor={tipoPedido}
          opcoes={[
            { id: 'desconto', rotulo: 'Desc.', rotuloAcessivel: 'Desconto' },
            { id: 'acrescimo', rotulo: 'Acrésc.', rotuloAcessivel: 'Acréscimo' },
          ]}
          onChange={(novo) => onRascunho((d) => (novo === 'acrescimo' ? { ...d, discount_pct: 0, acrescimo_pct: valorPedido } : { ...d, acrescimo_pct: 0, discount_pct: valorPedido }))}
        />
        <CampoPct
          valor={valorPedido}
          rotulo={tipoPedido === 'acrescimo' ? 'acréscimo do pedido' : 'desconto do pedido'}
          testID="discount-input"
          onChange={(n) => onRascunho((d) => (tipoPedido === 'acrescimo' ? { ...d, discount_pct: 0, acrescimo_pct: n } : { ...d, acrescimo_pct: 0, discount_pct: n }))}
        />
      </Card>
      <BlocoTotais linhas={totais.linhas} total={totais.total} testID="totais-pedido">
        {faixa ? <Faixa tom={faixa.tom} texto={faixa.texto} icone={faixa.icone} testID="faixa-alcada" /> : null}
      </BlocoTotais>
      {somenteLeitura ? null : (
        <View style={s.botoes}>
          <Button testID="cancelar-pedido" label="Cancelar" variant="outline" height={52} style={{ flex: 1 }} onPress={onCancelar} />
          <Button testID="send-order" label={rotuloSalvar} height={52} style={{ flex: 1 }} loading={salvando} disabled={!podeSalvar} onPress={onSalvar} />
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
  rotuloLinha: { width: 64, fontSize: 12, fontWeight: '700', color: colors.ink2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  botoes: { flexDirection: 'row', gap: 10 },
  texto: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, paddingHorizontal: 12, fontSize: 15, color: colors.ink },
});
