/**
 * Resultado tipado da atualização automática do Conector (T-0116): `atualizado`, `mantido` ou `revertido`, sempre com um
 * motivo em CÓDIGO e um texto curto para o monitor/`status` mostrar. Sem dado pessoal: nunca leva URL do pacote, caminho de
 * pasta, nome de usuário nem mensagem crua de exceção — só códigos e versões.
 *
 * O schema fica no próprio Conector enquanto o módulo está isolado (não ligado ao executor nem ao sinal). Quando o monitor
 * passar a receber o resultado pelo Hub, ele sobe para `modules/integracao/contracts` (pendência registrada na entrega).
 */
import { VersaoSemver } from '@macuxi/integracao/contracts';
import { z } from 'zod';

/** Por que a versão atual foi mantida (nada foi trocado; o serviço segue na versão de antes). */
export const MotivoMantido = z.enum([
  'sem_pacote',
  'ja_atualizado',
  'atualizacao_em_andamento',
  'falha_no_download',
  'sha256_diferente',
  'assinatura_ausente',
  'assinatura_invalida',
  'chave_desconhecida',
  'chave_invalida',
  'pacote_invalido',
  'falha_ao_parar',
]);
export type MotivoMantido = z.infer<typeof MotivoMantido>;

/** Por que a versão nova foi desfeita (a anterior voltou do backup). */
export const MotivoReversao = z.enum(['falha_na_troca', 'falha_na_subida', 'sem_saude', 'versao_divergente']);
export type MotivoReversao = z.infer<typeof MotivoReversao>;

/** Como ficou a versão anterior depois da volta. */
export const SituacaoAnterior = z.enum(['saudavel', 'sem_saude', 'falha_ao_restaurar']);
export type SituacaoAnterior = z.infer<typeof SituacaoAnterior>;

const Base = {
  /** Instante UTC do fim da tentativa. */
  em: z.string().datetime(),
  duracao_ms: z.number().int().nonnegative(),
  mensagem: z.string().min(1).max(300),
};

export const ResultadoAtualizacao = z.discriminatedUnion('resultado', [
  z.object({ resultado: z.literal('atualizado'), de: VersaoSemver, para: VersaoSemver, ...Base }).strict(),
  z
    .object({
      resultado: z.literal('mantido'),
      versao: VersaoSemver,
      /** Versão oferecida pela política do Hub, quando havia. */
      oferecida: VersaoSemver.nullable(),
      motivo: MotivoMantido,
      ...Base,
    })
    .strict(),
  z
    .object({
      resultado: z.literal('revertido'),
      de: VersaoSemver,
      tentou: VersaoSemver,
      motivo: MotivoReversao,
      anterior: SituacaoAnterior,
      ...Base,
    })
    .strict(),
]);
export type ResultadoAtualizacao = z.infer<typeof ResultadoAtualizacao>;

/** Texto curto, em português, para cada motivo (sem dado pessoal). */
export const MENSAGENS: Record<MotivoMantido | MotivoReversao | 'atualizado', string> = {
  atualizado: 'Conector atualizado e respondendo na versão nova.',
  sem_pacote: 'O Hub não ofereceu pacote de atualização.',
  ja_atualizado: 'A versão oferecida não é mais nova que a instalada.',
  atualizacao_em_andamento: 'Outra atualização já está em andamento.',
  falha_no_download: 'Não foi possível baixar o pacote; tenta de novo no próximo ciclo.',
  sha256_diferente: 'O SHA-256 do pacote baixado não confere; pacote descartado.',
  assinatura_ausente: 'O pacote veio sem assinatura; nada foi instalado.',
  assinatura_invalida: 'A assinatura do pacote não confere com a chave do Macuxi; nada foi instalado.',
  chave_desconhecida:
    'O pacote foi assinado com uma chave que este Conector não conhece; nada foi instalado.',
  chave_invalida: 'A chave pública embutida não é Ed25519 nem RSA 3072+; nada foi instalado.',
  pacote_invalido: 'O pacote não tem o formato esperado; nada foi instalado.',
  falha_ao_parar: 'Não foi possível parar o serviço para trocar a versão; versão atual mantida.',
  falha_na_troca: 'Falha ao trocar os arquivos; a versão anterior foi restaurada.',
  falha_na_subida: 'A versão nova não subiu; a versão anterior foi restaurada.',
  sem_saude: 'A versão nova não respondeu à verificação de saúde no prazo; a versão anterior foi restaurada.',
  versao_divergente:
    'O serviço respondeu com outra versão depois da troca; a versão anterior foi restaurada.',
};

/** Complemento da mensagem quando a volta não deixou a versão anterior saudável. */
export const MENSAGENS_ANTERIOR: Record<SituacaoAnterior, string> = {
  saudavel: '',
  sem_saude: ' Atenção: a versão anterior também não respondeu à saúde; verifique o serviço.',
  falha_ao_restaurar:
    ' Atenção: não foi possível restaurar todos os arquivos; reinstale o pacote anterior (§7.4).',
};
