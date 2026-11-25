/**
 * Troca voluntária da senha (T-0178; RF-CORE-01; RN-CORE-32 e RN-CORE-34; docs/design/trocar-senha/spec.md §4 e §5) e a
 * leitura do erro de login que ela reaproveita. Funções puras, sem React Native, usadas pelo app (Campo/Gestão) e pelo BKO/portal
 * (RD-3108: uma tabela só, sem cópia).
 */
import { ehSemConexao } from '@macuxi/platform-sdk';
import { CODIGOS_AUTH, MENSAGEM_BLOQUEADO_ADMIN, MENSAGEM_CREDENCIAIS, MENSAGEM_SENHA_A_TROCAR, MENSAGEM_SENHA_VENCIDA, MENSAGEM_SESSAO, mensagemBloqueioPorTentativas, mensagemMuitasTentativas } from './auth';
import { codigoDoErro, repeticaoDaSenha, TEXTOS_CRIE_SENHA, TEXTOS_TROCAR_SENHA, textoDoErroDaSenha } from './ciclo-senha';
import { AVISO_APARELHO_LIMPO, CODIGO_DISPOSITIVO_BLOQUEADO } from './dispositivo';
import { faltasNaSenha } from './senha';

/** Códigos que o shell/SDK usam quando o endereço respondeu, mas não é um servidor Macuxi (ou a resposta não bate com o contrato). */
export const CODIGOS_SERVIDOR_INVALIDO = ['SERVIDOR_INVALIDO', 'RESPOSTA_INVALIDA'] as const;

/** Resposta que não é de um servidor Macuxi: código dedicado, falha de contrato (Zod) ou 404/405 sem código da API. */
export function ehServidorInvalido(e: unknown): boolean {
  const x = e as { codigo?: unknown; name?: unknown; status?: unknown } | null;
  if (typeof x?.codigo === 'string' && (CODIGOS_SERVIDOR_INVALIDO as readonly string[]).includes(x.codigo)) return true;
  if (x?.name === 'ZodError') return true;
  return (x?.status === 404 || x?.status === 405) && typeof x?.codigo !== 'string';
}

/** Mensagem para o usuário a partir do erro da API (códigos de `CODIGOS_AUTH`) ou de rede. Três casos distintos de conexão/servidor/credencial. */
export function mensagemDeErroDeLogin(e: unknown): string {
  if (ehSemConexao(e)) return 'Sem conexão ou o servidor não respondeu. Confira a internet e o endereço do servidor e tente de novo.';
  if (ehServidorInvalido(e)) return 'Este endereço não é um servidor Macuxi. Confira o endereço em Servidor, teste de novo e só então entre.';
  const x = e as { codigo?: unknown; message?: unknown; detalhes?: Record<string, unknown> } | null;
  const detalhes = x?.detalhes;
  switch (x?.codigo) {
    case CODIGOS_AUTH.credenciais:
      return MENSAGEM_CREDENCIAIS;
    case CODIGOS_AUTH.bloqueado:
      // RN-CORE-01: `minutos_restantes` marca o bloqueio temporário por tentativas (mesmo código: o APK em uso segue funcionando)
      return detalhes?.minutos_restantes === undefined ? MENSAGEM_BLOQUEADO_ADMIN : mensagemBloqueioPorTentativas(detalhes.minutos_restantes);
    case CODIGO_DISPOSITIVO_BLOQUEADO:
      return AVISO_APARELHO_LIMPO;
    case CODIGOS_AUTH.muitasTentativas:
      return mensagemMuitasTentativas(detalhes?.retry_after_s);
    case CODIGOS_AUTH.sessao:
      return MENSAGEM_SESSAO;
    case CODIGOS_AUTH.senhaVencida:
      return MENSAGEM_SENHA_VENCIDA;
    case CODIGOS_AUTH.senhaATrocar:
      // o app novo navega para "Crie sua senha" pelo código (senha.ts); este texto é só a rede de segurança
      return MENSAGEM_SENHA_A_TROCAR;
    case 'PERFIL_FORA_DO_APP':
      return typeof x?.message === 'string' && x.message ? x.message : 'Este perfil não usa este aplicativo. Use o aplicativo ou o painel indicado pela sua empresa.';
    case 'AUTENTICACAO_INDISPONIVEL':
      return 'O login está indisponível no momento. Tente de novo em alguns minutos; se continuar, avise o suporte.';
    default:
      return 'Não foi possível entrar agora. Tente de novo; se continuar, avise o suporte.';
  }
}

export interface ResultadoDoPrecheck {
  ok: boolean;
  atualVazia: boolean;
  /** Para onde vai o foco quando não envia. */
  foco: 'atual' | 'nova' | 'repita' | null;
}

/** Spec §4: o que a tela confere antes de chamar a API (RN-CORE-32 e as duas digitações iguais; senha atual não vazia). A API revalida tudo. */
export function precheckDaTrocaVoluntaria(
  atual: string,
  nova: string,
  repetida: string,
): ResultadoDoPrecheck {
  const atualVazia = atual === '';
  const faltas = faltasNaSenha(nova).length > 0;
  const diferentes = repeticaoDaSenha(nova, repetida) !== 'igual';
  const foco = atualVazia ? 'atual' : faltas ? 'nova' : diferentes ? 'repita' : null;
  return {
    ok: !atualVazia && !faltas && !diferentes,
    atualVazia,
    foco,
  };
}

export type AcaoAposErroDaTrocaVoluntaria = 'limpar_atual' | 'limpar_novas' | 'destacar' | 'ficar';
export interface ErroDaTrocaVoluntaria {
  /** Texto do `Banner` do topo; `null` = nenhum aviso (a lista de regras já diz). */
  texto: string | null;
  tom: 'danger' | 'warning';
  acao: AcaoAposErroDaTrocaVoluntaria;
}

/** Spec §5: respostas da API na troca pelo Perfil. Um aviso só; texto sempre em português com a ação seguinte. */
export function erroDaTrocaVoluntaria(e: unknown, senhaNova?: string): ErroDaTrocaVoluntaria {
  if (ehSemConexao(e) || (e as { status?: unknown } | null)?.status === 0)
    return { texto: TEXTOS_TROCAR_SENHA.semInternet, tom: 'warning', acao: 'ficar' };
  switch (codigoDoErro(e)) {
    case 'CREDENCIAIS_INVALIDAS':
      return { texto: TEXTOS_TROCAR_SENHA.atualErrada, tom: 'danger', acao: 'limpar_atual' };
    case 'RN-CORE-34':
      return { texto: TEXTOS_TROCAR_SENHA.igualAAtual, tom: 'danger', acao: 'limpar_novas' };
    case 'RN-CORE-32': {
      // com faltas, a lista de regras mostra (sem aviso); sem faltas só sobra "igual ao e-mail"
      const igualAoEmail = textoDoErroDaSenha(e, senhaNova) === TEXTOS_CRIE_SENHA.igualAoEmail;
      return { texto: igualAoEmail ? TEXTOS_CRIE_SENHA.igualAoEmail : null, tom: 'danger', acao: 'destacar' };
    }
    case 'MUITAS_TENTATIVAS':
    case 'USUARIO_BLOQUEADO':
    case 'DISPOSITIVO_BLOQUEADO':
    case 'SENHA_TEMPORARIA_VENCIDA':
      return { texto: mensagemDeErroDeLogin(e), tom: 'danger', acao: 'ficar' };
    default:
      return { texto: TEXTOS_TROCAR_SENHA.outro, tom: 'danger', acao: 'ficar' };
  }
}
