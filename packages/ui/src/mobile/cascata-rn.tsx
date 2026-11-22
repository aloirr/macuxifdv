/**
 * Filtro de veículo (spec docs/design/filtro-veiculo/spec.md §4 e §11; desenho técnico docs/desenho/filtro-veiculo.md §6.2):
 * - `FolhaCascata`: folha de níveis (Montadora › Modelo › Ano › Motor › Versão) sobre a `Folha` do kit: busca no topo, trilha
 *   compacta do que já foi escolhido, Recentes, o rótulo do nível e as opções (linhas de 48 dp ou a grade do Ano), e o principal
 *   fixo no pé ("Ver peças"). Tocar avança; a troca de nível anda de lado em 240 ms (só troca com "reduzir movimento") e o foco
 *   do leitor de tela vai para o rótulo do novo nível. O Voltar do Android chama `onVoltar`.
 * - `GradeOpcoes`: grade de 4 colunas (o Ano), que quebra linha; nada de rolagem lateral.
 * Só apresentação: os níveis, as opções, o que se preenche sozinho, o último nível e os textos chegam por props (domain e tela do
 * módulo). Medidas, cores e regras de exibição em `cascata.ts` (puro, testado).
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';

import { Botao } from './base';
import { conteudoDaFolhaCascata, deslocamentoDoNivel, FOLHA_CASCATA, leituraDaOpcaoCascata, linhasDaGrade, mostrarRecentes, profundidadeDaCascata } from './cascata';
import { Folha } from './folha';
import { CampoBusca, RotuloSecao } from './formulario';
import { Icon } from './icon';
import { duracaoMovimento } from './movimento';
import { curvaPadrao, Pressionavel, useReduzirMovimento } from './movimento-rn';
import { Trilha } from './navegacao';
import { fonte } from './theme';
import { Loading } from './ui';

/** Um passo já escolhido, na trilha. `automatico` = preenchido sozinho (nível de uma opção só): `ink2`, sem toque. */
export interface PassoCascata {
  rotulo: string;
  automatico?: boolean;
  /** Volta àquele nível. */
  onPress: () => void;
  testID?: string;
}

/** Uma opção do nível. `apoio` vai embaixo em 14 `ink2` (a montadora na busca e nos Recentes); chevron só com `temProximo`. */
export interface OpcaoCascata {
  valor: string;
  rotulo: string;
  apoio?: string | null;
  temProximo: boolean;
  testID?: string;
}

/** Busca do 1º nível ("Modelo ou montadora"). Com texto, os resultados (ou a frase `vazio`) tomam o lugar da lista. */
export interface BuscaCascata {
  valor: string;
  placeholder: string;
  onMudar: (texto: string) => void;
  resultados: readonly OpcaoCascata[];
  /** Sem resultado: `Nenhum modelo com "xyz".` (o módulo monta com o texto). */
  vazio: string;
  /** Tocar num resultado (modelo leva ao Ano; montadora, ao Modelo: quem decide é o módulo). */
  onEscolher: (valor: string) => void;
  /** Leitura do × que limpa o texto; sem ela, sem ×. */
  rotuloLimpar?: string;
  testID?: string;
}

/** Recentes (até 3; sem nenhum, a seção não aparece). Tocar aplica e fecha (o módulo decide). */
export interface RecentesCascata {
  /** "Recentes". */
  rotulo: string;
  itens: readonly OpcaoCascata[];
  onEscolher: (valor: string) => void;
}

export function FolhaCascata({
  visivel,
  titulo,
  rotuloFechar,
  trilha,
  rotuloNivel,
  opcoes,
  grade,
  busca,
  recentes,
  rodape,
  carregando,
  onEscolher,
  onVoltar,
  onFechar,
  testID = 'cascata',
}: {
  visivel: boolean;
  /** "Veículo". */
  titulo: string;
  /** Leitura do ✕ (48 dp) e do fundo: "Fechar". */
  rotuloFechar: string;
  /** Só o que já foi escolhido, do mais geral ao mais fundo; vazia no 1º nível. */
  trilha: readonly PassoCascata[];
  /** "Montadora", "Modelo", "Ano", "Motor", "Versão" (cabeçalho; recebe o foco ao trocar de nível). */
  rotuloNivel: string;
  opcoes: readonly OpcaoCascata[];
  /** As opções numa grade de 4 colunas (o Ano). */
  grade?: boolean;
  busca?: BuscaCascata;
  recentes?: RecentesCascata;
  /** Principal fixo no pé ("Ver peças"), a partir do Ano; sem ele no último nível (tocar já aplica e fecha). */
  rodape?: { rotulo: string; onPress: () => void; testID?: string };
  /** O nível está carregando (passou de 300 ms): `Loading` embutido no lugar das opções. */
  carregando?: boolean;
  onEscolher: (valor: string) => void;
  /** Voltar do Android: volta um nível (no 1º, o módulo fecha). */
  onVoltar: () => void;
  /** ✕, toque fora: fecha sem mudar o veículo já aplicado. */
  onFechar: () => void;
  testID?: string;
}) {
  const reduzir = useReduzirMovimento();
  const profundidade = profundidadeDaCascata(trilha);
  const anterior = useRef(profundidade);
  const desloc = useRef(new Animated.Value(0)).current;
  const opacidade = useRef(new Animated.Value(1)).current;
  const rotuloRef = useRef<View>(null);

  // troca de nível: entra de lado (240 ms) e o foco vai para o rótulo do nível; com "reduzir movimento", só troca
  useEffect(() => {
    const de = deslocamentoDoNivel(anterior.current, profundidade, reduzir);
    const mudou = anterior.current !== profundidade;
    anterior.current = profundidade;
    if (!mudou) return;
    const duracao = duracaoMovimento('avancar', reduzir);
    if (de !== 0 && duracao > 0) {
      desloc.setValue(de);
      opacidade.setValue(FOLHA_CASCATA.avanco.opacidadeInicial);
      Animated.parallel([
        Animated.timing(desloc, { toValue: 0, duration: duracao, easing: curvaPadrao, useNativeDriver: true }),
        Animated.timing(opacidade, { toValue: 1, duration: duracao, easing: curvaPadrao, useNativeDriver: true }),
      ]).start();
    }
    if (rotuloRef.current) AccessibilityInfo.sendAccessibilityEvent(rotuloRef.current, 'focus');
  }, [profundidade, reduzir, desloc, opacidade]);

  // ao abrir, sem deslocamento sobrando de uma troca interrompida
  useEffect(() => {
    if (!visivel) return;
    desloc.setValue(0);
    opacidade.setValue(1);
  }, [visivel, desloc, opacidade]);

  const conteudo = conteudoDaFolhaCascata({ textoBusca: busca?.valor, resultados: busca?.resultados.length ?? 0, carregando, grade });
  const comRecentes = recentes && mostrarRecentes(busca?.valor, recentes.itens.length);

  return (
    <Folha
      visivel={visivel}
      onFechar={onFechar}
      onVoltar={onVoltar}
      rotuloFechar={rotuloFechar}
      titulo={titulo}
      fechar={{ rotulo: rotuloFechar, testID: `${testID}-fechar` }}
      rolavel
      evitarTeclado={Boolean(busca)}
      rodapeFixo={rodape ? <Botao nivel="principal" rotulo={rodape.rotulo} onPress={rodape.onPress} testID={rodape.testID ?? `${testID}-rodape`} /> : undefined}
      testID={testID}>
      {busca ? (
        <CampoBusca
          valor={busca.valor}
          onChange={busca.onMudar}
          placeholder={busca.placeholder}
          onLimpar={() => busca.onMudar('')}
          rotuloLimpar={busca.rotuloLimpar}
          testID={busca.testID ?? `${testID}-busca`}
        />
      ) : null}
      <Animated.View style={[s.meio, { opacity: opacidade, transform: [{ translateX: desloc }] }]}>
        {conteudo === 'busca' && busca ? (
          <ListaOpcoes opcoes={busca.resultados} onEscolher={busca.onEscolher} testID={`${testID}-resultados`} />
        ) : conteudo === 'buscaVazia' && busca ? (
          <Text style={s.vazio} accessibilityLiveRegion="polite" testID={`${testID}-vazio`}>
            {busca.vazio}
          </Text>
        ) : (
          <>
            {trilha.length > 0 ? (
              // o leitor lê os passos em ordem ("Volkswagen", "Gol", "2018"), cada um como botão; o automático, sem toque
              <Trilha
                itens={trilha.map((p, i) => ({ id: String(i), rotulo: p.rotulo, desligado: p.automatico, testID: p.testID ?? `${testID}-trilha-${i}` }))}
                onEscolher={(id) => trilha[Number(id)]?.onPress()}
                compacta
                semAtual
                rotuloAcessivel={(item) => item.rotulo}
                testID={`${testID}-trilha`}
              />
            ) : null}
            {comRecentes && recentes ? (
              <>
                <RotuloSecao texto={recentes.rotulo} />
                <ListaOpcoes opcoes={recentes.itens} onEscolher={recentes.onEscolher} testID={`${testID}-recentes`} />
              </>
            ) : null}
            <View ref={rotuloRef} accessible accessibilityRole="header" accessibilityLabel={rotuloNivel} collapsable={false}>
              <RotuloSecao texto={rotuloNivel} testID={`${testID}-nivel`} />
            </View>
            {conteudo === 'carregando' ? (
              <Loading embutido testID={`${testID}-carregando`} />
            ) : conteudo === 'grade' ? (
              <GradeOpcoes opcoes={opcoes} onEscolher={onEscolher} testID={`${testID}-grade`} />
            ) : (
              <ListaOpcoes opcoes={opcoes} onEscolher={onEscolher} testID={`${testID}-opcoes`} />
            )}
          </>
        )}
      </Animated.View>
    </Folha>
  );
}

/** Cartão branco com as linhas de opção (48 dp, traço `lineSoft` entre elas). */
function ListaOpcoes({ opcoes, onEscolher, testID }: { opcoes: readonly OpcaoCascata[]; onEscolher: (valor: string) => void; testID: string }) {
  if (opcoes.length === 0) return null;
  return (
    <View style={s.cartao} testID={testID}>
      {opcoes.map((o, i) => (
        <Pressionavel
          key={o.valor}
          testID={o.testID ?? `${testID}-${o.valor}`}
          accessibilityRole="button"
          accessibilityLabel={leituraDaOpcaoCascata(o)}
          onPress={() => onEscolher(o.valor)}
          style={[s.opcao, i > 0 && s.traco]}>
          <View style={s.opcaoTextos}>
            <Text style={s.opcaoNome} numberOfLines={2}>
              {o.rotulo}
            </Text>
            {o.apoio ? (
              <Text style={s.opcaoApoio} numberOfLines={1}>
                {o.apoio}
              </Text>
            ) : null}
          </View>
          {o.temProximo ? <Icon name="chevron" size={FOLHA_CASCATA.linha.seta.tamanho} color={FOLHA_CASCATA.linha.seta.cor} /> : null}
        </Pressionavel>
      ))}
    </View>
  );
}

/** Grade de escolha em colunas iguais (padrão 4, o Ano), que quebra linha: cada célula ocupa 1/4 da largura, sem rolagem lateral. */
export function GradeOpcoes({
  opcoes,
  onEscolher,
  colunas = FOLHA_CASCATA.grade.colunas,
  testID = 'grade',
}: {
  opcoes: ReadonlyArray<{ valor: string; rotulo: string; rotuloAcessivel?: string; testID?: string }>;
  onEscolher: (valor: string) => void;
  colunas?: number;
  testID?: string;
}) {
  return (
    <View style={s.grade} testID={testID}>
      {linhasDaGrade(opcoes, colunas).map((linha, i) => (
        <View key={i} style={s.gradeLinha}>
          {linha.map((o, j) =>
            o ? (
              <Pressionavel
                key={o.valor}
                testID={o.testID ?? `${testID}-${o.valor}`}
                accessibilityRole="button"
                accessibilityLabel={o.rotuloAcessivel ?? o.rotulo}
                onPress={() => onEscolher(o.valor)}
                style={s.celula}>
                <Text style={s.celulaTexto} numberOfLines={1}>
                  {o.rotulo}
                </Text>
              </Pressionavel>
            ) : (
              <View key={`vazio-${j}`} style={s.celulaVazia} />
            ),
          )}
        </View>
      ))}
    </View>
  );
}

const L = FOLHA_CASCATA.linha;
const C = FOLHA_CASCATA.cartao;
const G = FOLHA_CASCATA.grade;

const s = StyleSheet.create({
  meio: { gap: 8 },
  cartao: { backgroundColor: C.fundo, borderWidth: 1, borderColor: C.borda, borderRadius: C.raio, overflow: 'hidden' },
  opcao: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: FOLHA_CASCATA.linha.alturaMinima, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: C.fundo },
  traco: { borderTopWidth: 1, borderTopColor: C.traco },
  opcaoTextos: { flex: 1, minWidth: 0 },
  opcaoNome: { ...fonte.body, fontSize: L.nome.tamanho, color: L.nome.cor },
  opcaoApoio: { ...fonte.body, fontSize: L.apoio.tamanho, color: L.apoio.cor },
  vazio: { ...fonte.body, fontSize: FOLHA_CASCATA.vazio.tamanho, color: FOLHA_CASCATA.vazio.cor, paddingVertical: 8 },
  grade: { gap: G.vao },
  gradeLinha: { flexDirection: 'row', gap: G.vao },
  celula: { flex: 1, height: G.altura, borderRadius: G.raio, borderWidth: 1, borderColor: G.borda, backgroundColor: G.fundo, alignItems: 'center', justifyContent: 'center' },
  celulaVazia: { flex: 1, height: G.altura },
  celulaTexto: { ...fonte.semibold, fontSize: G.texto.tamanho, color: G.texto.cor, fontVariant: ['tabular-nums'] },
});
