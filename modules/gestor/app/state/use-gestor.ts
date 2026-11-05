/**
 * Hook das telas do Gestor: lê o cache do módulo (offline-first). RN-CORE-23: a tela NÃO consulta a API sozinha nem tem
 * timer — quem atualiza é o motor de sync da plataforma (etapa `gestor-equipe`), no ritmo do shell (`sync_auto_min`, ao
 * abrir o app e ao voltar ao primeiro plano); "puxar para baixo" = Sincronizar (`motor.sincronizar()`). O hook relê o
 * cache quando o motor termina uma sincronização. Ficha e ranking buscam a API só quando o usuário abre a tela (sob
 * demanda, nunca em ciclo). Escritas (dispensar alerta) exigem conexão e avisam com a ação seguinte.
 */
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { DEFAULT_TZ } from '@macuxi/ui/mobile/puro';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alerta, FichaMembro, RankingEquipe, ROTAS_GESTOR, type IndicadorRanking, type PeriodoRanking } from '../../contracts';
import { aplicarParadoMinDoTenant } from '../lib/parado-min';
import { chaveRanking, criarCache, DADOS_VAZIOS, mensagemDeErro, type DadosGestor } from '../lib/cache';

export const PRECISA_SINAL = 'Sem conexão: esta ação precisa de internet. Tente de novo quando o sinal voltar.';

export function useGestor() {
  const { motor, estado } = useMotorSync();
  const ambiente = useAmbiente();
  const cache = useMemo(() => (motor ? criarCache(motor.armazenamentoDoModulo('gestor')) : null), [motor]);
  const [dados, setDados] = useState<DadosGestor>(DADOS_VAZIOS);
  const [carregado, setCarregado] = useState(false);
  const usuario = ambiente.usuario();
  const tz = usuario?.fuso ?? DEFAULT_TZ;
  const offline = !ambiente.online();

  const recarregar = useCallback(async () => {
    if (!cache) return;
    const d = await cache.carregar();
    // RN-CORE-26: o `inicio.parado_min` do tenant (pull `parametro` do Core) vence o valor da visão do Gestor
    const linhas = motor ? await motor.linhas<{ id: string; modulo: string; chave: string; valor: unknown; deleted_at?: string | null }>('parametro').catch(() => []) : [];
    setDados({ ...d, visao: aplicarParadoMinDoTenant(d.visao, linhas) });
    setCarregado(true);
  }, [cache, motor]);

  // relê o cache ao montar e sempre que o motor conclui uma sincronização (a etapa do Gestor gravou dados novos)
  useEffect(() => {
    void recarregar();
  }, [recarregar, estado.sincronizado_em]);

  /** RN-CORE-23: puxar para baixo = Sincronizar (motor, trava de 30 s); relê o cache a cada sincronização. */
  const auto = useAtualizacaoAutomatica({ atualizar: recarregar, tz });

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

  return { ...dados, usuarioId: usuario?.id ?? null, carregado, sincronizando: estado.sincronizando, erro: estado.erro, offline, tz, auto, dispensar, ficha, ranking };
}
