/**
 * Atualização automática do Conector (T-0116) — módulo ISOLADO, ainda não ligado ao executor nem ao sinal.
 *
 * Fluxo de `atualizarConector`:
 *  1. só segue se a política do Hub oferece um `pacote` MAIS NOVO que a versão em uso;
 *  2. baixa o pacote (interface `BaixadorPacote`, implementada pela T-0098 com o bucket);
 *  3. confere SHA-256 + assinatura com a chave pública embutida (`assinatura.ts`) — falhou, nada é tocado (`mantido`);
 *  4. extrai em `atualizacao/nova/` (interface `ExtratorPacote`) e valida os itens (nunca `dados/` nem `conector.json`);
 *  5. para o serviço, troca a versão guardando a atual em `atualizacao/anterior/` (`troca.ts`);
 *  6. sobe o serviço e espera a "saúde" responder com a versão nova em até `limiteSaudeMs`;
 *  7. não respondeu (ou respondeu outra versão, ou não subiu): para, restaura a anterior, sobe de novo e confere a saúde
 *     dela (`revertido`, com a situação da anterior).
 * Devolve sempre um `ResultadoAtualizacao` (nunca lança por falha esperada); o log só leva códigos e versões.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { PacoteConector } from '@macuxi/integracao/contracts';
import type { Logger } from '../log/logger';
import { dormir } from '../util/retry';
import { iso, relogioReal, type Relogio } from '../util/relogio';
import { compararVersoes, lerSemver } from '../versao';
import { conferirPacote } from './assinatura';
import { CHAVES_PUBLICAS_PACOTE } from './chaves';
import {
  MENSAGENS,
  MENSAGENS_ANTERIOR,
  type MotivoMantido,
  type MotivoReversao,
  type ResultadoAtualizacao,
  type SituacaoAnterior,
} from './resultado';
import { lerManifesto, listarItensDoPacote, pastasAtualizacao, restaurarVersao, trocarVersao } from './troca';

/** Baixa os bytes do pacote anunciado (T-0098: bucket). Deve lançar se não conseguir; o tamanho/limite é dela. */
export interface BaixadorPacote {
  baixar(pacote: PacoteConector): Promise<Uint8Array>;
}

/** Extrai o arquivo do pacote (`.zip`) na pasta destino, que já existe e está vazia. */
export interface ExtratorPacote {
  extrair(arquivo: string, destino: string): Promise<void>;
}

/** Controle do serviço Windows (WinSW: `stop`/`start`). */
export interface ServicoConector {
  parar(): Promise<void>;
  iniciar(): Promise<void>;
}

/**
 * Pergunta ao Conector em execução se está de pé e em qual versão. `null` (ou exceção) = não respondeu.
 * A implementação respeita `limiteMs` (ex.: `AbortSignal.timeout`) para não travar a espera.
 */
export interface VerificadorSaude {
  consultar(limiteMs: number): Promise<{ versao: string } | null>;
}

export interface DependenciasAtualizacao {
  baixador: BaixadorPacote;
  extrator: ExtratorPacote;
  servico: ServicoConector;
  saude: VerificadorSaude;
  /** Chaves públicas por id; padrão: as embutidas (`chaves.ts`). */
  chaves?: Readonly<Record<string, string>>;
  relogio?: Relogio;
  esperar?: (ms: number) => Promise<void>;
  log?: Logger;
}

export interface OpcoesAtualizacao {
  /** Pasta de instalação do Conector. */
  pasta: string;
  versaoAtual: string;
  /** `politica_versao.pacote` da resposta do sinal (pode não vir). */
  pacote: PacoteConector | null | undefined;
  /** N: prazo para a versão nova responder à saúde depois de subir. Padrão 60 s. */
  limiteSaudeMs?: number;
  /** Intervalo entre consultas de saúde. Padrão 2 s. */
  intervaloSaudeMs?: number;
  /** Trava mais velha que isso é de uma tentativa que morreu no meio e é ignorada. Padrão 30 min. */
  travaVencidaMs?: number;
}

export const PADROES_ATUALIZACAO = {
  limiteSaudeMs: 60_000,
  intervaloSaudeMs: 2_000,
  travaVencidaMs: 30 * 60_000,
} as const;

type Saude = { ok: true } | { ok: false; motivo: 'sem_saude' | 'versao_divergente' };

export async function atualizarConector(
  o: OpcoesAtualizacao,
  d: DependenciasAtualizacao,
): Promise<ResultadoAtualizacao> {
  const relogio = d.relogio ?? relogioReal;
  const esperar = d.esperar ?? dormir;
  const chaves = d.chaves ?? CHAVES_PUBLICAS_PACOTE;
  const limiteSaude = o.limiteSaudeMs ?? PADROES_ATUALIZACAO.limiteSaudeMs;
  const intervalo = Math.max(1, o.intervaloSaudeMs ?? PADROES_ATUALIZACAO.intervaloSaudeMs);
  const inicio = relogio.agora();
  const p = pastasAtualizacao(o.pasta);
  const fim = () => {
    const agora = relogio.agora();
    return { em: iso(agora), duracao_ms: Math.max(0, agora - inicio) };
  };
  if (!lerSemver(o.versaoAtual)) throw new Error('versaoAtual inválida (use MAIOR.MENOR.PATCH).');

  const lido = o.pacote == null ? null : PacoteConector.safeParse(o.pacote);
  const oferecida = lido?.success ? lido.data.versao : null;
  const mantido = (motivo: MotivoMantido): ResultadoAtualizacao => {
    const r: ResultadoAtualizacao = {
      resultado: 'mantido',
      versao: o.versaoAtual,
      oferecida,
      motivo,
      mensagem: MENSAGENS[motivo],
      ...fim(),
    };
    d.log?.[motivo === 'sem_pacote' || motivo === 'ja_atualizado' ? 'debug' : 'aviso'](
      'atualizacao_mantida',
      { motivo, versao: o.versaoAtual, oferecida },
    );
    return r;
  };

  if (lido === null) return mantido('sem_pacote');
  if (!lido.success) return mantido('pacote_invalido');
  const pacote = lido.data;
  if (compararVersoes(pacote.versao, o.versaoAtual) <= 0) return mantido('ja_atualizado');

  async function aguardarSaude(versao: string): Promise<Saude> {
    const prazo = relogio.agora() + limiteSaude;
    let respondeuOutra = false;
    for (;;) {
      const resta = prazo - relogio.agora();
      if (resta <= 0) break;
      try {
        const s = await d.saude.consultar(Math.min(intervalo, resta));
        if (s && s.versao === versao) return { ok: true };
        if (s) respondeuOutra = true;
      } catch {
        // não respondeu: tenta de novo até o prazo
      }
      if (prazo - relogio.agora() <= 0) break;
      await esperar(Math.min(intervalo, prazo - relogio.agora()));
    }
    return { ok: false, motivo: respondeuOutra ? 'versao_divergente' : 'sem_saude' };
  }

  async function reverter(motivo: MotivoReversao): Promise<ResultadoAtualizacao> {
    d.log?.erro('atualizacao_revertendo', { motivo, de: o.versaoAtual, tentou: pacote.versao });
    await d.servico.parar().catch(() => undefined);
    let anterior: SituacaoAnterior = 'saudavel';
    try {
      // só desfaz o manifesto DESTA tentativa: se a troca falhou antes de gravá-lo, o que existe é o backup de uma
      // atualização antiga (restaurá-lo voltaria uma versão a mais) e os arquivos em uso não foram tocados
      const m = lerManifesto(o.pasta);
      if (m && m.versao_anterior === o.versaoAtual && m.versao_nova === pacote.versao)
        restaurarVersao(o.pasta);
    } catch {
      anterior = 'falha_ao_restaurar';
    }
    let subiu = true;
    await d.servico.iniciar().catch(() => {
      subiu = false;
    });
    if (anterior === 'saudavel' && !(subiu && (await aguardarSaude(o.versaoAtual)).ok))
      anterior = 'sem_saude';
    const r: ResultadoAtualizacao = {
      resultado: 'revertido',
      de: o.versaoAtual,
      tentou: pacote.versao,
      motivo,
      anterior,
      mensagem: MENSAGENS[motivo] + MENSAGENS_ANTERIOR[anterior],
      ...fim(),
    };
    d.log?.erro('atualizacao_revertida', { motivo, anterior, de: o.versaoAtual, tentou: pacote.versao });
    return r;
  }

  mkdirSync(p.raiz, { recursive: true });
  if (!adquirirTrava(p.trava, relogio.agora(), o.travaVencidaMs ?? PADROES_ATUALIZACAO.travaVencidaMs))
    return mantido('atualizacao_em_andamento');
  try {
    let bytes: Uint8Array;
    try {
      bytes = await d.baixador.baixar(pacote);
    } catch {
      return mantido('falha_no_download');
    }
    const conf = conferirPacote(bytes, pacote, chaves);
    if (!conf.ok) return mantido(conf.motivo);
    d.log?.info('atualizacao_pacote_conferido', { versao: pacote.versao, chave: conf.chaveId });

    try {
      rmSync(p.nova, { recursive: true, force: true });
      mkdirSync(p.nova, { recursive: true });
      writeFileSync(p.arquivoPacote, bytes);
      await d.extrator.extrair(p.arquivoPacote, p.nova);
      listarItensDoPacote(p.nova);
    } catch {
      rmSync(p.nova, { recursive: true, force: true });
      return mantido('pacote_invalido');
    } finally {
      rmSync(p.arquivoPacote, { force: true });
    }

    try {
      await d.servico.parar();
    } catch {
      // estado do serviço incerto: tenta deixá-lo de pé na versão atual, que não foi tocada
      await d.servico.iniciar().catch(() => undefined);
      rmSync(p.nova, { recursive: true, force: true });
      return mantido('falha_ao_parar');
    }

    try {
      trocarVersao(o.pasta, o.versaoAtual, pacote.versao);
    } catch {
      return await reverter('falha_na_troca');
    }
    try {
      await d.servico.iniciar();
    } catch {
      return await reverter('falha_na_subida');
    }
    const saude = await aguardarSaude(pacote.versao);
    if (!saude.ok) return await reverter(saude.motivo);

    d.log?.info('atualizacao_concluida', { de: o.versaoAtual, para: pacote.versao });
    return {
      resultado: 'atualizado',
      de: o.versaoAtual,
      para: pacote.versao,
      mensagem: MENSAGENS.atualizado,
      ...fim(),
    };
  } finally {
    rmSync(p.nova, { recursive: true, force: true });
    rmSync(p.trava, { force: true });
  }
}

/** Trava por arquivo (`wx`): só uma atualização por vez; trava vencida (tentativa que morreu) é retomada. */
function adquirirTrava(arquivo: string, agora: number, vencidaMs: number): boolean {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const fd = openSync(arquivo, 'wx');
      writeSync(fd, String(agora));
      closeSync(fd);
      return true;
    } catch {
      let desde = Number.NaN;
      try {
        desde = Number(readFileSync(arquivo, 'utf8'));
        if (!Number.isFinite(desde)) desde = statSync(arquivo).mtimeMs;
      } catch {
        // sumiu entre o open e a leitura: tenta de novo
        continue;
      }
      if (agora - desde < vencidaMs) return false;
      rmSync(arquivo, { force: true });
    }
  }
  return false;
}
