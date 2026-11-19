/**
 * Aba Aprovações do Macuxi Gestão (RF-GES-04, T-0184 P3 B): um cartão por motivo (`Nº 000021 · Crédito disponível R$ 1.880,00`),
 * cada um com o seu Decidir e só os motivos que quem olha pode decidir. Decidir abre Aprovar (2 toques), Devolver e Rejeitar
 * (com motivo, RN-GES-08); as ações chamam as rotas do Vendedor, que revalida a alçada (ADR 0011, RN-VEN-10). Prazo em dias
 * úteis (RN-GES-03). Offline: a fila vem do cache; decidir exige internet.
 */
import { formatBRL } from '@macuxi/comum';
import { Banner, Botao, Cartao, CampoTexto, ChipEstado, colors, EstadoVazio, Folha, Loading, Screen, type as t } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SeloFaixa } from '../components/selo-faixa';
import { linhaDoCartao, nomesDaVisao, rotuloDoPrazo, TOM_PARA_CHIP } from '../lib/apresentacao';
import { cartoesDaFila, erroDoMotivo, resumoDosCartoes, type AcaoDeDecisao, type CartaoDaFila } from '../lib/decisao';
import { contagem, pct } from '../lib/formato';
import { useGestor } from '../state/use-gestor';

export default function AprovacoesScreen() {
  const g = useGestor();
  const [aberto, setAberto] = useState<CartaoDaFila | null>(null);
  if (!g.carregado) return <Loading />;
  const nomes = nomesDaVisao(g.visao);
  const fila = g.fila;
  const cartoes = cartoesDaFila(fila?.itens ?? []);
  const resumo = resumoDosCartoes(cartoes);
  return (
    <Screen
      testID="gestor-aprovacoes"
      cabecalho={{ titulo: 'Aprovações', direita: <SeloFaixa g={g} /> }}
      refreshing={g.auto.puxando}
      onRefresh={g.auto.puxar}>
      {g.erro ? <Banner tone="danger">{g.erro}</Banner> : null}
      {fila ? (
        <Text style={t.sub} testID="gestor-fila-resumo">
          {resumo.para_mim} para você · {contagem(resumo.vencidos, 'vencido', 'vencidos')} · {resumo.vencendo} vencendo
        </Text>
      ) : null}
      <Cartao preenchimento={0} style={{ overflow: 'hidden' }}>
        {!fila || cartoes.length === 0 ? (
          fila ? (
            <EstadoVazio icone="check" titulo="Nada aguardando aprovação" texto="Quando um vendedor da sua equipe pedir, o pedido aparece aqui." />
          ) : (
            <EstadoVazio icone="check" titulo="Sem dados no aparelho ainda" texto="Puxe para baixo para sincronizar." />
          )
        ) : null}
        {cartoes.map((c, n) => (
          <CartaoDoMotivo key={c.chave} c={c} nome={nomes.get(c.item.vendedor_id) ?? 'Vendedor'} ultimo={n === cartoes.length - 1} aoDecidir={() => setAberto(c)} />
        ))}
      </Cartao>
      <FolhaDecidir cartao={aberto} aoFechar={() => setAberto(null)} decidir={g.decidirAprovacao} />
    </Screen>
  );
}

function CartaoDoMotivo({ c, nome, ultimo, aoDecidir }: { c: CartaoDaFila; nome: string; ultimo: boolean; aoDecidir: () => void }) {
  const { item: i, aprovacao } = c;
  const prazo = rotuloDoPrazo(i);
  const linha = linhaDoCartao(i, aprovacao.motivo, pct, formatBRL);
  return (
    <Pressable
      testID={`gestor-aprovacao-${i.pedido_id}-${aprovacao.motivo}`}
      accessibilityRole="button"
      accessibilityLabel={`${nome}, ${formatBRL(i.total_cents)}, ${linha}, ${prazo.label}`}
      disabled={!aprovacao.pode_decidir}
      onPress={aoDecidir}
      style={({ pressed }) => [styles.item, !ultimo && styles.divisor, pressed && { backgroundColor: colors.ground }]}>
      <View style={styles.linha}>
        <Text style={[t.bodyStrong, { flex: 1 }]} numberOfLines={1}>
          {nome}
        </Text>
        <Text style={t.bodyStrong}>{formatBRL(i.total_cents)}</Text>
      </View>
      <Text style={t.small} numberOfLines={2}>
        {linha}
      </Text>
      <View style={styles.linha}>
        <ChipEstado texto={prazo.label} tom={TOM_PARA_CHIP[prazo.tom]} pequeno />
        {aprovacao.pode_decidir ? <Text style={[t.label, { color: colors.accentInk }]}>Decidir</Text> : null}
      </View>
    </Pressable>
  );
}

/** Aprovar em 2 toques (Decidir, Aprovar); Devolver e Rejeitar pedem o motivo (RN-GES-08) e confirmam com o mesmo rótulo. */
function FolhaDecidir({ cartao, aoFechar, decidir }: { cartao: CartaoDaFila | null; aoFechar: () => void; decidir: ReturnType<typeof useGestor>['decidirAprovacao'] }) {
  const [acao, setAcao] = useState<AcaoDeDecisao | null>(null);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fechar = () => {
    setAcao(null);
    setTexto('');
    setErro(null);
    aoFechar();
  };
  const confirmar = async (a: AcaoDeDecisao) => {
    if (!cartao) return;
    const invalido = erroDoMotivo(a, texto);
    if (invalido) return setErro(invalido);
    setOcupado(true);
    const r = await decidir(cartao.item.pedido_id, a, cartao.aprovacao.motivo, texto);
    setOcupado(false);
    if (r.ok) fechar();
    else setErro(r.mensagem);
  };
  const titulo = cartao ? linhaDoCartao(cartao.item, cartao.aprovacao.motivo, pct, formatBRL) : 'Decidir';
  return (
    <Folha
      visivel={cartao !== null}
      onFechar={fechar}
      rotuloFechar="Fechar"
      titulo={titulo}
      evitarTeclado
      testID="gestor-folha-decidir"
      rodape={acao ? { rotulo: 'Voltar', onPress: () => { setAcao(null); setErro(null); } } : { rotulo: 'Fechar', onPress: fechar }}>
      <View style={styles.folha}>
        {erro ? <Banner tone="danger" icon="alert">{erro}</Banner> : null}
        {acao === null ? (
          <>
            <Botao testID="gestor-decidir-aprovar" nivel="principal" icone="check" rotulo="Aprovar" desligado={ocupado} ocupado={ocupado} onPress={() => void confirmar('aprovar')} />
            <Botao testID="gestor-decidir-devolver" rotulo="Devolver" desligado={ocupado} onPress={() => setAcao('devolver')} />
            <Botao testID="gestor-decidir-rejeitar" nivel="perigo" rotulo="Rejeitar" desligado={ocupado} onPress={() => setAcao('rejeitar')} />
          </>
        ) : (
          <>
            <CampoTexto rotulo="Motivo" valor={texto} aoMudar={setTexto} multiline maxLength={500} testID="gestor-decidir-motivo" />
            <Botao testID="gestor-decidir-confirmar" nivel={acao === 'rejeitar' ? 'perigo' : 'principal'} rotulo={acao === 'devolver' ? 'Devolver' : 'Rejeitar'} desligado={ocupado} ocupado={ocupado} onPress={() => void confirmar(acao)} />
          </>
        )}
      </View>
    </Folha>
  );
}

const styles = StyleSheet.create({
  item: { gap: 4, minHeight: 56, paddingVertical: 11, paddingHorizontal: 14 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  folha: { gap: 10, paddingBottom: 8 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
