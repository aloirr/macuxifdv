/**
 * Hook do rastreamento no Campo (T-0156; desenho `tracking.md` §4.3 e §6): lê do aparelho (offline) o parâmetro, o termo, o aceite, as
 * ausências e a pausa, e devolve a situação do termo e o estado da seção Localização. Escreve na fila do motor (aceite e pausa fechada) e no
 * armazenamento do módulo (o aceite e a pausa em curso, que a tarefa `macuxi-trajeto` também lê). Sem coordenada em log ou erro (§9).
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ENTIDADE_ACEITE_TERMO_RASTREAMENTO,
  ENTIDADE_AUSENCIA_USUARIO,
  ENTIDADE_PAUSA_TRAJETO,
  ENTIDADE_TERMO_RASTREAMENTO,
  type AceiteTermoRastreamentoSync,
  type AusenciaUsuario,
  type ParametroSync,
  type TermoRastreamento,
} from '../../contracts';
import { feriadosDasLinhas, parametrosRastreamentoDasLinhas } from '../../domain/trajeto-ponto';
import { fusoDe } from './estado';
import {
  CHAVE_ACEITE_LOCAL,
  CHAVE_PAUSA_LOCAL,
  estadoDaLocalizacao,
  pausaVencida,
  situacaoDoTermo,
  termoVigenteDe,
  type AceiteLocal,
  type EntradaLocalizacao,
  type EstadoLocalizacao,
  type PausaLocal,
  type SituacaoTermo,
} from './rastreamento-local';
import { useCore } from './usar-core';

const TICK_MS = 30_000;

interface Dados {
  parametros: ParametroSync[];
  termos: TermoRastreamento[];
  aceitesServidor: AceiteTermoRastreamentoSync[];
  ausencias: AusenciaUsuario[];
  aceiteLocal: AceiteLocal | null;
  pausa: PausaLocal | null;
}

export interface UsoRastreamento {
  carregado: boolean;
  situacao: SituacaoTermo;
  localizacao: EstadoLocalizacao;
  /** Termo vigente (texto e versão), ou null. */
  termo: TermoRastreamento | null;
  /** Hora do aceite da versão vigente, quando houver. */
  aceitoEm: string | null;
  /** Pausa em curso (início), ou null. */
  pausa: PausaLocal | null;
  /** Fuso do tenant, para horas e datas. */
  fuso: string;
  aceitar: () => Promise<void>;
  pausar: () => Promise<void>;
  retomar: () => Promise<void>;
  /** Desfaz a pausa como se não tivesse havido (nada vai ao servidor). */
  desfazerPausa: () => Promise<void>;
}

export function useRastreamento(): UsoRastreamento {
  const { motor, estado } = useMotorSync();
  const core = useCore();
  const [dados, setDados] = useState<Dados | null>(null);
  const [agora, setAgora] = useState(() => new Date().toISOString());
  const armazem = useMemo(() => motor?.armazenamentoDoModulo('core') ?? null, [motor]);

  const carregar = useCallback(async () => {
    if (!motor || !armazem) return null;
    const [parametros, termos, aceitesServidor, ausencias, aceiteLocal, pausa] = await Promise.all([
      motor.linhas<ParametroSync>('parametro'),
      motor.linhas<TermoRastreamento>(ENTIDADE_TERMO_RASTREAMENTO),
      motor.linhas<AceiteTermoRastreamentoSync>(ENTIDADE_ACEITE_TERMO_RASTREAMENTO),
      motor.linhas<AusenciaUsuario>(ENTIDADE_AUSENCIA_USUARIO),
      armazem.ler<AceiteLocal>(CHAVE_ACEITE_LOCAL),
      armazem.ler<PausaLocal>(CHAVE_PAUSA_LOCAL),
    ]);
    const d: Dados = { parametros, termos, aceitesServidor, ausencias, aceiteLocal, pausa };
    // pausa que passou do prazo vira registro fechado no prazo e sai de cena (a fila leva ao servidor)
    const vencida = pausa ? pausaVencida(pausa, new Date().toISOString()) : null;
    if (vencida) {
      await motor.enfileirar({ id: vencida.id, entidade: ENTIDADE_PAUSA_TRAJETO, payload: vencida, rotulo: 'Pausa da localização' });
      await armazem.remover(CHAVE_PAUSA_LOCAL);
      d.pausa = null;
    }
    return d;
  }, [motor, armazem]);

  useEffect(() => {
    let ativo = true;
    void carregar().then((d) => {
      if (ativo && d) setDados(d);
    });
    return () => {
      ativo = false;
    };
  }, [carregar, estado.sincronizado_em]);

  useEffect(() => {
    const t = setInterval(() => setAgora(new Date().toISOString()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const usuario = motor?.ambiente.usuario() ?? null;
  const entrada = useMemo<EntradaLocalizacao | null>(() => {
    if (!dados || !usuario) return null;
    return {
      parametros: parametrosRastreamentoDasLinhas(dados.parametros),
      termos: dados.termos,
      aceiteLocal: dados.aceiteLocal,
      aceitesServidor: dados.aceitesServidor,
      usuarioId: usuario.id,
      cargo: usuario.perfil ?? '',
      ausencias: dados.ausencias,
      feriados: feriadosDasLinhas(dados.parametros),
      pausa: dados.pausa,
      agora,
      fuso: fusoDe(core.estado.me, usuario.fuso),
    };
  }, [dados, usuario, agora, core.estado.me]);

  const atualizar = useCallback(async () => {
    const d = await carregar();
    if (d) setDados(d);
  }, [carregar]);

  const vigente = entrada ? termoVigenteDe(entrada.termos) : null;

  const aceitar = useCallback(async () => {
    if (!motor || !armazem || !vigente) return;
    const aceite: AceiteLocal = { id: motor.ambiente.novoId(), versao: vigente.versao, aceito_em: new Date().toISOString() };
    await motor.enfileirar({ id: aceite.id, entidade: ENTIDADE_ACEITE_TERMO_RASTREAMENTO, payload: { id: aceite.id, termo_versao: aceite.versao, aceito_em: aceite.aceito_em }, rotulo: 'Aceite do termo de localização' });
    await armazem.gravar(CHAVE_ACEITE_LOCAL, aceite);
    await atualizar();
  }, [motor, armazem, vigente, atualizar]);

  const pausar = useCallback(async () => {
    if (!motor || !armazem) return;
    await armazem.gravar(CHAVE_PAUSA_LOCAL, { id: motor.ambiente.novoId(), inicio: new Date().toISOString() } satisfies PausaLocal);
    await atualizar();
  }, [motor, armazem, atualizar]);

  const retomar = useCallback(async () => {
    if (!motor || !armazem) return;
    const p = await armazem.ler<PausaLocal>(CHAVE_PAUSA_LOCAL);
    if (!p) return;
    const fim = new Date().toISOString();
    // pausa sem duração não vale registro (o servidor também a ignora); só entra na fila se durou
    if (Date.parse(fim) > Date.parse(p.inicio)) await motor.enfileirar({ id: p.id, entidade: ENTIDADE_PAUSA_TRAJETO, payload: { id: p.id, inicio: p.inicio, fim }, rotulo: 'Pausa da localização' });
    await armazem.remover(CHAVE_PAUSA_LOCAL);
    await atualizar();
  }, [motor, armazem, atualizar]);

  const desfazerPausa = useCallback(async () => {
    if (!armazem) return;
    await armazem.remover(CHAVE_PAUSA_LOCAL);
    await atualizar();
  }, [armazem, atualizar]);

  const situacao = entrada ? situacaoDoTermo(entrada) : 'desligado';
  const localizacao: EstadoLocalizacao = entrada ? estadoDaLocalizacao(entrada) : { estado: 'oculta' };
  const aceitoEm = entrada && vigente ? (entrada.aceiteLocal?.versao === vigente.versao ? entrada.aceiteLocal.aceito_em : (entrada.aceitesServidor.find((a) => a.termo_versao === vigente.versao && a.usuario_id === entrada.usuarioId && !a.deleted_at)?.aceito_em ?? null)) : null;

  return { carregado: dados !== null, situacao, localizacao, termo: vigente, aceitoEm, pausa: dados?.pausa ?? null, fuso: entrada?.fuso ?? fusoDe(core.estado.me, usuario?.fuso), aceitar, pausar, retomar, desfazerPausa };
}
