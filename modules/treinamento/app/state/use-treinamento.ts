/**
 * Hook das telas do Treinar (offline-first, ADR 0003): lê as linhas do pull no aparelho, sobrepõe a fila do motor e
 * calcula a jornada com o domain. Escrever = conferir com o domain e enfileirar o push `progresso` (o motor envia quando
 * houver sinal). A rede só confirma; nada aqui espera a rede para mostrar dados. O ranking (calculado no servidor) é a
 * única leitura online, com cache no armazenamento do módulo.
 */
import { useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { DEFAULT_TZ, localIsoDate } from '@macuxi/ui/mobile/puro';
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { resumoDaJornada, type AtividadeDoAluno, type ResultadoAtividade } from '../../domain';
import {
  conteudoDoAparelho,
  envioDaAtividade,
  estadoDasLinhas,
  idsDePrevia,
  lerLinhas,
  LINHAS_VAZIAS,
  parametrosDoAparelho,
  planejarEnvio,
  projetar,
  trilhasDoAparelho,
  type LinhasTreinamento,
} from '../lib/estado';
import { trilhasComTitulo } from '../lib/telas';

export type ResultadoRegistro =
  | {
      ok: true;
      resultados: { atividade: AtividadeDoAluno; resultado: ResultadoAtividade }[];
      mensagem: string | null;
    }
  | { ok: false; mensagem: string };

const ROTULO = { licao: 'Lição concluída', quiz: 'Quiz respondido' } as const;

export function useTreinamento() {
  const { motor, estado: motorEstado } = useMotorSync();
  const ambiente = useAmbiente();
  const usuario = ambiente.usuario();
  const bruto = ambiente.parametros('treinamento');
  const params = useMemo(() => parametrosDoAparelho(bruto, usuario?.fuso), [bruto, usuario?.fuso]);
  const tz = usuario?.fuso || params.fuso || DEFAULT_TZ;
  const [linhas, setLinhas] = useState<LinhasTreinamento>(LINHAS_VAZIAS);
  const [carregado, setCarregado] = useState(false);

  const recarregar = useCallback(async () => {
    if (!motor) return;
    setLinhas(await lerLinhas(motor));
    setCarregado(true);
  }, [motor]);

  /** RN-CORE-23: puxar para baixo = Sincronizar (agendador, trava de 30 s); relê o aparelho a cada sincronização. */
  const auto = useAtualizacaoAutomatica({ atualizar: recarregar, tz });

  // recarrega ao abrir e a cada sincronização concluída
  useEffect(() => {
    void recarregar();
  }, [recarregar, motorEstado.sincronizado_em]);

  const aluno = useMemo(
    () => ({ id: usuario?.id ?? '', perfil: usuario?.perfil ?? '', equipe_id: null }),
    [usuario?.id, usuario?.perfil],
  );
  const trilhas = useMemo(() => trilhasDoAparelho(linhas), [linhas]);
  const conteudo = useMemo(() => conteudoDoAparelho(linhas), [linhas]);
  const base = useMemo(() => estadoDasLinhas(linhas, aluno), [linhas, aluno]);
  const itens = useMemo(
    () => [...motorEstado.fila, ...motorEstado.aceitos],
    [motorEstado.fila, motorEstado.aceitos],
  );
  const projecao = useMemo(() => projetar(base, conteudo, itens, params), [base, conteudo, itens, params]);
  const hoje = localIsoDate(new Date(), tz);
  const jornada = useMemo(
    () => resumoDaJornada(projecao.estado, conteudo, { hoje, params }),
    [projecao.estado, conteudo, hoje, params],
  );
  const listaDeTrilhas = useMemo(() => trilhasComTitulo(jornada, trilhas), [jornada, trilhas]);

  /**
   * Confere com o domain (RN-TRE-02/04) e enfileira as atividades aceitas, na ordem; a primeira recusa para o envio
   * e devolve a mensagem do domain. `opcional` = recusa esperada que não é erro (ex.: lição depois de quiz reprovado).
   */
  const registrar = useCallback(
    async (
      atividades: AtividadeDoAluno[],
      opcoes: { ultimaOpcional?: boolean } = {},
    ): Promise<ResultadoRegistro> => {
      if (!motor)
        return {
          ok: false,
          mensagem: 'O aparelho ainda está preparando os dados. Tente de novo em instantes.',
        };
      const plano = planejarEnvio(projecao.estado, conteudo, atividades, {
        gerarId: idsDePrevia('tela'),
        params,
      });
      const recusaDaUltima =
        plano.recusa && plano.resultados.length === atividades.length && opcoes.ultimaOpcional;
      if (plano.recusa && plano.enviar.length === 0 && !recusaDaUltima)
        return { ok: false, mensagem: plano.recusa.mensagem };
      for (const a of plano.enviar) {
        await motor.enfileirar({
          id: a.id,
          entidade: 'progresso',
          payload: envioDaAtividade(a),
          rotulo: `Treinamento · ${ROTULO[a.tipo]}`,
          detalhe: a.tipo === 'licao' ? 'Conclusão de lição' : 'Tentativa de quiz',
        });
      }
      void motor.enviar();
      return { ok: true, resultados: plano.resultados, mensagem: plano.recusa?.mensagem ?? null };
    },
    [motor, projecao.estado, conteudo, params],
  );

  return {
    motor,
    carregado,
    params,
    tz,
    hoje,
    offline: !ambiente.online(),
    sincronizando: motorEstado.sincronizando,
    erroSync: motorEstado.erro,
    sincronizadoEm: motorEstado.sincronizado_em,
    trilhas,
    estado: projecao.estado,
    naFila: projecao.na_fila,
    recusadas: projecao.recusadas,
    jornada,
    listaDeTrilhas,
    novoId: () => ambiente.novoId(),
    agora: () => new Date().toISOString(),
    recarregar,
    auto,
    registrar,
  };
}

export type EstadoTreinamento = ReturnType<typeof useTreinamento>;
