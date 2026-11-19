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
import { relogioReal } from '@macuxi/comum/relogio';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { alertasDePendenciaCheckout, type NotificacaoPendencia } from '../../domain/alertas-pendencia-checkout';
import { corpoDaDecisao, ROTA_DA_DECISAO, Alerta, FichaMembro, RankingEquipe, ROTAS_GESTOR, type IndicadorRanking, type MotivoAprovacao, type PeriodoRanking } from '../../contracts';
import { aplicarParadoMinDoTenant } from '../lib/parado-min';
import { filaAposDecisao, type AcaoDeDecisao } from '../lib/decisao';
import { chaveRanking, criarCache, DADOS_VAZIOS, mensagemDeErro, type DadosGestor } from '../lib/cache';

const relogio = relogioReal();
export const SEM_SINAL_PARA_DISPENSAR = 'Sem sinal para dispensar';

/** `pendencias: true` só na aba Alertas: as demais telas não leem as notificações do SQLite (T-0039 G1). */
export function useGestor(opcoes: { pendencias?: boolean } = {}) {
  const lerPendencias = opcoes.pendencias === true;
  const { motor, estado } = useMotorSync();
  const ambiente = useAmbiente();
  const cache = useMemo(() => (motor ? criarCache(motor.armazenamentoDoModulo('gestor')) : null), [motor]);
  const [dados, setDados] = useState<DadosGestor>(DADOS_VAZIOS);
  const [carregado, setCarregado] = useState(false);
  const [notificacoes, setNotificacoes] = useState<NotificacaoPendencia[]>([]);
  const usuario = ambiente.usuario();
  const tz = usuario?.fuso ?? DEFAULT_TZ;
  const offline = !ambiente.online();

  const recarregar = useCallback(async () => {
    if (!cache) return;
    const d = await cache.carregar();
    // RN-CORE-26: o `inicio.parado_min` do tenant (pull `parametro` do Core) vence o valor da visão do Gestor
    const linhas = motor ? await motor.linhas<{ id: string; updated_at: string; deleted_at: string | null; modulo: string; chave: string; valor: unknown }>('parametro').catch(() => []) : [];
    // T-0039 §4.3: a notificação do Core (pull `notificacao`) já está no aparelho; o Gestor só a lê
    if (lerPendencias) setNotificacoes(motor ? await motor.linhas<NotificacaoPendencia>('notificacao').catch(() => []) : []);
    setDados({ ...d, visao: aplicarParadoMinDoTenant(d.visao, linhas) });
    setCarregado(true);
  }, [cache, motor, lerPendencias]);

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
      if (!ambiente.online()) return { ok: false, mensagem: SEM_SINAL_PARA_DISPENSAR };
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

  /**
   * T-0184: decide UM motivo pelas rotas do Vendedor (nunca escrita direta). Exige internet: outro aprovador pode ter decidido
   * antes e a resposta do servidor vale. Tira o cartão do cache na hora e a próxima sincronização traz o estado real.
   */
  const decidirAprovacao = useCallback(
    async (pedidoId: string, acao: AcaoDeDecisao, motivo: MotivoAprovacao, texto: string): Promise<{ ok: true } | { ok: false; mensagem: string }> => {
      if (!cache) return { ok: false, mensagem: 'Carregando…' };
      if (!ambiente.online()) return { ok: false, mensagem: 'Sem sinal para decidir. Conecte-se e toque de novo.' };
      try {
        await ambiente.http.requisitar<unknown>('POST', `/vendedor/pedidos/${encodeURIComponent(pedidoId)}/${ROTA_DA_DECISAO[acao]}`, { body: { ...corpoDaDecisao(acao, texto, motivo) } });
      } catch (e) {
        return { ok: false, mensagem: mensagemDeErro(e) };
      }
      const atual = await cache.ler('fila');
      if (atual) await cache.gravar('fila', filaAposDecisao(atual, pedidoId, acao, motivo));
      await recarregar();
      void motor?.sincronizar().then(() => recarregar());
      return { ok: true };
    },
    [ambiente, cache, motor, recarregar],
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

  const pendencias = useMemo(() => alertasDePendenciaCheckout(notificacoes, { perfil: usuario?.perfil, agora: relogio.agora().toISOString() }), [notificacoes, usuario?.perfil, estado.sincronizado_em]);

  return { ...dados, pendencias, usuarioId: usuario?.id ?? null, carregado, sincronizando: estado.sincronizando, erro: estado.erro, offline, tz, auto, dispensar, decidirAprovacao, ficha, ranking };
}
