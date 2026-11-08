/**
 * T-0126 (RN-CORE-36, RN-VEN-38): componentes do padrão de formulário com abas. Spec: docs/design/formulario-pendencias.md.
 * - `BlocoPendencias`: bloco único "Falta para salvar", só na última aba, acima do botão de salvar; uma linha por pendência
 *   ("Transportadora do frete FOB — aba Entrega"); tocar na linha abre a aba (atalho, não é botão de correção);
 * - `FolhaSairDoFormulario`: "Sair do pedido?" com Salvar e enviar pedido · Apenas salvar · Salvar como orçamento ·
 *   Descartar (com confirmação) · Continuar editando; a variante da RN-VEN-13 é a mesma folha sem o `salvar`;
 * - `FolhaRetomarRascunho`: depois que o sistema fechou o app, "Continuar pedido de <cliente>" ou "Descartar".
 * A bolinha da aba é a do `Abas` (formulario.tsx, `pendente`), alimentada por `abasComPendencia`.
 * Nenhum texto de negócio fixo (tudo por props; os do padrão vêm das constantes de `pendencias.ts`). Alvos ≥ 48 dp.
 * Contraste (componentes.md §1.1): texto laranja só em `accentInk`; o `accent` aqui é só gráfico (ícone da opção).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { ALVO_TOQUE } from './componentes';
import { Dialogo, Folha, OpcaoFolha } from './folha';
import { Icon } from './icon';
import { Pressionavel } from './movimento-rn';
import {
  dicaDaPendencia,
  eventoDaSaida,
  leituraDaPendencia,
  leituraDoBloco,
  ondeCorrigir,
  ordenarPendencias,
  TITULO_FALTA_PARA_SALVAR,
  type AbaDoFormulario,
  type AcaoDaSaida,
  type EventoDaSaida,
  type PassoDaSaida,
  type PendenciaPreenchimento,
} from './pendencias';
import { colors, fonts, radius } from './theme';

// ---------- Bloco "Falta para salvar" ----------
export function BlocoPendencias({
  pendencias,
  abas,
  onIr,
  abaDoBloco,
  titulo = TITULO_FALTA_PARA_SALVAR,
  anuncio,
  testID = 'falta-para-salvar',
}: {
  pendencias: ReadonlyArray<PendenciaPreenchimento>;
  /** Abas do formulário, na ordem da tela. A última é a do bloco (no pedido, o Resumo). */
  abas: ReadonlyArray<AbaDoFormulario>;
  /** Toque na linha: a tela abre a aba da pendência e rola até o `campo` (se houver). Sem `onIr`, as linhas não são tocáveis. */
  onIr?: (p: PendenciaPreenchimento) => void;
  /** Aba onde o bloco está; padrão: a última. */
  abaDoBloco?: string;
  titulo?: string;
  /**
   * Mude o número para o TalkBack ler o bloco de novo (ex.: depois de "Salvar pedido" na folha de saída com pendência).
   * A contagem também é lida sozinha quando muda (região viva educada).
   */
  anuncio?: number;
  testID?: string;
}) {
  const lista = ordenarPendencias(pendencias, abas);
  const n = lista.length;
  // valor do anúncio já lido: montar o bloco (abrir o Resumo) não anuncia; só a mudança do número
  const anunciado = useRef(anuncio);
  useEffect(() => {
    if (anuncio === undefined || anuncio === anunciado.current) return;
    anunciado.current = anuncio;
    if (n === 0) return;
    AccessibilityInfo.announceForAccessibility(`${leituraDoBloco(n, titulo)}. ${lista.map((p) => leituraDaPendencia(p, abas, abaDoBloco)).join('. ')}`);
    // só quando o número do anúncio muda (lista e abas lidas no momento)
  }, [anuncio]);
  if (n === 0) return null;
  return (
    <View style={s.bloco} testID={testID}>
      <View style={s.cabecalho} accessible accessibilityRole="header" accessibilityLabel={leituraDoBloco(n, titulo)} accessibilityLiveRegion="polite">
        <Icon name="alert" size={18} color={colors.warningInk} />
        <Text style={s.titulo}>{titulo}</Text>
      </View>
      {lista.map((p) => {
        const onde = ondeCorrigir(p, abas, abaDoBloco);
        const conteudo = (
          <>
            <View style={s.marcador} />
            <Text style={s.linhaTexto}>
              <Text style={s.oque}>{p.texto}</Text>
              {onde ? <Text style={s.onde}>{` — ${onde}`}</Text> : null}
            </Text>
            {onIr ? <Icon name="chevron" size={16} color={colors.warningInk} strokeWidth={2.4} /> : null}
          </>
        );
        return onIr ? (
          <Pressionavel
            key={p.id}
            testID={`${testID}-${p.id}`}
            accessibilityRole="button"
            accessibilityLabel={leituraDaPendencia(p, abas, abaDoBloco)}
            accessibilityHint={dicaDaPendencia(p, abas, abaDoBloco)}
            onPress={() => onIr(p)}
            style={s.linha}>
            {conteudo}
          </Pressionavel>
        ) : (
          <View key={p.id} testID={`${testID}-${p.id}`} accessible accessibilityLabel={leituraDaPendencia(p, abas, abaDoBloco)} style={s.linha}>
            {conteudo}
          </View>
        );
      })}
    </View>
  );
}

// ---------- Folha de saída e retomada ----------
export interface OpcaoDaSaida {
  rotulo: string;
  /** Linha curta, sem ponto final: "Vai para a fila de envio", "Válido até 15/11", "Apaga este pedido". */
  subtitulo?: string;
  testID?: string;
}

export interface DescarteDaSaida extends OpcaoDaSaida {
  /** Diálogo de confirmação: título ("Descartar este pedido?"), mensagem opcional, Voltar e Descartar. */
  confirmacao: { titulo: string; mensagem?: string; voltar: string; confirmar: string };
}

/** Passo da folha com descarte confirmado; volta às opções a cada abertura. */
function usePassoDaSaida(visivel: boolean) {
  const [passo, setPasso] = useState<PassoDaSaida>(visivel ? 'opcoes' : 'fechada');
  useEffect(() => setPasso(visivel ? 'opcoes' : 'fechada'), [visivel]);
  const disparar = useCallback(
    (evento: EventoDaSaida): AcaoDaSaida => {
      const r = eventoDaSaida(passo, evento);
      setPasso(r.passo);
      return r.acao;
    },
    [passo],
  );
  return { passo, disparar };
}

function ConfirmarDescarte({ visivel, descartar, onEvento, testID }: { visivel: boolean; descartar: DescarteDaSaida; onEvento: (e: EventoDaSaida) => void; testID: string }) {
  const c = descartar.confirmacao;
  return (
    <Dialogo
      visivel={visivel}
      titulo={c.titulo}
      mensagem={c.mensagem}
      cancelar={{ rotulo: c.voltar, onPress: () => onEvento('voltar_do_descarte'), testID: `${testID}-descarte-voltar` }}
      confirmar={{ rotulo: c.confirmar, onPress: () => onEvento('confirmar_descarte'), testID: `${testID}-descarte-confirmar` }}
      perigo
      testID={`${testID}-descarte`}
    />
  );
}

/**
 * "Sair do pedido?" (RN-VEN-38). Abre em qualquer saída de formulário alterado (Voltar do cabeçalho, gesto ou botão Voltar do
 * Android, barra inferior, Cancelar). Sem `salvar` = variante do cliente da RN-VEN-13 (só orçamento e Descartar). O toque fora
 * e o Voltar do Android com a folha aberta valem "Continuar editando". A tela fecha a folha (`visivel = false`) ao receber a ação.
 */
export function FolhaSairDoFormulario({
  visivel,
  titulo,
  aviso,
  salvar,
  apenasSalvar,
  salvarAlternativo,
  descartar,
  continuar,
  onAcao,
  testID = 'folha-sair',
}: {
  visivel: boolean;
  /** "Sair do pedido?" */
  titulo: string;
  /** Linha abaixo do título, só quando explica a falta de uma opção (RN-VEN-13: "Cliente bloqueado: só orçamento"). */
  aviso?: string;
  /** "Salvar e enviar pedido" · "Vai para a fila de envio". Ausente na variante da RN-VEN-13. */
  salvar?: OpcaoDaSaida;
  /** "Apenas salvar" · "Guarda sem enviar" (T-0133): grava o rascunho e aceita pendências (RN-VEN-38). */
  apenasSalvar?: OpcaoDaSaida;
  /** "Salvar orçamento" · "Válido até 15/11". Ausente quando o tenant não tem orçamento (pré-venda desligada). */
  salvarAlternativo?: OpcaoDaSaida;
  /** "Descartar" · "Apaga este pedido", com confirmação. */
  descartar: DescarteDaSaida;
  /** "Continuar editando" (rodapé de texto). */
  continuar: string;
  /**
   * Ação escolhida. Assinatura de método (bivariante) de propósito: a tela que ainda não usa `apenasSalvar` pode tipar o
   * handler só com as ações antigas; `apenas_salvar` só chega quando a opção é passada (T-0133).
   */
  onAcao(acao: Exclude<AcaoDaSaida, null>): void;
  testID?: string;
}) {
  const { passo, disparar } = usePassoDaSaida(visivel);
  const onEvento = (e: EventoDaSaida) => {
    const acao = disparar(e);
    if (acao) onAcao(acao);
  };
  return (
    <>
      <Folha
        visivel={visivel && passo === 'opcoes'}
        onFechar={() => onEvento('continuar')}
        rotuloFechar={continuar}
        titulo={titulo}
        rodape={{ rotulo: continuar, onPress: () => onEvento('continuar'), testID: `${testID}-continuar` }}
        testID={testID}>
        {aviso ? <Text style={s.aviso}>{aviso}</Text> : null}
        {salvar ? <OpcaoFolha testID={salvar.testID ?? `${testID}-salvar`} icone="send" titulo={salvar.rotulo} subtitulo={salvar.subtitulo} onPress={() => onEvento('salvar')} /> : null}
        {apenasSalvar ? (
          <OpcaoFolha testID={apenasSalvar.testID ?? `${testID}-apenas-salvar`} icone="file" tom="neutro" titulo={apenasSalvar.rotulo} subtitulo={apenasSalvar.subtitulo} onPress={() => onEvento('apenas_salvar')} />
        ) : null}
        {salvarAlternativo ? (
          <OpcaoFolha testID={salvarAlternativo.testID ?? `${testID}-alternativo`} icone="edit" tom="neutro" titulo={salvarAlternativo.rotulo} subtitulo={salvarAlternativo.subtitulo} onPress={() => onEvento('salvar_alternativo')} />
        ) : null}
        <OpcaoFolha testID={descartar.testID ?? `${testID}-descartar`} icone="trash" tom="perigo" titulo={descartar.rotulo} subtitulo={descartar.subtitulo} onPress={() => onEvento('descartar')} />
      </Folha>
      <ConfirmarDescarte visivel={visivel && passo === 'confirmar_descarte'} descartar={descartar} onEvento={onEvento} testID={testID} />
    </>
  );
}

/**
 * Retomada do rascunho depois que o sistema fechou o app (RN-VEN-38): "Pedido não terminado" com "Continuar pedido de
 * <cliente>" e "Descartar" (com confirmação). O rodapé ("Agora não"), o toque fora e o Voltar do Android guardam o rascunho
 * e não apagam nada: nenhum pedido some sem escolha.
 */
export function FolhaRetomarRascunho({
  visivel,
  titulo,
  continuar,
  descartar,
  depois,
  onAcao,
  testID = 'folha-retomar',
}: {
  visivel: boolean;
  /** "Pedido não terminado" */
  titulo: string;
  /** `tituloDaRetomada('pedido', cliente)` · `apoioDaRetomada([...])` */
  continuar: OpcaoDaSaida;
  descartar: DescarteDaSaida;
  /** "Agora não" */
  depois: string;
  onAcao: (acao: 'continuar' | 'descartar' | 'depois') => void;
  testID?: string;
}) {
  const { passo, disparar } = usePassoDaSaida(visivel);
  const onEvento = (e: EventoDaSaida) => {
    const acao = disparar(e);
    if (acao === 'descartar') onAcao('descartar');
    else if (acao === 'continuar') onAcao('depois');
  };
  return (
    <>
      <Folha visivel={visivel && passo === 'opcoes'} onFechar={() => onEvento('continuar')} rotuloFechar={depois} titulo={titulo} rodape={{ rotulo: depois, onPress: () => onEvento('continuar'), testID: `${testID}-depois` }} testID={testID}>
        <OpcaoFolha testID={continuar.testID ?? `${testID}-continuar`} icone="edit" titulo={continuar.rotulo} subtitulo={continuar.subtitulo} onPress={() => onAcao('continuar')} />
        <OpcaoFolha testID={descartar.testID ?? `${testID}-descartar`} icone="trash" tom="perigo" titulo={descartar.rotulo} subtitulo={descartar.subtitulo} onPress={() => onEvento('descartar')} />
      </Folha>
      <ConfirmarDescarte visivel={visivel && passo === 'confirmar_descarte'} descartar={descartar} onEvento={onEvento} testID={testID} />
    </>
  );
}

const s = StyleSheet.create({
  // âmbar = "falta algo" (não é erro): warningInk 9,0:1 e ink 15:1 no warningBg; ink2 6,8:1
  bloco: { backgroundColor: colors.warningBg, borderRadius: radius.cartao, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, gap: 2 },
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  titulo: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.warningInk },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: ALVO_TOQUE, paddingVertical: 6 },
  marcador: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warningInk, marginLeft: 6 },
  linhaTexto: { flex: 1, minWidth: 0 },
  oque: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.ink },
  onde: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink2 },
  aviso: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink2 },
});
