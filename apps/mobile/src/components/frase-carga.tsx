/**
 * T-0174 (spec docs/design/carga-aviso-frases/spec.md §1 itens 3 e 4, §1.1 e §2; ajuste R-20261115-080500): o bloco
 * "Você sabia?" da tela de carga, abaixo do "Olá" (o lugar e as linhas são da `TelaEntrada`, por `cabeFrase`).
 * - Título: lâmpada de 16 dp do kit em `preenchimento` (gráfico) e, 6 dp depois, "Você sabia?" em Plex SemiBold 13/18 em
 *   `texto`; 20 dp abaixo do "Olá".
 * - Frase: 6 dp abaixo, Plex 14/20 em `textoClaro`, centralizada, até 280 dp, 2 linhas (ou 1, quando a tela é baixa e a frase
 *   cabe inteira). Sem aspas, sem itálico. A fonte da frase NUNCA aparece (nem chega ao app).
 * - Leitor de tela: título e frase lidos juntos, "Você sabia? {frase}"; a lâmpada é decorativa.
 * `useFraseDaCarga`: uma frase por carga, sorteada quando a tela monta, entre as ativas da lista do aparelho (ou as 30 do
 * bundle), sem repetir a última (o aparelho guarda só o id dela). Não troca durante a carga.
 */
import { fonts, Icon, temaDaEntrada } from '@macuxi/ui/mobile';
import { MEDIDAS_FRASE_CARGA } from '@macuxi/ui/mobile/puro';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  CHAVE_FRASES_CARGA,
  CHAVE_ULTIMA_FRASE_CARGA,
  frasesDoAparelho,
  sortearFrase,
  type FraseSorteavel,
} from '@/lib/frase-sorteio';
import type { Variante } from '@/lib/variante-tipo';
import { readJson, writeJson } from '@/services/storage';

export const TITULO_FRASE_CARGA = 'Você sabia?';

export function FraseCarga({ variante, texto, linhas }: { variante: Variante; texto: string; linhas: 1 | 2 }) {
  const tema = temaDaEntrada(variante);
  return (
    <View testID="carga-frase" style={styles.bloco} accessible accessibilityLabel={`${TITULO_FRASE_CARGA} ${texto}`}>
      <View style={styles.titulo}>
        <Icon name="lampada" size={titulo.lampada} color={tema.preenchimento} />
        <Text style={[styles.textoTitulo, { color: tema.texto }]}>{TITULO_FRASE_CARGA}</Text>
      </View>
      <Text testID="carga-frase-texto" numberOfLines={linhas} style={[styles.frase, { color: tema.textoClaro }]}>
        {texto}
      </Text>
    </View>
  );
}

/**
 * A frase desta carga: sorteada uma vez, quando a tela monta (lê a lista e o id da última no aparelho e grava o id da
 * sorteada). `null` enquanto lê e quando não há nenhuma ativa (o bloco não aparece).
 */
export function useFraseDaCarga(rnd: () => number = Math.random): FraseSorteavel | null {
  const [frase, setFrase] = useState<FraseSorteavel | null>(null);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [lista, ultima] = await Promise.all([
        readJson<FraseSorteavel[]>(CHAVE_FRASES_CARGA),
        readJson<string>(CHAVE_ULTIMA_FRASE_CARGA),
      ]);
      const sorteada = sortearFrase(frasesDoAparelho(Array.isArray(lista) ? lista : null), ultima, rnd);
      if (!vivo) return;
      setFrase(sorteada);
      if (sorteada) await writeJson(CHAVE_ULTIMA_FRASE_CARGA, sorteada.id);
    })().catch(() => undefined);
    return () => {
      vivo = false;
    };
    // uma vez por montagem: a frase não troca durante a carga
  }, []);
  return frase;
}

const { titulo, frase } = MEDIDAS_FRASE_CARGA;
const styles = StyleSheet.create({
  bloco: { marginTop: titulo.abaixoDoOla, alignItems: 'center', gap: titulo.ateFrase },
  titulo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: titulo.lampadaAoTexto },
  textoTitulo: { fontFamily: fonts[titulo.fonte], fontSize: titulo.tamanho, lineHeight: titulo.linha },
  frase: {
    fontFamily: fonts[frase.fonte],
    fontSize: frase.tamanho,
    lineHeight: frase.linha,
    maxWidth: frase.larguraMax,
    textAlign: 'center',
  },
});
