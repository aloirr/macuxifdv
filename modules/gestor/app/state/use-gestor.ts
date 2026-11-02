/**
 * Hook das telas do Gestor: lê o cache do módulo (offline-first) e atualiza pela API quando há sinal.
 * Escritas (dispensar alerta) exigem conexão — o alerta pode ter mudado no servidor — e avisam com a ação seguinte.
 * O relógio vem de `@macuxi/comum/relogio` (nunca hora fixa).
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { DEFAULT_TZ } from '@macuxi/ui/mobile/puro';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alerta, FichaMembro, RankingEquipe, ROTAS_GESTOR, type IndicadorRanking, type PeriodoRanking } from '../../contracts';
import { atualizarCache, chaveRanking, criarCache, DADOS_VAZIOS, mensagemDeErro, type DadosGestor } from '../lib/cache';

const relogio = relogioReal();
export const PRECISA_SINAL = 'Sem conexão: esta ação precisa de internet. Tente de novo quando o sinal voltar.';

export function useGestor() {
  const { motor } = useMotorSync();
  const ambiente = useAmbiente();
  const cache = useMemo(() => (motor ? criarCache(motor.armazenamentoDoModulo('gestor')) : null), [motor]);
  const [dados, setDados] = useState<DadosGestor>(DADOS_VAZIOS);
  const [carregado, setCarregado] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const usuario = ambiente.usuario();
  const tz = usuario?.fuso ?? DEFAULT_TZ;
  const offline = !ambiente.online();

  const recarregar = useCallback(async () => {
    if (!cache) return;
    setDados(await cache.carregar());
    setCarregado(true);
  }, [cache]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const atualizar = useCallback(async () => {
    if (!cache || !ambiente.online()) return;
    setAtualizando(true);
    try {
      const r = await atualizarCache(ambiente.http, cache, () => relogio.agora());
      setErro(r.semConexao ? null : r.erro);
      await recarregar();
    } finally {
      setAtualizando(false);
    }
  }, [ambiente, cache, recarregar]);

  /** RF-GES-07: dispensar (online). Atualiza o alerta no cache com a resposta do servidor. */
  const dispensar = useCallback(
    async (id: string): Promise<{ ok: true } | { ok: false; mensagem: string }> => {
      if (!cache) return { ok: false, mensagem: 'Carregando…' };
      if (!ambiente.online()) return { ok: false, mensagem: PRECISA_SINAL };
      try {
        const a = Alerta.parse(await ambiente.http.requisitar<unknown>('POST', ROTAS_GESTOR.dispensarAlerta(id)));
        const atual = await cache.ler('alertas');
        if (atual) await cache.gravar('alertas', { ...atual, itens: atual.itens.map((x) => (x.id === a.id ? a : x)) });
        await recarregar();
        return { ok: true };
      } catch (e) {
        return { ok: false, mensagem: mensagemDeErro(e) };
      }
    },
    [ambiente, cache, recarregar],
  );

  /** RF-GES-02: ficha pela API; sem sinal, monta do cache da visão (o pedido em nome some offline). */
  const ficha = useCallback(
    async (id: string): Promise<{ ficha: FichaMembro | null; doCache: boolean; erro: string | null }> => {
      const doCache = (): FichaMembro | null => {
        const m = dados.visao?.membros.find((x) => x.membro.id === id);
        return m ? { ...m, pedido_em_nome: { visivel: false, permitido: false, codigo: null, mensagem: null } } : null;
      };
      if (!ambiente.online()) return { ficha: doCache(), doCache: true, erro: null };
      try {
        return { ficha: FichaMembro.parse(await ambiente.http.get<unknown>(ROTAS_GESTOR.ficha(id))), doCache: false, erro: null };
      } catch (e) {
        return { ficha: doCache(), doCache: true, erro: mensagemDeErro(e) };
      }
    },
    [ambiente, dados.visao],
  );

  /** RF-GES-03: ranking pela API (guarda o último de cada combinação para ver offline). */
  const ranking = useCallback(
    async (indicador: IndicadorRanking, periodo: PeriodoRanking): Promise<{ ranking: RankingEquipe | null; erro: string | null }> => {
      const k = chaveRanking(indicador, periodo);
      const guardado = (await cache?.ler('rankings'))?.[k] ?? null;
      if (!cache || !ambiente.online()) return { ranking: guardado, erro: null };
      try {
        const r = RankingEquipe.parse(await ambiente.http.get<unknown>(ROTAS_GESTOR.ranking, { indicador, periodo }));
        await cache.gravar('rankings', { ...(await cache.ler('rankings')), [k]: r });
        return { ranking: r, erro: null };
      } catch (e) {
        return { ranking: guardado, erro: mensagemDeErro(e) };
      }
    },
    [ambiente, cache],
  );

  return { ...dados, usuarioId: usuario?.id ?? null, carregado, atualizando, erro, offline, tz, atualizar, dispensar, ficha, ranking };
}
