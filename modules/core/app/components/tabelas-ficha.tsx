/**
 * Tabelas da ficha do cliente (T-0186, spec §3): toda lista é tabela com cabeçalho, no padrão da tabela de itens do Novo pedido.
 * Cartão com cabeçalho 12/600 em ink2, linhas de no mínimo 48 dp com fio entre elas, 4 dp entre colunas e 8 dp nas bordas; números
 * tabulares e à direita, sem "R$" na célula; texto longo quebra em duas linhas (sem reticências). Pares rótulo-valor: rótulo 14 em
 * ink2 à esquerda, valor 16 à direita.
 */
import { colors, fonte, Icon, type IconName } from '@macuxi/ui/mobile';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { LinhaRotuloValor } from '../lib/ficha-v2';

export function TabelaRotuloValor({ linhas, larguraRotulo = 136, testID }: { linhas: readonly LinhaRotuloValor[]; larguraRotulo?: number; testID?: string }) {
  return (
    <View style={s.cartao} testID={testID}>
      {linhas.map((l, i) => (
        <View key={l.rotulo} style={[s.linhaRV, i > 0 && s.traco]} accessible accessibilityLabel={`${l.rotulo}: ${l.valor}`} testID={l.testID}>
          <Text style={[s.rotulo, { width: larguraRotulo }]}>{l.rotulo}</Text>
          <Text style={[s.valor, l.perigo && { color: colors.danger }]}>{l.valor || '—'}</Text>
        </View>
      ))}
    </View>
  );
}

export interface ColunaFicha {
  id: string;
  titulo: string;
  /** dp fixos; sem largura, a coluna divide o que sobra. */
  largura?: number;
  alinhar?: 'esq' | 'dir' | 'centro';
}

export type LinhaFicha =
  | { tipo: 'faixa'; key: string; texto: string }
  | {
      tipo: 'linha';
      key: string;
      /** Uma célula por coluna, na ordem. */
      celulas: ReactNode[];
      onPress?: () => void;
      /** Fundo e fio vermelho à esquerda (NF em atraso). */
      perigo?: boolean;
      rotulo?: string;
      testID?: string;
    };

const alinhamento = { esq: 'flex-start', dir: 'flex-end', centro: 'center' } as const;
const estiloColuna = (c: ColunaFicha) => (c.largura ? { width: c.largura } : { flex: 1, minWidth: 0 });

export function TabelaFicha({ colunas, linhas, testID }: { colunas: readonly ColunaFicha[]; linhas: readonly LinhaFicha[]; testID?: string }) {
  return (
    <View style={s.cartao} testID={testID}>
      <View style={s.cabecalho}>
        {colunas.map((c) => (
          <Text key={c.id} style={[s.cab, estiloColuna(c), { textAlign: c.alinhar === 'dir' ? 'right' : c.alinhar === 'centro' ? 'center' : 'left' }]}>
            {c.titulo}
          </Text>
        ))}
      </View>
      {linhas.map((l) =>
        l.tipo === 'faixa' ? (
          <View key={l.key} style={s.faixa}>
            <Text style={s.faixaTexto} accessibilityRole="header">
              {l.texto}
            </Text>
          </View>
        ) : (
          <Pressable
            key={l.key}
            testID={l.testID}
            disabled={!l.onPress}
            accessibilityRole={l.onPress ? 'button' : undefined}
            accessibilityLabel={l.rotulo}
            accessible={Boolean(l.rotulo)}
            onPress={l.onPress}
            style={({ pressed }) => [s.linha, s.traco, l.perigo && s.perigo, pressed && { opacity: 0.7 }]}>
            {colunas.map((c, i) => (
              <View key={c.id} style={[estiloColuna(c), { alignItems: alinhamento[c.alinhar ?? 'esq'] }]}>
                {l.celulas[i]}
              </View>
            ))}
          </Pressable>
        ),
      )}
    </View>
  );
}

/** Célula de texto: a linha principal 14/600 e, quando houver, a segunda linha 12 em ink2 (ou vermelha). */
export function CelulaTexto({ principal, segunda, perigoSegunda, dir, mono, sublinhado, mudo, testID }: { principal: string; segunda?: string | null; perigoSegunda?: boolean; dir?: boolean; mono?: boolean; sublinhado?: boolean; mudo?: boolean; testID?: string }) {
  return (
    <View style={{ alignItems: dir ? 'flex-end' : 'flex-start' }}>
      <Text style={[s.principal, dir && s.num, mono && s.mono, sublinhado && s.link, mudo && { color: colors.ink2 }]} testID={testID}>
        {principal}
      </Text>
      {segunda ? <Text style={[s.segunda, dir && { textAlign: 'right' }, perigoSegunda && { color: colors.danger }]}>{segunda}</Text> : null}
    </View>
  );
}

/** Botão de ícone da célula (ligar, WhatsApp, mapa, abrir): alvo de 48 dp. */
export function BotaoCelula({ icone, rotulo, onPress, desligado, testID }: { icone: IconName; rotulo: string; onPress?: () => void; desligado?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={rotulo} accessibilityState={{ disabled: Boolean(desligado) }} disabled={desligado} onPress={onPress} hitSlop={2} style={({ pressed }) => [s.botao, pressed && { opacity: 0.7 }]}>
      <Icon name={icone} size={20} color={desligado ? colors.ink3 : colors.ink} strokeWidth={1.9} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  cartao: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  traco: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  linhaRV: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 48 },
  rotulo: { ...fonte.body, fontSize: 14, color: colors.ink2 },
  valor: { ...fonte.body, flex: 1, fontSize: 16, lineHeight: 21, color: colors.ink, textAlign: 'right', fontVariant: ['tabular-nums'] },
  cabecalho: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 6, alignItems: 'flex-end' },
  cab: { ...fonte.semibold, fontSize: 12, color: colors.ink2 },
  faixa: { paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.ground, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  faixaTexto: { ...fonte.semibold, fontSize: 12, letterSpacing: 0.6, color: colors.ink2 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, minHeight: 48 },
  perigo: { backgroundColor: colors.dangerBg, borderLeftWidth: 3, borderLeftColor: colors.danger },
  principal: { ...fonte.semibold, fontSize: 14, lineHeight: 19, color: colors.ink },
  segunda: { ...fonte.body, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  num: { fontVariant: ['tabular-nums'] },
  mono: { ...fonte.mono, fontSize: 12 },
  link: { color: colors.accentInk, textDecorationLine: 'underline' },
  botao: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
