/**
 * Termo de ciência do rastreamento (T-0156; spec `docs/design/tracking/spec.md` §1; RN-CORE-13). Abre depois do login e da carga quando o
 * rastreamento está ligado e falta o aceite da versão vigente, a cada abertura do app até o "Li e estou ciente". O app segue usável sem o
 * aceite (só não grava trajeto). "Agora não" e o voltar fecham sem gravar nada. Só leitura (`?leitura=1`, vindo do Perfil): sem rodapé, com
 * "Meu trajeto" como link. O texto é o documento legal da empresa: não se corta, resume nem reescreve.
 * testIDs: `termo-rastreamento.tela|texto|aceitar|agora-nao|link-trajeto`.
 */
import { zonedParts } from '@macuxi/comum/fuso';
import { Botao, colors, EstadoVazio, fonte, Loading, Screen, type as t } from '@macuxi/ui/mobile';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useRastreamento } from '../../lib/usar-rastreamento';
import { blocosDoTermo, partesComLinkDoTrajeto, type ParteDoTermo } from '../../lib/termo-texto';

const dd = (n: number) => String(n).padStart(2, '0');
const dataBr = (iso: string, fuso: string) => {
  const p = zonedParts(iso, fuso);
  return `${dd(p.day)}/${dd(p.month)}/${p.year}`;
};
const dataHoraBr = (iso: string, fuso: string) => `${dataBr(iso, fuso)} ${dd(zonedParts(iso, fuso).hour)}:${dd(zonedParts(iso, fuso).minute)}`;

function Partes({ partes, leitura }: { partes: readonly ParteDoTermo[]; leitura: boolean }) {
  return (
    <Text style={t.body}>
      {partes.map((p, i) =>
        leitura && !p.negrito ? (
          partesComLinkDoTrajeto(p.texto).map((q, j) =>
            q.link ? (
              <Text key={`${i}.${j}`} style={styles.link} accessibilityRole="link" onPress={() => router.navigate('/m/meu-trajeto' as never)} testID="termo-rastreamento.link-trajeto">
                {q.texto}
              </Text>
            ) : (
              <Text key={`${i}.${j}`}>{q.texto}</Text>
            ),
          )
        ) : (
          <Text key={i} style={p.negrito ? styles.negrito : undefined}>
            {p.texto}
          </Text>
        ),
      )}
    </Text>
  );
}

export function TelaTermoRastreamento() {
  const params = useLocalSearchParams<{ leitura?: string }>();
  const r = useRastreamento();
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!r.carregado) return <Loading testID="termo-rastreamento.carregando" />;
  if (!r.termo) {
    return (
      <Screen testID="termo-rastreamento.tela" cabecalho={{ titulo: 'Localização no expediente', voltar: { label: 'Perfil', fallback: '/profile' } }}>
        <EstadoVazio icone="file" titulo="Nenhum termo publicado" testID="termo-rastreamento.vazio" />
      </Screen>
    );
  }
  const leitura = params.leitura === '1' || r.situacao !== 'pendente';
  const subtitulo = leitura ? `Versão ${r.termo.versao}${r.aceitoEm ? ` · ciente em ${dataHoraBr(r.aceitoEm, r.fuso)}` : ''}` : `Termo de ciência · versão ${r.termo.versao} · ${dataBr(r.termo.publicado_em, r.fuso)}`;
  const fechar = () => (router.canGoBack() ? router.back() : router.navigate('/' as never));
  const aceitar = async () => {
    setGravando(true);
    setErro(null);
    try {
      await r.aceitar();
      fechar();
    } catch {
      setErro('Não deu para registrar a sua ciência. Toque em "Li e estou ciente" para tentar de novo.');
    } finally {
      setGravando(false);
    }
  };
  const blocos = blocosDoTermo(r.termo.texto);

  return (
    <View style={styles.tela}>
      <Screen testID="termo-rastreamento.tela" cabecalho={{ titulo: 'Localização no expediente', subtitulo, ...(leitura ? { voltar: { label: 'Perfil', fallback: '/profile' } } : {}) }}>
        <View style={styles.texto} testID="termo-rastreamento.texto">
          {blocos.map((b, i) =>
            b.tipo === 'item' ? (
              <View key={i} style={styles.item}>
                <Text style={[t.body, styles.marcador]}>•</Text>
                <View style={styles.itemTexto}>
                  <Partes partes={b.partes} leitura={leitura} />
                </View>
              </View>
            ) : (
              <Partes key={i} partes={b.partes} leitura={leitura} />
            ),
          )}
        </View>
      </Screen>
      {leitura ? null : (
        <View style={styles.rodape}>
          {erro ? (
            <Text style={styles.erro} accessibilityLiveRegion="polite" testID="termo-rastreamento.erro">
              {erro}
            </Text>
          ) : null}
          <Botao rotulo="Li e estou ciente" nivel="principal" ocupado={gravando} onPress={() => void aceitar()} testID="termo-rastreamento.aceitar" />
          <Botao rotulo="Agora não" nivel="neutro" onPress={fechar} testID="termo-rastreamento.agora-nao" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1, backgroundColor: colors.ground },
  texto: { gap: 12 },
  item: { flexDirection: 'row', gap: 8 },
  marcador: { width: 12 },
  itemTexto: { flex: 1 },
  negrito: { ...fonte.bold },
  link: { color: colors.accentInk, textDecorationLine: 'underline' },
  rodape: { gap: 8, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  erro: { ...fonte.body, fontSize: 14, color: colors.danger },
});
