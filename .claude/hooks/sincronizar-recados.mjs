#!/usr/bin/env node
// Sincronização dos recados no início e no fim da sessão (ADR 0035, T-0139) — hooks SessionStart e Stop.
// Uso: node .claude/hooks/sincronizar-recados.mjs [--esperar]
//  - Roda scripts/sincronizar-recados.ps1 (pull --rebase, commit e push do clone C:\macuxifdv-recados) só quando
//    há junção de recados (depois do corte), no Windows. Antes do corte, na nuvem e no CI: não faz nada.
//  - --esperar (SessionStart): espera até 40 s, para a caixa já abrir atualizada. Sem ele (Stop): dispara em
//    segundo plano e sai na hora (o .ps1 tem trava de execução única e timeout próprio).
//  - Nunca bloqueia a sessão: sai sempre com 0. Não lê nem grava segredo (a credencial é a do Git Credential
//    Manager do Windows). Desligar: MACUXI_RECADOS_SYNC=off.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { RAIZ, juncoesDeRecados } from '../../scripts/coord-lib.mjs';

/** Decide se e como sincronizar (função pura, exportada para os testes). */
export function planoDeSincronizacao({ plataforma, env, juncoes, scriptExiste, esperar }) {
  if (String(env.MACUXI_RECADOS_SYNC || '').toLowerCase() === 'off') return { rodar: false, motivo: 'desligado (MACUXI_RECADOS_SYNC=off)' };
  if (plataforma !== 'win32') return { rodar: false, motivo: 'fora do Windows' };
  if (!juncoes?.clone || !juncoes.mapas?.length) return { rodar: false, motivo: 'sem junção de recados (antes do corte)' };
  if (!scriptExiste) return { rodar: false, motivo: 'scripts/sincronizar-recados.ps1 ausente' };
  return { rodar: true, esperar: Boolean(esperar), clone: juncoes.clone };
}

if (import.meta.main) {
  // O hook recebe o JSON da sessão no stdin; não precisamos dele, mas não deixamos o pipe pendurado.
  process.stdin.resume();
  process.stdin.on('error', () => {});
  const script = join(RAIZ, 'scripts', 'sincronizar-recados.ps1');
  let plano;
  try {
    plano = planoDeSincronizacao({
      plataforma: process.platform, env: process.env, juncoes: juncoesDeRecados(RAIZ),
      scriptExiste: existsSync(script), esperar: process.argv.includes('--esperar'),
    });
  } catch {
    process.exit(0);
  }
  if (!plano.rodar) process.exit(0);
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Clone', plano.clone.replace(/\//g, '\\'), '-Origem', 'sessao'];
  try {
    if (plano.esperar) {
      const r = spawnSync('powershell.exe', args, { stdio: 'ignore', windowsHide: true, timeout: 40_000 });
      if (r.status !== 0) {
        // SessionStart: a saída vai para o contexto da sessão; uma linha curta, sem dado sensível.
        process.stdout.write('[recados] a sincronização do início da sessão não terminou bem; a caixa pode estar desatualizada (log em %LOCALAPPDATA%\\Macuxi\\recados-sync.log).\n');
      }
    } else {
      const filho = spawn('powershell.exe', args, { stdio: 'ignore', windowsHide: true, detached: true });
      filho.on('error', () => {});
      filho.unref();
    }
  } catch {
    // powershell ausente ou falha ao iniciar: a sessão segue; o Agendador sincroniza a cada 2 min.
  }
  process.exit(0);
}
