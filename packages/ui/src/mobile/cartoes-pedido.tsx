/**
 * Cartões da aba Detalhes do Novo pedido (T-0089, fatia U1; referência
 * docs/produto/referencias/R-20261106-0703-alexandre-novo-pedido-itens-v2.png; spec docs/design/novo-pedido-itens.md):
 * - `CartaoCredito`: "Crédito do cliente" com o limite total e o disponível (RN-VEN-12), o alerta vermelho de inadimplência
 *   (RN-VEN-13; texto de `textoInadimplencia`) e a data da última sincronização (vale offline);
 * - `CartaoLeveMais`: "Leve mais e pague menos" com a próxima faixa de cada item (RN-VEN-23; textos de `textosLeveMais`) e um
 *   toque na linha para ajustar a quantidade.
 * Nenhum texto fixo e nenhum cálculo: os valores chegam formatados pelo módulo (dinheiro de centavos, data no fuso do tenant).
 */
import { StyleSheet, Text, View } from 'react-native';

import { Cartao } from './base';
import { ALVO_TOQUE } from './componentes';
import { Icon } from './icon';
import { Pressionavel } from './movimento-rn';
import { colors, fonts } from './theme';
import { Faixa } from './valores';

export interface ValorCredito {
  /** Ex.: "Limite total", "Limite disponível". */
  rotulo: string;
  /** Já formatado de centavos ("R$ 15.000,00"). */
  valor: string;
  /** Disponível negativo (pedidos acima do limite): número em vermelho. */
  negativo?: boolean;
}

export function CartaoCredito({
  titulo,
  limiteTotal,
  limiteDisponivel,
  alerta,
  vazio,
  atualizacao,
  semSinal,
  testID = 'credito',
}: {
  /** "Crédito do cliente". */
  titulo: string;
  limiteTotal: ValorCredito;
  limiteDisponivel: ValorCredito;
  /** Alerta vermelho (título vencido ou cliente bloqueado); null esconde. */
  alerta?: string | null;
  /** Cliente sem dados financeiros: este texto entra no lugar dos valores ("Sem dados de crédito deste cliente."). */
  vazio?: string | null;
  /** "Atualizado hoje às 06:20" (`textoAtualizacao`); null esconde. */
  atualizacao?: string | null;
  /** Aparelho sem sinal agora: o ícone da linha de atualização vira o de sem sinal. */
  semSinal?: boolean;
  testID?: string;
}) {
  return (
    <Cartao testID={testID} gap={8}>
      <Text style={s.rotulo} accessibilityRole="header">
        {titulo}
      </Text>
      {vazio ? (
        <Text style={s.vazio} testID={`${testID}-vazio`}>
          {vazio}
        </Text>
      ) : (
        <View style={s.valores}>
          <View style={s.coluna} accessible accessibilityLabel={`${limiteTotal.rotulo}: ${limiteTotal.valor}`} testID={`${testID}-total`}>
            <Text style={s.valorRotulo}>{limiteTotal.rotulo}</Text>
            <Text style={[s.valor, limiteTotal.negativo && s.valorNegativo]} numberOfLines={1} adjustsFontSizeToFit>
              {limiteTotal.valor}
            </Text>
          </View>
          <View style={[s.coluna, s.colunaDireita]} accessible accessibilityLabel={`${limiteDisponivel.rotulo}: ${limiteDisponivel.valor}`} testID={`${testID}-disponivel`}>
            <Text style={[s.valorRotulo, s.direita]}>{limiteDisponivel.rotulo}</Text>
            <Text style={[s.valor, s.direita, limiteDisponivel.negativo && s.valorNegativo]} numberOfLines={1} adjustsFontSizeToFit>
              {limiteDisponivel.valor}
            </Text>
          </View>
        </View>
      )}
      {alerta ? <Faixa tom="erro" texto={alerta} testID={`${testID}-alerta`} /> : null}
      {atualizacao ? (
        <View style={s.atualizacao} testID={`${testID}-atualizacao`}>
          <Icon name={semSinal ? 'wifiOff' : 'sync'} size={13} color={colors.ink2} />
          <Text style={s.atualizacaoTexto}>{atualizacao}</Text>
        </View>
      ) : null}
    </Cartao>
  );
}

export interface ItemLeveMais {
  id: string;
  /** "Água mineral 1,5 L · leve 10 FD". */
  titulo: string;
  /** "R$ 19,90/FD (hoje R$ 20,31) · faltam 7 FD". */
  apoio: string;
  /** Leitura completa da linha (`textosLeveMais().leitura`). */
  leitura?: string;
  /** O que o toque faz, para o leitor de tela ("Ajustar para 10 FD"). */
  rotuloAjustar: string;
  onAjustar: () => void;
  desligado?: boolean;
  testID?: string;
}

export function CartaoLeveMais({ titulo, itens, testID = 'leve-mais' }: { titulo: string; itens: ReadonlyArray<ItemLeveMais>; testID?: string }) {
  // sem próxima faixa em nenhum item, o cartão não aparece
  if (itens.length === 0) return null;
  return (
    <Cartao testID={testID} gap={2}>
      <Text style={s.rotulo} accessibilityRole="header">
        {titulo}
      </Text>
      {itens.map((i, n) => (
        <Pressionavel
          key={i.id}
          testID={i.testID ?? `${testID}-${i.id}`}
          accessibilityRole="button"
          accessibilityLabel={i.leitura ?? `${i.titulo}. ${i.apoio}`}
          accessibilityHint={i.rotuloAjustar}
          accessibilityState={{ disabled: Boolean(i.desligado) }}
          disabled={i.desligado}
          escala={false}
          onPress={i.onAjustar}
          style={[s.linha, n > 0 && s.linhaDivisor]}>
          <View style={s.linhaTextos}>
            <Text style={s.linhaTitulo} numberOfLines={2}>
              {i.titulo}
            </Text>
            <Text style={s.linhaApoio}>{i.apoio}</Text>
          </View>
          <View style={[s.subir, i.desligado && s.desligado]}>
            <Icon name="subir" size={18} color={colors.accent} strokeWidth={2.2} />
          </View>
        </Pressionavel>
      ))}
    </Cartao>
  );
}

const s = StyleSheet.create({
  desligado: { opacity: 0.45 },
  rotulo: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  vazio: { fontFamily: fonts.body, fontSize: 14, color: colors.ink2 },
  valores: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  coluna: { flex: 1, minWidth: 0, gap: 1 },
  colunaDireita: { alignItems: 'flex-end' },
  direita: { textAlign: 'right' },
  valorRotulo: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink2 },
  valor: { fontFamily: fonts.display, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  valorNegativo: { color: colors.danger },
  atualizacao: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  atualizacaoTexto: { fontFamily: fonts.body, fontSize: 12, color: colors.ink2 },
  linha: { minHeight: ALVO_TOQUE + 8, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  linhaDivisor: { borderTopWidth: 1, borderTopColor: colors.line },
  linhaTextos: { flex: 1, minWidth: 0, gap: 2 },
  linhaTitulo: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  linhaApoio: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink2 },
  subir: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});
