/**
 * T-0133 (RF-VEN-05): ações do detalhe do pedido/orçamento, com a ênfase na informação e não nos botões.
 * Spec: docs/design/pedido-v2.md §4.4.
 * - `RodapeAcoes`: rodapé compacto com 1 ação principal (botão de 52 dp, largura total; opcional) e as outras como ícone +
 *   rótulo curto numa linha só (até 4, alvo ≥ 48 dp cada):
 *     [ ↑ Transformar em pedido ]
 *      ✎ Editar    ▤ PDF    ⧉ Duplicar
 * - `MenuMais`: o ⋮ do cabeçalho, com uma folha de opções; a opção destrutiva (Cancelar orçamento) pede confirmação.
 * Nenhum texto fixo (tudo por props). Contraste: principal `onAccent` sobre `accent`; ícone + rótulo em `ink` (16,5:1);
 * desabilitado em `ink3` (5,8:1 no branco), sem transparência. Nenhum texto laranja.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { dividirAcoes, eventoDoMenu, MAX_ACOES_NA_LINHA, type EventoDoMenu, type PassoDoMenu } from './acoes';
import { Botao } from './base';
import { ALVO_TOQUE } from './componentes';
import { Dialogo, Folha, OpcaoFolha } from './folha';
import { Icon, type IconName } from './icon';
import { Pressionavel } from './movimento-rn';
import { colors, fonts } from './theme';

export interface AcaoCompacta {
  id: string;
  /** Rótulo curto, 1 palavra ("Editar", "PDF", "Duplicar"): `rotuloCurtoOk`. */
  rotulo: string;
  icone: IconName;
  onPress: () => void;
  desligado?: boolean;
  /** Leitura completa ("Editar orçamento", "Baixar o PDF do orçamento"). */
  rotuloAcessivel?: string;
  testID?: string;
}

export interface AcaoPrincipal {
  rotulo: string;
  icone?: IconName;
  onPress: () => void;
  desligado?: boolean;
  ocupado?: boolean;
  rotuloAcessivel?: string;
  /** Linha curta abaixo do botão (destino: "Vai direto ao ERP", "Vai para o supervisor"). */
  apoio?: string;
  testID?: string;
}

export function RodapeAcoes({
  principal,
  acoes,
  fixo = true,
  respiroInferior = 0,
  testID = 'rodape-acoes',
}: {
  /** A única ação grande da tela (orçamento: Transformar em pedido; rascunho: Continuar pedido). Sem ela, só a linha. */
  principal?: AcaoPrincipal | null;
  /** Ícone + rótulo curto, na ordem do módulo. Até 4 na linha; o que passar não aparece (ponha no `MenuMais`). */
  acoes: ReadonlyArray<AcaoCompacta>;
  /** Encostado no fim da tela, com fundo branco e traço em cima (padrão). `false` = no fim do conteúdo, sem fundo. */
  fixo?: boolean;
  /** Área segura de baixo, quando o rodapé encosta na borda da tela. */
  respiroInferior?: number;
  testID?: string;
}) {
  const { linha } = dividirAcoes(acoes, MAX_ACOES_NA_LINHA);
  if (!principal && linha.length === 0) return null;
  return (
    <View testID={testID} style={[s.rodape, fixo && s.rodapeFixo, fixo && { paddingBottom: 8 + respiroInferior }]}>
      {principal ? (
        <View style={s.principal}>
          <Botao
            nivel="principal"
            rotulo={principal.rotulo}
            icone={principal.icone}
            onPress={principal.onPress}
            desligado={principal.desligado}
            ocupado={principal.ocupado}
            rotuloAcessivel={principal.rotuloAcessivel ?? (principal.apoio ? `${principal.rotulo}. ${principal.apoio}` : undefined)}
            testID={principal.testID ?? `${testID}-principal`}
          />
          {principal.apoio ? (
            <Text style={s.apoio} numberOfLines={2} importantForAccessibility="no" accessibilityElementsHidden>
              {principal.apoio}
            </Text>
          ) : null}
        </View>
      ) : null}
      {linha.length > 0 ? (
        <View style={s.linha}>
          {linha.map((a) => {
            const cor = a.desligado ? colors.ink3 : colors.ink;
            return (
              <Pressionavel
                key={a.id}
                testID={a.testID ?? `${testID}-${a.id}`}
                accessibilityRole="button"
                accessibilityLabel={a.rotuloAcessivel ?? a.rotulo}
                accessibilityState={{ disabled: Boolean(a.desligado) }}
                disabled={a.desligado}
                onPress={a.onPress}
                style={s.acao}>
                <Icon name={a.icone} size={18} color={cor} strokeWidth={2.2} />
                <Text style={[s.acaoTexto, { color: cor }]} numberOfLines={1}>
                  {a.rotulo}
                </Text>
              </Pressionavel>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ---------- MenuMais (⋮) ----------
export interface OpcaoMenuMais {
  id: string;
  rotulo: string;
  icone: IconName;
  subtitulo?: string;
  /** Vermelho (Cancelar, Excluir). */
  perigo?: boolean;
  /** Pede confirmação antes de agir (diálogo; Voltar devolve à folha). Obrigatória no que não tem volta. */
  confirmacao?: { titulo: string; mensagem?: string; voltar: string; confirmar: string };
  onPress: () => void;
  testID?: string;
}

export function MenuMais({
  rotuloAcessivel,
  titulo,
  opcoes,
  rotuloFechar,
  rodape,
  testID = 'menu-mais',
}: {
  /** O botão ⋮ não tem texto: "Mais ações do orçamento". */
  rotuloAcessivel: string;
  /** Título da folha (opcional; ex.: "Orçamento 000012"). */
  titulo?: string;
  opcoes: ReadonlyArray<OpcaoMenuMais>;
  /** Leitura do fundo da folha (toque fora fecha). */
  rotuloFechar: string;
  /** Ação de texto no fim da folha ("Voltar"). */
  rodape: string;
  testID?: string;
}) {
  const [passo, setPasso] = useState<PassoDoMenu>({ tipo: 'fechado' });
  const disparar = (e: EventoDoMenu) => {
    const r = eventoDoMenu(passo, e);
    setPasso(r.passo);
    if (r.executar) opcoes.find((o) => o.id === r.executar)?.onPress();
  };
  const confirmando = passo.tipo === 'confirmando' ? opcoes.find((o) => o.id === passo.id) : undefined;
  if (opcoes.length === 0) return null;
  return (
    <>
      <Pressionavel
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={rotuloAcessivel}
        accessibilityState={{ expanded: passo.tipo !== 'fechado' }}
        escala={false}
        onPress={() => disparar({ tipo: 'abrir' })}
        style={s.mais}>
        <Icon name="mais" size={22} color={colors.ink} strokeWidth={2.4} />
      </Pressionavel>
      <Folha
        visivel={passo.tipo === 'aberto'}
        onFechar={() => disparar({ tipo: 'voltar' })}
        rotuloFechar={rotuloFechar}
        titulo={titulo}
        rotuloAcessivel={titulo ?? rotuloAcessivel}
        rodape={{ rotulo: rodape, onPress: () => disparar({ tipo: 'voltar' }), testID: `${testID}-voltar` }}
        testID={`${testID}-folha`}>
        {opcoes.map((o) => (
          <OpcaoFolha
            key={o.id}
            testID={o.testID ?? `${testID}-${o.id}`}
            icone={o.icone}
            tom={o.perigo ? 'perigo' : 'neutro'}
            titulo={o.rotulo}
            subtitulo={o.subtitulo}
            onPress={() => disparar({ tipo: 'escolher', id: o.id, comConfirmacao: Boolean(o.confirmacao) })}
          />
        ))}
      </Folha>
      {confirmando?.confirmacao ? (
        <Dialogo
          visivel
          titulo={confirmando.confirmacao.titulo}
          mensagem={confirmando.confirmacao.mensagem}
          cancelar={{ rotulo: confirmando.confirmacao.voltar, onPress: () => disparar({ tipo: 'voltar' }), testID: `${testID}-confirmar-voltar` }}
          confirmar={{ rotulo: confirmando.confirmacao.confirmar, onPress: () => disparar({ tipo: 'confirmar' }), testID: `${testID}-confirmar-ok` }}
          perigo={Boolean(confirmando.perigo)}
          testID={`${testID}-confirmar`}
        />
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  rodape: { gap: 4 },
  rodapeFixo: { paddingTop: 10, paddingHorizontal: 14, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  principal: { gap: 4 },
  // 12/16 ink2 (7,6:1 no branco), centralizado abaixo do principal
  apoio: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.ink2, textAlign: 'center' },
  linha: { flexDirection: 'row', alignItems: 'stretch' },
  // cada ação divide a largura; alvo de 48 dp de altura, ícone + rótulo numa linha
  acao: { flex: 1, minWidth: ALVO_TOQUE, minHeight: ALVO_TOQUE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 4 },
  acaoTexto: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 13 },
  mais: { width: ALVO_TOQUE, height: ALVO_TOQUE, alignItems: 'center', justifyContent: 'center' },
});
