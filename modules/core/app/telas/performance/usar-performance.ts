/**
 * Hook da Performance (T-0170 §7.1). Lê do aparelho as linhas do pull e a cópia do servidor e calcula com `montarPerformance`
 * (offline). Recalcula quando um sync termina ou a fila muda; trocar de período só refaz a conta em memória (critério 3 da §10).
 * - Este mês e Mês passado: a cópia de `GET /v1/core/performance` é renovada a cada sincronização terminada, com sinal, e
 *   guardada no aparelho; sem sinal vale a última.
 * - Período fora da janela: a resposta do servidor, com sinal; sem sinal, o estado `sem_sinal` ("precisa de internet").
 */
import { itensParaSobrepor } from '@macuxi/platform-sdk';
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState } from 'react';

import type { MetaSync, ParametroSync, RotaParadaSync, RotaSync, UsuarioSync, VisitaSync } from '../../../contracts';
import { PerformanceSchema, type DeslocamentoDia, type MetaProdutividade, type Performance } from '../../../contracts/performance';
import { tolerante } from '../../lib/leitor-tolerante';
import { caminhoDaPerformance, chaveDaCopiaPerformance, ENTIDADES_PERFORMANCE, montarPerformance, visaoDoServidor, type LinhasPerformance, type VisaoPerformance } from './performance-local';
import { chaveDaCopia, foraDaJanela, type EstadoDoServidor, type Intervalo } from './periodo-performance';

const Resposta = tolerante(PerformanceSchema);

export interface UsoPerformance {
  visao: VisaoPerformance | null;
  /** Período fora da janela sem resposta do servidor: o estado no lugar dos números. */
  servidor: EstadoDoServidor | null;
  /** O período saiu da janela do aparelho (a folha mostra a ajuda). */
  fora: boolean;
  /** Promotor só vê Visitas em Resultados (RN-PRO-01). */
  perfil: 'vendedor' | 'promotor';
  /** Puxar para baixo: tenta a consulta de novo. */
  tentarDeNovo: () => void;
}

export function usePerformance(intervalo: Intervalo, o: { fuso: string; hoje: string }): UsoPerformance {
  const { motor, estado } = useMotorSync();
  const ambiente = useAmbiente();
  const [linhas, setLinhas] = useState<LinhasPerformance | null>(null);
  const [copias, setCopias] = useState<Record<string, Performance | null>>({});
  const [doServidor, setDoServidor] = useState<{ chave: string; estado: 'carregando' | 'ok' | 'erro'; resposta?: Performance } | null>(null);
  const [tentativa, setTentativa] = useState(0);

  const fora = foraDaJanela(intervalo, o.hoje);
  const guardada = chaveDaCopia(intervalo, o.hoje);
  const chaveConsulta = `${intervalo.de}:${intervalo.ate}`;

  // linhas do pull: relidas quando um sync termina (nenhum timer, RN-CORE-23)
  useEffect(() => {
    if (!motor) return;
    let ativo = true;
    void (async () => {
      const e = ENTIDADES_PERFORMANCE;
      const armazem = motor.armazenamentoDoModulo('core');
      const [visitas, rotas, paradas, metas, parametros, metasProdutividade, deslocamentos, usuarios, esteMes, mesPassado] = await Promise.all([
        motor.linhas<VisitaSync>(e.visita),
        motor.linhas<RotaSync>(e.rota),
        motor.linhas<RotaParadaSync>(e.paradas),
        motor.linhas<MetaSync>(e.metas),
        motor.linhas<ParametroSync>(e.parametros),
        motor.linhas<MetaProdutividade>(e.metasProdutividade),
        motor.linhas<DeslocamentoDia>(e.deslocamentos),
        motor.linhas<UsuarioSync>(e.usuarios),
        armazem.ler<Performance>(chaveDaCopiaPerformance('este_mes')),
        armazem.ler<Performance>(chaveDaCopiaPerformance('mes_passado')),
      ]);
      if (!ativo) return;
      setLinhas({ visitas, rotas, paradas, metas, parametros, metasProdutividade, deslocamentos, usuarios });
      setCopias({ este_mes: esteMes, mes_passado: mesPassado });
    })();
    return () => {
      ativo = false;
    };
  }, [motor, estado.sincronizado_em]);

  // consulta ao servidor: fora da janela (o período inteiro) ou para renovar a cópia de Este mês e Mês passado
  const consultar = Boolean(motor) && ambiente.online() && (fora || guardada !== null);
  useEffect(() => {
    if (!consultar || !motor) return;
    let cancelado = false;
    if (fora) setDoServidor({ chave: chaveConsulta, estado: 'carregando' });
    void (async () => {
      try {
        const resposta = Resposta.parse(await ambiente.http.requisitar('GET', caminhoDaPerformance(intervalo))) as Performance;
        if (cancelado) return;
        if (guardada) {
          await motor.armazenamentoDoModulo('core').gravar(chaveDaCopiaPerformance(guardada), resposta);
          setCopias((c) => ({ ...c, [guardada]: resposta }));
        }
        setDoServidor({ chave: chaveConsulta, estado: 'ok', resposta });
      } catch {
        if (!cancelado) setDoServidor({ chave: chaveConsulta, estado: 'erro' });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [consultar, chaveConsulta, estado.sincronizado_em, tentativa]);

  const usuario = motor?.ambiente.usuario() ?? null;
  const perfil = usuario?.perfil === 'promotor' ? 'promotor' : 'vendedor';
  const visao = useMemo(() => {
    const u = usuario;
    if (!u) return null;
    if (fora) {
      const r = doServidor?.chave === chaveConsulta && doServidor.estado === 'ok' ? doServidor.resposta : null;
      return r ? visaoDoServidor(r) : null;
    }
    if (!linhas) return null;
    return montarPerformance(linhas, guardada ? (copias[guardada] ?? null) : null, itensParaSobrepor(estado), {
      usuarioId: u.id,
      perfil,
      fuso: o.fuso,
      agora: new Date(),
      intervalo,
    });
  }, [usuario?.id, perfil, fora, doServidor, chaveConsulta, linhas, copias, guardada, estado.fila, estado.aceitos, o.fuso, intervalo.de, intervalo.ate]);

  let servidor: EstadoDoServidor | null = null;
  if (fora && !visao) {
    const atual = doServidor?.chave === chaveConsulta ? doServidor.estado : null;
    servidor = !ambiente.online() ? 'sem_sinal' : atual === 'erro' ? 'erro' : 'carregando';
  }

  return { visao, servidor, fora, perfil, tentarDeNovo: () => setTentativa((n) => n + 1) };
}
