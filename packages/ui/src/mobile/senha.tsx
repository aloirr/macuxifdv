/**
 * T-0093 (RN-CORE-32): lista "A senha precisa ter" ao vivo, para as telas de senha do app da T-0094 ("Crie sua senha", troca
 * no 1º uso). Só exibe as faltas que a tela entrega (`faltasNaSenha` do Core); nunca recebe a senha. Funciona offline (a regra
 * é função pura do Core). Spec: docs/design/portal-entrar.md §5.
 *
 * Acessível: a lista é um elemento só para o TalkBack, com o resumo como rótulo ("Falta um número."), numa região viva educada:
 * ele lê de novo quando o resumo muda. Na tela, cada regra muda de forma (✓ ou círculo vazio), não só de cor.
 * T-0094: com `repeticao` ("Crie sua senha"), o item "As duas senhas iguais" fica abaixo da lista, com a mesma marca das regras
 * (R-20261115-080000-alexandre), e o rótulo falado traz as duas coisas ("Falta um número. As duas senhas iguais: falta.").
 */
import { StyleSheet, Text, View } from 'react-native';

import {
  itemDaRepeticao,
  itensDasRegras,
  resumoComRepeticao,
  resumoDaTela,
  TITULO_REGRAS_DA_SENHA,
  type EstadoRegraSenha,
  type RepeticaoSenha,
} from '../comum/senha';
import { Icon } from './icon';
import { colors, fonts } from './theme';

export {
  CAMPO_REPITA_A_SENHA,
  CAMPO_SENHA_NOVA,
  ESCONDER_SENHA,
  ESTADO_FALADO_REGRA,
  EXEMPLO_REGRA_SENHA,
  faltasEmOrdem,
  itemDaRepeticao,
  itensDasRegras,
  MOSTRAR_SENHA,
  OCULTAR_SENHA,
  REGRAS_DA_SENHA,
  resumoComRepeticao,
  resumoDaTela,
  rotuloDaRegraSenha,
  rotuloDoOlhoDaSenha,
  SENHA_ATENDE_AS_REGRAS,
  TEXTO_REPETICAO_SENHA,
  TITULO_REGRAS_DA_SENHA,
} from '../comum/senha';
export type { EstadoRegraSenha, FinalidadeSenha, ItemRegraSenha, ItemRepeticaoSenha, RegraSenha, RepeticaoSenha } from '../comum/senha';

const COR_DO_TEXTO: Record<EstadoRegraSenha, string> = { ok: colors.ink, falta: colors.ink2, erro: colors.danger };

function Marca({ estado }: { estado: EstadoRegraSenha }) {
  if (estado === 'ok') {
    return (
      <View style={[s.marca, { backgroundColor: colors.successBg }]}>
        <Icon name="check" size={12} color={colors.success} strokeWidth={2.6} />
      </View>
    );
  }
  if (estado === 'erro') {
    return (
      <View style={[s.marca, { backgroundColor: colors.dangerBg }]}>
        <Icon name="x" size={12} color={colors.danger} strokeWidth={2.6} />
      </View>
    );
  }
  return <View style={[s.marca, s.vazia]} />;
}

export function RegrasDaSenha({
  faltas,
  destacar = false,
  resumo,
  minimo,
  repeticao,
  testID = 'regras-da-senha',
}: {
  /** `faltasNaSenha(senha)` do Core (campo vazio = as quatro). */
  faltas: readonly string[];
  /** Depois de tentar salvar com falta: as faltas ficam em vermelho, com ✕. */
  destacar?: boolean;
  /**
   * Rótulo falado: `mensagemDaSenha(faltas)` do Core (RD-0021, obrigatório; o kit não monta frase). `null`/`undefined` (nada falta) =
   * "A senha atende às regras.".
   */
  resumo: string | null | undefined;
  /** Mínimo de caracteres da RN-CORE-32: passe `SENHA_MIN_CARACTERES` do Core (RD-0021, obrigatório; o kit não escreve o número). */
  minimo: number;
  /** T-0094: resultado do campo "Repita a senha" (a tela compara). Ausente = sem a linha. */
  repeticao?: RepeticaoSenha;
  testID?: string;
}) {
  const itens = itensDasRegras(faltas, minimo, destacar);
  const conferencia = itemDaRepeticao(repeticao, destacar);
  const falado = resumoComRepeticao(resumoDaTela(resumo), repeticao, destacar);
  return (
    <View testID={testID} style={s.caixa} accessible accessibilityRole="text" accessibilityLabel={falado} accessibilityLiveRegion="polite">
      <Text style={s.titulo}>{TITULO_REGRAS_DA_SENHA}</Text>
      {itens.map((i) => (
        <View key={i.regra} style={s.linha} testID={`${testID}.${i.regra}`}>
          <Marca estado={i.estado} />
          <Text style={[s.texto, { color: COR_DO_TEXTO[i.estado] }, i.estado === 'erro' && { fontFamily: fonts.semibold }]}>
            {i.rotulo}
            {i.exemplo ? <Text style={{ color: colors.ink2 }}>{` (${i.exemplo})`}</Text> : null}
          </Text>
        </View>
      ))}
      {conferencia ? (
        <View style={[s.linha, s.conferencia]} testID={`${testID}.repeticao`}>
          <Marca estado={conferencia.estado} />
          <Text style={[s.texto, { color: COR_DO_TEXTO[conferencia.estado] }, conferencia.estado === 'erro' && { fontFamily: fonts.semibold }]}>{conferencia.texto}</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  caixa: { gap: 6 },
  titulo: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 },
  marca: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  vazia: { borderWidth: 2, borderColor: colors.lineStrong },
  conferencia: { marginTop: 4 },
  texto: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
});
