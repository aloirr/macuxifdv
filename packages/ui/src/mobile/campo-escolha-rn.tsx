/**
 * T-0165 (pedido-v4.md §5.6) e T-0166 (§6.1): `CampoEscolha`, o campo de escolha de 48 dp que abre uma `Folha` com busca, a lista
 * e uma opção final fixa. Primeiro uso: a Transportadora do frete FOB (lista do BKO + "Outra (digitar)").
 *   TRANSPORTADORA
 *   [ Rápido Norte                    ˅ ]      vazio: "Escolher" em ink3
 *   ⚠ Obrigatório                              só com `falta` (borda danger 2)
 * Folha: título (sistema 18/700) com ✕, `CampoBusca`, linhas de 52 dp (a escolhida com ✓ `accentInk` sobre `accentSoft`) e a
 * opção final por último (15/600 `accentInk`), também quando a busca não acha nada. Tocar numa linha escolhe e fecha.
 * Nenhum texto fixo: tudo por props. Sem regra de negócio: o módulo diz as opções, a escolhida e a falta (já resolvida com
 * `faltaVisivel`). Alvos ≥ 48 dp.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CAMPO_ESCOLHA, filtrarOpcoes, textoDoCampoEscolha, type OpcaoEscolha } from './campo-escolha';
import { leituraDoCampoComFalta } from './falta';
import { bordaDaFalta, TextoDaFalta } from './falta-rn';
import { Folha } from './folha';
import { CampoBusca, RotuloSecao } from './formulario';
import { Icon } from './icon';
import { Pressionavel } from './movimento-rn';
import { colors, fonte } from './theme';

export function CampoEscolha<T extends OpcaoEscolha>({
  rotulo,
  titulo,
  opcoes,
  valor,
  onEscolher,
  opcaoFinal,
  rotuloLivre,
  placeholder,
  placeholderBusca,
  rotuloFechar,
  rotuloLimpar,
  busca: comBusca = true,
  falta,
  desligado,
  testID = 'campo-escolha',
}: {
  /** Título da seção acima do campo ("Transportadora", mostrado em maiúsculas). Sem ele, o campo vem sozinho. */
  rotulo?: string;
  /** Título da folha ("Transportadora"); também nome do campo para o TalkBack quando não há `rotulo`. */
  titulo: string;
  opcoes: ReadonlyArray<T>;
  /** id da escolhida (null = nenhuma). */
  valor: string | null | undefined;
  onEscolher: (opcao: T) => void;
  /** Linha fixa no fim da folha ("Outra (digitar)"); o toque fecha a folha e chama `onPress`. */
  opcaoFinal?: { rotulo: string; onPress: () => void; testID?: string };
  /** Texto do campo quando a escolha é a opção final ("Outra"); null/undefined = usa `valor`. */
  rotuloLivre?: string | null;
  /** Campo vazio ("Escolher"); desligado, "—" (RD-0190). */
  placeholder: string;
  /** Placeholder da busca ("Buscar"). */
  placeholderBusca: string;
  /** ✕ da folha e toque fora, para o TalkBack ("Fechar"). */
  rotuloFechar: string;
  /** Botão × da busca ("Limpar a busca"). */
  rotuloLimpar?: string;
  /** Lista curta sem busca. Padrão: com busca. */
  busca?: boolean;
  /** Texto curto da falta já visível (`faltaVisivel`): borda `danger` e o texto embaixo. */
  falta?: string | null;
  desligado?: boolean;
  testID?: string;
}) {
  const [aberta, setAberta] = useState(false);
  const [termo, setTermo] = useState('');
  const campo = textoDoCampoEscolha(opcoes, valor, placeholder, rotuloLivre);
  const lista = comBusca ? filtrarOpcoes(opcoes, termo) : [...opcoes];
  const fechar = () => {
    setAberta(false);
    setTermo('');
  };
  const nome = rotulo ?? titulo;
  return (
    <View style={s.bloco} testID={testID}>
      {rotulo ? <RotuloSecao texto={rotulo} /> : null}
      <Pressionavel
        testID={`${testID}-campo`}
        accessibilityRole="button"
        accessibilityLabel={leituraDoCampoComFalta(nome, campo.texto, falta)}
        accessibilityState={{ disabled: Boolean(desligado), expanded: aberta }}
        disabled={desligado}
        onPress={() => setAberta(true)}
        escala={false}
        style={[s.campo, bordaDaFalta(falta), desligado && s.campoDesligado]}>
        <Text style={[s.campoTexto, (campo.vazio || desligado) && s.campoVazio]} numberOfLines={1}>
          {campo.texto}
        </Text>
        {desligado ? null : (
          <View style={s.seta}>
            <Icon name="chevron" size={CAMPO_ESCOLHA.seta} color={colors.ink2} />
          </View>
        )}
      </Pressionavel>
      <TextoDaFalta texto={falta} testID={`${testID}-falta`} />
      <Folha visivel={aberta} onFechar={fechar} rotuloFechar={rotuloFechar} titulo={titulo} fechar={{ rotulo: rotuloFechar, testID: `${testID}-fechar` }} evitarTeclado={comBusca} rolavel testID={`${testID}-folha`}>
        <View style={s.folha}>
          {comBusca ? <CampoBusca valor={termo} onChange={setTermo} onLimpar={() => setTermo('')} rotuloLimpar={rotuloLimpar} placeholder={placeholderBusca} testID={`${testID}-busca`} /> : null}
          {lista.map((o) => {
            const on = !rotuloLivre && o.id === valor;
            return (
              <Pressionavel
                key={o.id}
                testID={`${testID}-opcao-${o.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  onEscolher(o);
                  fechar();
                }}
                escala={false}
                style={[s.linha, on && s.linhaOn]}>
                <Text style={[s.linhaTexto, on && s.linhaTextoOn]} numberOfLines={2}>
                  {o.rotulo}
                </Text>
                {on ? <Icon name="check" size={20} color={colors.accentInk} strokeWidth={2.4} /> : null}
              </Pressionavel>
            );
          })}
          {opcaoFinal ? (
            <Pressionavel
              testID={opcaoFinal.testID ?? `${testID}-final`}
              accessibilityRole="button"
              accessibilityState={{ selected: Boolean(rotuloLivre) }}
              onPress={() => {
                opcaoFinal.onPress();
                fechar();
              }}
              escala={false}
              style={[s.linha, rotuloLivre ? s.linhaOn : null]}>
              <Text style={s.final}>{opcaoFinal.rotulo}</Text>
              {rotuloLivre ? <Icon name="check" size={20} color={colors.accentInk} strokeWidth={2.4} /> : null}
            </Pressionavel>
          ) : null}
        </View>
      </Folha>
    </View>
  );
}

const s = StyleSheet.create({
  bloco: { gap: 8 },
  campo: {
    minHeight: CAMPO_ESCOLHA.altura,
    borderRadius: CAMPO_ESCOLHA.raio,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  campoDesligado: { backgroundColor: colors.ground },
  campoTexto: { flex: 1, ...fonte.body, fontSize: CAMPO_ESCOLHA.fonte, color: colors.ink },
  campoVazio: { color: colors.ink3 },
  // o chevron do kit aponta para a direita: virado para baixo, é a seta do campo que abre
  seta: { transform: [{ rotate: '90deg' }] },
  folha: { gap: 4 },
  linha: { minHeight: CAMPO_ESCOLHA.linha, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  linhaOn: { backgroundColor: colors.accentSoft },
  linhaTexto: { flex: 1, ...fonte.body, fontSize: CAMPO_ESCOLHA.fonte, color: colors.ink },
  linhaTextoOn: { ...fonte.semibold },
  final: { flex: 1, ...fonte.semibold, fontSize: CAMPO_ESCOLHA.fonte, color: colors.accentInk },
});
