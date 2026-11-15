/**
 * T-0126 (RN-VEN-38): componentes da saída do formulário com abas. Spec: docs/design/formulario-pendencias.md §2. O bloco
 * "Falta para salvar" saiu (T-0166, RD-0179): a falta fica no campo, só na tentativa (`falta-rn.tsx`).
 * - `FolhaSairDoFormulario`: "Sair do pedido?" com Salvar e enviar pedido · Apenas salvar · Salvar como orçamento ·
 *   Descartar (com confirmação) · Continuar editando; a variante da RN-VEN-13 é a mesma folha sem o `salvar`;
 * - `FolhaRetomarRascunho`: depois que o sistema fechou o app, "Continuar pedido de <cliente>" ou "Descartar".
 * Nenhum texto de negócio fixo (tudo por props; os do padrão vêm das constantes de `pendencias.ts`). Alvos ≥ 48 dp.
 * Contraste (componentes.md §1.1): texto de ação só em `accentInk` (Azul noite); o `accent` aqui é o ícone da opção.
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Dialogo, Folha, OpcaoFolha } from './folha';
import { eventoDaSaida, type AcaoDaSaida, type EventoDaSaida, type PassoDaSaida } from './pendencias';
import { colors, fonte } from './theme';

// ---------- Folha de saída e retomada ----------
export interface OpcaoDaSaida {
  rotulo: string;
  /** Linha curta, sem ponto final, só na retomada ("2 itens · R$ 55,53 · alterado às 10h34"); a folha de saída vai só com o rótulo (RD-0193). */
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
  /**
   * @deprecated T-0166 (RD-0176): a folha fica sem a linha de motivo (o motivo já está nos Alertas do pedido). A prop sai
   * quando o Novo pedido parar de passá-la.
   */
  aviso?: string;
  /** "Salvar e enviar pedido". Ausente na variante da RN-VEN-13. */
  salvar?: OpcaoDaSaida;
  /** "Apenas salvar" (T-0133): grava o rascunho e aceita pendências (RN-VEN-38). */
  apenasSalvar?: OpcaoDaSaida;
  /** "Salvar como orçamento". Ausente quando o tenant não tem orçamento (pré-venda desligada). */
  salvarAlternativo?: OpcaoDaSaida;
  /** "Descartar", com confirmação. */
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
  aviso: { ...fonte.body, fontSize: 14, lineHeight: 18, color: colors.ink2 },
});
