/**
 * Miniatura do produto na lista e na busca (T-0097). A foto não vem no pull: o contrato traz só a referência
 * (`produto_conteudo.miniatura`) e ela é baixada SOB DEMANDA, quando o item está visível, com concorrência limitada
 * (`lib/miniatura.ts`). A caixa tem tamanho fixo (a lista não pula quando a foto chega); sem sinal, em falha ou acima do
 * teto, fica o espaço vazio e a lista segue normal. A imagem é decorativa (`accessible={false}`): o nome do produto já
 * está no texto do cartão.
 *
 * Observador compartilhado: não há `onScroll` na `Screen`, então um único temporizador mede (`measureInWindow`) só os
 * itens PENDENTES (ainda não baixados) e para quando não há nenhum. Item que sai da janela é tirado da fila.
 *
 * Download: URL absoluta http(s) → HEAD (confere `content-length` ≤ `bytes_max`) + `Image.prefetch` (cache de disco
 * nativo). URL relativa (`/v1/arquivos/<id>`, autenticada) só baixa se o shell injetar um resolvedor
 * (`definirResolvedorMiniatura`), que devolve URL http(s) ou file:// (cache local do app, aceito sem HEAD); sem resolvedor fica vazio.
 */
import { useAmbiente } from '@macuxi/platform-sdk/react';
import { colors } from '@macuxi/ui/mobile';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dimensions, Image, StyleSheet, View } from 'react-native';
import type { MiniaturaProduto as Miniatura } from '../../contracts';
import type { LeitorLocal } from '../lib/local';
import { miniaturasLocais } from '../lib/miniatura-local';
import { baixarMiniatura, definirResolvedorMiniatura, urlBaixavel, type ResolvedorMiniatura } from '../lib/miniatura-resolvedor';
import { chaveMiniatura, criarCacheMiniaturas, estaNaJanela, miniaturaNoTeto, type ResultadoDownload } from '../lib/miniatura';

/** Lado da caixa da miniatura na lista, em dp. */
export const LADO_CAIXA_MINIATURA = 56;
const INTERVALO_MEDICAO_MS = 350;
const FOLGA_JANELA_DP = 160;
const TENTATIVAS_MAX = 3;

export { definirResolvedorMiniatura, type ResolvedorMiniatura };

/** Baixador padrão do RN. Falha silenciosa: devolve 'falhou' e o item fica vazio. */
export function baixarMiniaturaPadrao(_produtoId: string, m: Miniatura): Promise<ResultadoDownload> {
  return baixarMiniatura(m, { fetch: (u, i) => fetch(u, i), prefetch: (u) => Image.prefetch(u) });
}

let fonteOnline: () => boolean = () => false;
const cache = criarCacheMiniaturas({ baixar: baixarMiniaturaPadrao, online: () => fonteOnline(), concorrencia: 3, capacidade: 300 });
/** Só para teste/shell: troca o baixador (ex.: com cache próprio). */
export const cacheDeMiniaturas = cache;

// ---------- observador compartilhado ----------
interface Observado {
  produtoId: string;
  m: Miniatura;
  caixa: React.RefObject<View | null>;
  tentativas: number;
}
const pendentes = new Map<string, Observado>();
let temporizador: ReturnType<typeof setInterval> | null = null;

function medir() {
  if (pendentes.size === 0) return pararSePreciso();
  const alturaJanela = Dimensions.get('window').height;
  for (const [chave, o] of [...pendentes]) {
    const estado = cache.estado(o.produtoId, o.m);
    if (estado === 'pronta' || estado === 'grande') {
      pendentes.delete(chave);
      continue;
    }
    if (!fonteOnline() || o.tentativas >= TENTATIVAS_MAX) {
      pendentes.delete(chave); // sem sinal ou desistiu: fica vazio
      continue;
    }
    o.caixa.current?.measureInWindow((_x, y, _l, altura) => {
      if (!pendentes.has(chave)) return;
      if (estaNaJanela({ y, altura }, alturaJanela, FOLGA_JANELA_DP)) {
        if (cache.estado(o.produtoId, o.m) === 'vazia') {
          o.tentativas++;
          cache.pedir(o.produtoId, o.m);
        }
      } else {
        cache.esquecer(o.produtoId);
      }
    });
  }
  pararSePreciso();
}
function pararSePreciso() {
  if (pendentes.size === 0 && temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
}
function observar(chave: string, o: Observado) {
  pendentes.set(chave, o);
  // timer-permitido: observador de visibilidade da miniatura na tela (T-0097), só com itens pendentes e parado sem nenhum; não sincroniza
  if (!temporizador) temporizador = setInterval(medir, INTERVALO_MEDICAO_MS);
  setTimeout(medir, 0); // primeira medição sem esperar o intervalo
}
function deixarDeObservar(chave: string, produtoId: string) {
  pendentes.delete(chave);
  cache.esquecer(produtoId);
  pararSePreciso();
}

// ---------- leitura local ----------
const SEM_MINIATURAS: ReadonlyMap<string, Miniatura> = new Map();
/**
 * Miniaturas dos itens exibidos, lidas do aparelho DEPOIS que a lista chega (não bloqueia a lista). `refazer` muda a cada
 * sync (ex.: `sync.sincronizado_em`). Sem motor ou com falha: mapa vazio.
 */
export function useMiniaturasDosItens(motor: LeitorLocal | null | undefined, ids: readonly string[], refazer: unknown): ReadonlyMap<string, Miniatura> {
  const [mapa, setMapa] = useState<ReadonlyMap<string, Miniatura>>(SEM_MINIATURAS);
  const chaveIds = ids.join(',');
  useEffect(() => {
    if (!motor || ids.length === 0) {
      setMapa(SEM_MINIATURAS);
      return;
    }
    let vivo = true;
    miniaturasLocais(motor, ids)
      .then((m) => vivo && setMapa(m))
      .catch(() => vivo && setMapa(SEM_MINIATURAS));
    return () => {
      vivo = false;
    };
  }, [motor, chaveIds, refazer]);
  return mapa;
}

// ---------- componente ----------
/** Caixa fixa da miniatura. `miniatura` nula (produto sem foto) mantém o espaço, para o texto alinhar. */
export function MiniaturaProduto({
  produtoId,
  miniatura,
  lado = LADO_CAIXA_MINIATURA,
  altura,
  reserva,
}: {
  produtoId: string;
  miniatura: Miniatura | null | undefined;
  lado?: number;
  /** Grade (T-0173): caixa de largura total e esta altura, com `reserva` (ícone ou inicial) enquanto a foto não chega ou não existe. */
  altura?: number;
  reserva?: React.ReactNode;
}) {
  const ambiente = useAmbiente();
  const caixa = useRef<View | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const valida = miniaturaNoTeto(miniatura) ? miniatura : null;
  fonteOnline = () => ambiente.online();
  const estado = useSyncExternalStore(
    cache.assinar,
    () => cache.estado(produtoId, valida),
    () => 'vazia' as const,
  );
  const chave = valida ? chaveMiniatura(produtoId, valida) : '';
  useEffect(() => {
    if (!valida || cache.estado(produtoId, valida) === 'pronta') return;
    observar(chave, { produtoId, m: valida, caixa, tentativas: 0 });
    return () => deixarDeObservar(chave, produtoId);
  }, [chave]);
  useEffect(() => {
    let vivo = true;
    if (valida && estado === 'pronta') void urlBaixavel(valida).then((u) => vivo && setUri(u));
    else setUri(null);
    return () => {
      vivo = false;
    };
  }, [chave, estado]);
  return (
    <View ref={caixa} collapsable={false} style={[s.caixa, altura ? { width: '100%', height: altura, borderRadius: 12, backgroundColor: colors.neutralBg, alignItems: 'center', justifyContent: 'center' } : { width: lado, height: lado }]} testID={`miniatura-${produtoId}`} accessible={false} importantForAccessibility="no-hide-descendants">
      {uri ? <Image source={{ uri }} style={altura ? { width: '100%', height: altura } : { width: lado, height: lado }} resizeMode="cover" accessible={false} fadeDuration={0} /> : (reserva ?? null)}
    </View>
  );
}

const s = StyleSheet.create({
  caixa: { borderRadius: 8, backgroundColor: colors.lineSoft, overflow: 'hidden' },
});
