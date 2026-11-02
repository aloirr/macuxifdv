/**
 * T-0059 (R-20261102-090915 item 3): o detalhe técnico de uma carga que parou (etapa/entidade e mensagem do erro)
 * não aparece na tela de carga; vai para o log e para a área "Diagnóstico" do Perfil. O motor zera a etapa ao falhar,
 * então o shell acompanha o estado e guarda a última etapa vista antes do erro. Puro (roda em Node nos testes).
 */
import type { EstadoMotorSync } from '@macuxi/platform-sdk';

export interface FalhaSync {
  /** ISO 8601 (UTC). */
  quando: string;
  /** Etapa técnica em que parou (nome da entidade ou rótulo da etapa do módulo); null se parou antes de começar. */
  etapa: string | null;
  /** Mensagem técnica do erro (sem token nem dado pessoal: vem do transporte). */
  mensagem: string;
}

/**
 * Ouvinte para `motor.assinar`: chama `aoFalhar` uma vez a cada erro novo da sincronização completa, com a etapa
 * em que ela estava.
 */
export function observarFalhasDeSync(aoFalhar: (f: FalhaSync) => void, agora: () => Date = () => new Date()) {
  let ultimaEtapa: string | null = null;
  let erroAnterior: string | null = null;
  return (estado: Pick<EstadoMotorSync, 'sincronizando' | 'etapa' | 'erro'>): void => {
    if (estado.sincronizando && estado.etapa) ultimaEtapa = estado.etapa;
    if (estado.sincronizando) erroAnterior = null;
    if (estado.erro && estado.erro !== erroAnterior) {
      aoFalhar({ quando: agora().toISOString(), etapa: estado.sincronizando ? estado.etapa || ultimaEtapa : ultimaEtapa, mensagem: estado.erro });
    }
    erroAnterior = estado.erro;
    if (!estado.sincronizando && !estado.erro) ultimaEtapa = null;
  };
}
