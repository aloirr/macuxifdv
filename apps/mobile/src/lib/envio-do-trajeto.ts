/**
 * T-0156 (RN-CORE-13; docs/modulos/core/rastreamento.md, "Envio dos pontos"): os pontos que a tarefa `macuxi-trajeto` grava
 * em `core__ponto_trajeto` vão ao servidor depois de cada envio do motor (`enviarPontosDoTrajeto`, do Core), direto pelo
 * `push` do transporte do usuário, em lotes, sem passar pela fila do motor: milhares de pontos não atrasam o pedido, e se
 * o tempo da passada em segundo plano acabar no meio, o resto fica para a próxima. Não é etapa de sync: o embrulho fica nos três caminhos que
 * enviam (`enviar`, `sincronizar` e `sincronizarNovidades`), e o app aberto e a tarefa em segundo plano usam o mesmo motor
 * embrulhado (`services/motor-do-usuario.ts`). Sem sinal, nada sai.
 * Falha da rotina nunca derruba o envio nem o sync; `registrar` recebe só contagens (nenhuma coordenada nem id, §9).
 * Com a tela, o resultado do motor volta depois do envio do motor e os pontos seguem em paralelo (não seguram o "Enviando…");
 * sem tela (`esperar`), a passada espera os pontos para o sistema não encerrá-la no meio.
 */
import { enviarPontosDoTrajeto, type BancoDoTrajeto } from '@macuxi/core/app';
import type { MotorSync, TransporteSync } from '@macuxi/platform-sdk';

export interface DependenciasDoEnvioDoTrajeto {
  /** SQLite do usuário (o mesmo do `gravarPontosDoTrajeto`); `null` = sem banco aberto (reserva no AsyncStorage). */
  banco: () => BancoDoTrajeto | null;
  /** `push` do transporte do usuário, o mesmo do motor (sessão e renovação). */
  push: TransporteSync['push'];
  online: () => boolean;
  /** Só contagens, nunca coordenada nem id. */
  registrar: (mensagem: string) => void;
  agora?: () => Date;
  /** `true` = só volta com os pontos enviados (tarefa sem tela). */
  esperar?: boolean;
}

/** O motor embrulhado; `pontosDoTrajeto()` é a rotina em curso (ou já resolvida), para quem precisa esperar por ela. */
export type MotorComPontosDoTrajeto = MotorSync & { pontosDoTrajeto: () => Promise<void> };

/** O motor com os pontos do trajeto enviados depois de cada envio do motor. Uma rotina por vez: quem chega no meio usa a mesma. */
export function comPontosDoTrajeto(motor: MotorSync, d: DependenciasDoEnvioDoTrajeto): MotorComPontosDoTrajeto {
  let emCurso: Promise<void> | null = null;
  const agora = d.agora ?? (() => new Date());
  const depoisDoEnvio = (): Promise<void> => {
    emCurso ??= (async () => {
      try {
        if (!d.online()) return;
        const db = d.banco();
        if (db) await enviarPontosDoTrajeto({ db, push: d.push, agora, registrar: d.registrar });
      } catch {
        d.registrar('trajeto: falha ao enviar os pontos');
      }
    })().finally(() => {
      emCurso = null;
    });
    return emCurso;
  };
  /** Depois do envio do motor. A rotina nunca rejeita (o `catch` acima): sem esperar, ela segue sozinha. */
  const depois = async <R>(resultado: R): Promise<R> => {
    if (d.esperar) await depoisDoEnvio();
    else void depoisDoEnvio();
    return resultado;
  };
  return {
    ...motor,
    enviar: async (opcoes) => depois(await motor.enviar(opcoes)),
    sincronizar: async (opcoes) => depois(await motor.sincronizar(opcoes)),
    sincronizarNovidades: async (opcoes) => depois(await motor.sincronizarNovidades(opcoes)),
    pontosDoTrajeto: () => emCurso ?? Promise.resolve(),
  };
}
