/**
 * Hook das telas da Pesquisa no app (Campo e Gestão). Offline-first: lê as linhas locais do sync e a fila do motor,
 * guarda o rascunho no armazenamento do módulo (`mod:pesquisa:`, apagado se o módulo for desativado, RN-CORE-02) e
 * escreve a resposta na fila (`resposta_pesquisa`) — o motor envia quando houver sinal (RF-PES-04).
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { DEFAULT_TZ } from '@macuxi/comum/fuso';
import { itensParaSobrepor } from '@macuxi/platform-sdk';
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QuestionarioVersao } from '../../contracts';
import {
  ofertaDePesquisas,
  parametrosComPadrao,
  respostasConhecidas,
  versaoVigente,
  type UsuarioAlvo,
} from '../../domain';
import { fotosDoEnvio, prepararEnvio, type Preparo, type RascunhoResposta } from '../lib/formulario';
import { definirEstadoLocal, lerRetrato, RETRATO_VAZIO, respostasDaFila, type RetratoPesquisa } from '../lib/local';

const relogio = relogioReal();
const PREFIXO_RASCUNHO = 'rascunho:';

export function usePesquisa() {
  const { motor, estado } = useMotorSync();
  const ambiente = useAmbiente();
  const usuario = ambiente.usuario();
  const fuso = usuario?.fuso ?? DEFAULT_TZ;
  const brutos = ambiente.parametros('pesquisa');
  const parametros = useMemo(() => parametrosComPadrao(brutos, fuso).parametros, [brutos, fuso]);
  const [retrato, setRetrato] = useState<RetratoPesquisa>(RETRATO_VAZIO);
  const [carregado, setCarregado] = useState(false);

  // Premissa T-0057: o aparelho ainda não conhece as equipes do usuário (o Core não manda); público por equipe não casa.
  const alvo: UsuarioAlvo | null = useMemo(() => (usuario?.perfil ? { id: usuario.id, perfil: usuario.perfil, equipe_ids: [] } : null), [usuario?.id, usuario?.perfil]);

  const recarregar = useCallback(async () => {
    if (!motor) return;
    const r = await lerRetrato(motor);
    setRetrato(r);
    setCarregado(true);
    if (alvo) definirEstadoLocal({ retrato: r, leitor: motor, usuario: alvo, fuso, agora: relogio.agora });
  }, [motor, alvo, fuso]);

  // ao abrir e a cada sincronização concluída
  useEffect(() => {
    void recarregar();
  }, [recarregar, estado.sincronizado_em]);

  const fila = useMemo(() => respostasDaFila(itensParaSobrepor(estado, ['resposta_pesquisa'])), [estado]);
  const pendentesNaFila = useMemo(() => estado.fila.filter((i) => i.entidade === 'resposta_pesquisa').length, [estado.fila]);
  const respostas = useMemo(() => respostasConhecidas({ linhas: retrato.respostasPull, fila, usuario_id: usuario?.id ?? '' }), [retrato, fila, usuario?.id]);

  /** RF-PES-03: avulsas disponíveis agora para este contexto (cliente/visita opcionais). */
  const oferta = useCallback(
    (contexto: { cliente_id: string | null; visita_id: string | null }) => {
      if (!alvo) return { disponiveis: [], indisponiveis: [] };
      const cliente = contexto.cliente_id ? (retrato.clientes.get(contexto.cliente_id) ?? { id: contexto.cliente_id, segmento: null, regiao: null }) : null;
      return ofertaDePesquisas({ pesquisas: retrato.pesquisas, usuario: alvo, cliente, visita_id: contexto.visita_id, agora: relogio.agora().toISOString(), respostas, fuso });
    },
    [alvo, retrato, respostas, fuso],
  );

  /** RN-PES-01: a versão que o aparelho responde é a vigente quando o formulário abre. */
  const versaoPara = useCallback(
    (questionarioId: string): QuestionarioVersao | null => {
      const p = retrato.pesquisas.find((x) => x.questionario.id === questionarioId);
      return p ? versaoVigente(p.questionario, p.versoes) : null;
    },
    [retrato],
  );

  const armazenamento = useMemo(() => motor?.armazenamentoDoModulo('pesquisa') ?? null, [motor]);
  const lerRascunho = useCallback(async (chave: string) => (armazenamento ? await armazenamento.ler<RascunhoResposta>(`${PREFIXO_RASCUNHO}${chave}`) : null), [armazenamento]);
  const gravarRascunho = useCallback(async (chave: string, r: RascunhoResposta) => armazenamento?.gravar(`${PREFIXO_RASCUNHO}${chave}`, r), [armazenamento]);
  const apagarRascunho = useCallback(async (chave: string) => armazenamento?.remover(`${PREFIXO_RASCUNHO}${chave}`), [armazenamento]);

  /** RF-PES-04: valida, põe as fotos e a resposta na fila e apaga o rascunho. Funciona sem sinal. */
  const enviar = useCallback(
    async (versao: QuestionarioVersao, chave: string, r: RascunhoResposta): Promise<Preparo> => {
      const p = prepararEnvio(versao, r, { agora: relogio.agora().toISOString(), parametros });
      if (!p.ok || !motor) return p;
      for (const id of fotosDoEnvio(p.envio)) await motor.enfileirarArquivo({ id, modulo: 'pesquisa', rotulo: `Foto · ${versao.titulo}` });
      const n = p.envio.itens.length;
      await motor.enfileirar({ id: p.envio.id, entidade: 'resposta_pesquisa', payload: p.envio, rotulo: `Pesquisa · ${versao.titulo}`, detalhe: `${n} ${n === 1 ? 'resposta' : 'respostas'}` });
      await apagarRescunhoSeguro(apagarRascunho, chave);
      void motor.enviar().catch(() => undefined);
      return p;
    },
    [motor, parametros, apagarRascunho],
  );

  return {
    motor,
    carregado,
    retrato,
    usuario,
    fuso,
    parametros,
    pendentesNaFila,
    offline: !ambiente.online(),
    sincronizando: estado.sincronizando,
    oferta,
    versaoPara,
    lerRascunho,
    gravarRascunho,
    apagarRascunho,
    enviar,
    recarregar,
    agora: () => relogio.agora(),
    novoId: () => ambiente.novoId(),
  };
}

async function apagarRescunhoSeguro(apagar: (chave: string) => Promise<void> | undefined, chave: string): Promise<void> {
  try {
    await apagar(chave);
  } catch {
    // o rascunho fica; a resposta já está na fila e o id dela não muda (reenvio idempotente)
  }
}
