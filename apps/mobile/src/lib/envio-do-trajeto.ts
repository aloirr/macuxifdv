/**
 * T-0156 (RN-CORE-13; docs/modulos/core/rastreamento.md, "Envio dos pontos"): os pontos que a tarefa `macuxi-trajeto` grava
 * em `core__ponto_trajeto` vão ao servidor antes de cada envio (`enviarPontosDoTrajeto`, do Core), direto pelo `push` do
 * transporte do usuário, em lotes, sem passar pela fila do motor. Não é etapa de sync: o embrulho fica nos três caminhos que
 * enviam (`enviar`, `sincronizar` e `sincronizarNovidades`), e o app aberto e a tarefa em segundo plano usam o mesmo motor
 * embrulhado (`services/motor-do-usuario.ts`). Sem sinal, nada sai.
 * Falha da rotina nunca derruba o envio nem o sync; `registrar` recebe só contagens (nenhuma coordenada nem id, §9).
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
}

/** O motor com os pontos do trajeto enviados antes de cada envio. Uma rotina por vez: quem chega no meio espera a mesma. */
export function comPontosDoTrajeto(motor: MotorSync, d: DependenciasDoEnvioDoTrajeto): MotorSync {
  let emCurso: Promise<void> | null = null;
  const agora = d.agora ?? (() => new Date());
  const antesDoEnvio = (): Promise<void> => {
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
  return {
    ...motor,
    enviar: async (opcoes) => {
      await antesDoEnvio();
      return motor.enviar(opcoes);
    },
    sincronizar: async (opcoes) => {
      await antesDoEnvio();
      return motor.sincronizar(opcoes);
    },
    sincronizarNovidades: async (opcoes) => {
      await antesDoEnvio();
      return motor.sincronizarNovidades(opcoes);
    },
  };
}
