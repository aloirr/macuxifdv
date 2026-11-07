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
 * (`definirResolvedorMiniatura`), que devolve uma URL absoluta utilizável (ex.: assinada); sem resolvedor fica vazio.
 */
import { useAmbiente } from '@macuxi/platform-sdk/react';
import { colors } from '@macuxi/ui/mobile';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dimensions, Image, StyleSheet, View } from 'react-native';
import type { MiniaturaProduto as Miniatura } from '../../contracts';
import type { LeitorLocal } from '../lib/local';
import { miniaturasLocais } from '../lib/miniatura-local';
import { chaveMiniatura, criarCacheMiniaturas, estaNaJanela, miniaturaNoTeto, type ResultadoDownload } from '../lib/miniatura';

/** Lado da caixa da miniatura na lista, em dp. */
export const LADO_CAIXA_MINIATURA = 56;
const INTERVALO_MEDICAO_MS = 350;
const FOLGA_JANELA_DP = 160;
const TENTATIVAS_MAX = 3;

/** Shell: transforma a referência relativa (`/v1/arquivos/<id>`) numa URL absoluta baixável; `null` = não consegue. */
export type ResolvedorMiniatura = (url: string, m: Miniatura) => string | null | Promise<string | null>;
let resolvedor: ResolvedorMiniatura | null = null;
export function definirResolvedorMiniatura(r: ResolvedorMiniatura | null): void {
  resolvedor = r;
}

const absoluta = (u: string) => /^https?:\/\//i.test(u);
async function urlBaixavel(m: Miniatura): Promise<string | null> {
  if (absoluta(m.url)) return m.url;
  return resolvedor ? resolvedor(m.url, m) : null;
}

/** Baixador padrão do RN. Falha silenciosa: devolve 'falhou' e o item fica vazio. */
export async function baixarMiniaturaPadrao(_produtoId: string, m: Miniatura): Promise<ResultadoDownload> {
  try {
    const uri = await urlBaixavel(m);
    if (!uri || !absoluta(uri)) return 'falhou';
    const cabecalho = await fetch(uri, { method: 'HEAD' });
    if (!cabecalho.ok) return 'falhou';
    const tamanho = Number(cabecalho.headers.get('content-length'));
    if (!Number.isFinite(tamanho) || tamanho <= 0) return 'falhou';
    if (tamanho > m.bytes_max) return 'grande';
    return (await Image.prefetch(uri)) ? 'ok' : 'falhou';
  } catch {
    return 'falhou';
  }
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
export function MiniaturaProduto({ produtoId, miniatura, lado = LADO_CAIXA_MINIATURA }: { produtoId: string; miniatura: Miniatura | null | undefined; lado?: number }) {
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
    <View ref={caixa} collapsable={false} style={[s.caixa, { width: lado, height: lado }]} testID={`miniatura-${produtoId}`} accessible={false} importantForAccessibility="no-hide-descendants">
      {uri ? <Image source={{ uri }} style={{ width: lado, height: lado }} resizeMode="cover" accessible={false} fadeDuration={0} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  caixa: { borderRadius: 8, backgroundColor: colors.lineSoft, overflow: 'hidden' },
});
