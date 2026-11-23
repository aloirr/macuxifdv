/**
 * "Zerar dados" da empresa no portal `config.` (pedido do dono do produto na v1.0.31; ADR 0068; desenho
 * docs/desenho/empresa-zerar.md; RN-PLA-12). Textos, liberação do botão e as três chamadas. Regra, códigos e frases só do SDK
 * (`empresa-zerar.ts`): o bloqueio vem pronto na prévia (o banco calcula com a `plataforma.zerar_bloqueado`); aqui só se junta com o
 * que foi digitado. A prévia é trabalho do worker: a tela pede (`pedirPreviaZerar`) e lê (`lerPreviaZerar`) até `pronta` ou `falhou`.
 */
import { ROTULO_ENTIDADE } from '@macuxi/integracao/contracts';
import {
  CODIGOS_ZERAR_EMPRESA,
  ENTIDADES_ZERAR,
  PreviaZerarSchema,
  ROTAS_ZERAR_EMPRESA,
  ZerarEmpresaSchema,
  codigoDeConfirmacaoConfere,
  mensagemDaPreviaZerar,
  mensagemDoZerar,
  type EntidadeZerar,
  type PreviaZerar,
  type ZerarEmpresa,
} from '@macuxi/platform-sdk';
import { formatInt } from '@macuxi/ui/web';

import { chamarPortal, ErroPortal, mensagemDoErro } from './portal-api';
import type { EstadoDasAcoes } from './portal-empresa-acoes';

export const TEXTOS_ZERAR = Object.freeze({
  zerar: 'Zerar dados',
  titulo: (empresa: string) => `Zerar dados de ${empresa}?`,
  tituloAndamento: (empresa: string) => `Zerar dados de ${empresa}`,
  /** Por entidade (aba Integração): "Zerar Clientes de <empresa>?". */
  tituloEntidades: (rotulos: string, empresa: string) => `Zerar ${rotulos} de ${empresa}?`,
  tituloAndamentoEntidades: (rotulos: string, empresa: string) => `Zerar ${rotulos} de ${empresa}`,
  levaJunto: 'Leva junto:',
  contando: 'Contando os dados…',
  sai: 'Apaga:',
  nadaASair: 'Não há dados para zerar.',
  /** Só no zerar da empresa inteira, que apaga os usuários não administradores (grupo `usuarios` no "Apaga:"). */
  ficam: 'Mantém: empresa, plano, administradores, perfis, parâmetros e conectores.',
  sufixoCodigo: 'para confirmar',
  senha: 'Sua senha',
  cancelar: 'Cancelar',
  fechar: 'Fechar',
  zerando: 'Zerando…',
  emAndamento: 'Em andamento…',
  concluido: (linhas: number) => `${formatInt(linhas)} ${linhas === 1 ? 'linha apagada' : 'linhas apagadas'}.`,
  lote: 'Lote',
  reenvio: 'Rode no servidor do Conector:',
});

/** Rótulos das entidades, na ordem de carga, separados por vírgula ("Clientes, Endereços de clientes"). */
export const rotulosDasEntidades = (lista: readonly EntidadeZerar[]): string => lista.map((e) => ROTULO_ENTIDADE[e]).join(', ');

/**
 * Comandos de reenvio depois do zerar (desenho §3: o Conector só relê o cursor sem estado local; o reenvio é `conector
 * carga-completa`): um por entidade afetada, ou `todas` quando são as 16. Lista vazia: nada a reenviar.
 */
export function comandosDeReenvio(afetadas: readonly EntidadeZerar[] | null | undefined): string[] {
  if (!afetadas?.length) return [];
  if (afetadas.length === ENTIDADES_ZERAR.length) return ['conector carga-completa todas'];
  return afetadas.map((e) => `conector carga-completa ${e}`);
}

/** Caminho (relativo ao `/v1`, como o `ROTAS_PORTAL`) de uma rota do zerar; `previaId` só na `previaLer`. */
export function rotaDoZerar(rota: keyof typeof ROTAS_ZERAR_EMPRESA, tenantId: string, previaId = ''): string {
  return ROTAS_ZERAR_EMPRESA[rota]
    .replace(/^\/v1/, '')
    .replace(':tenant_id', encodeURIComponent(tenantId))
    .replace(':previa_id', encodeURIComponent(previaId));
}

/** Item "Zerar dados" do menu "⋯": desligado na empresa em exclusão, com backup rodando ou com outro pedido da linha no ar. */
export function zerarLigadoNoMenu(est: Pick<EstadoDasAcoes, 'backupLigado' | 'situacaoLigada'>): boolean {
  return est.backupLigado && est.situacaoLigada;
}

/**
 * "Zerar dados" liga só com a prévia `pronta`, sem bloqueio, alguma linha a sair, o código da empresa conferindo e a senha
 * preenchida (RN-PLA-12).
 */
export function zerarLiberado(previa: PreviaZerar | undefined, codigoEmpresa: string, codigoDigitado: string, senha: string): boolean {
  return (
    previa?.situacao === 'pronta' &&
    previa.bloqueio === null &&
    (previa.total ?? 0) > 0 &&
    !!senha &&
    codigoDeConfirmacaoConfere(codigoDigitado, codigoEmpresa)
  );
}

/** A prévia ainda está sendo contada pelo worker: a tela lê de novo a cada `CONSULTA_PREVIA_ZERAR_MS`. */
export const previaCalculando = (previa: PreviaZerar | undefined): boolean => previa?.situacao === 'em_andamento';

/** O zerar desta empresa já roda (outra aba, outra pessoa): o diálogo vai direto ao andamento. */
export const zerarJaRodando = (previa: PreviaZerar | undefined): boolean =>
  previa?.situacao === 'pronta' && previa.bloqueio === CODIGOS_ZERAR_EMPRESA.zerarEmAndamento;

/** Frase da prévia que falhou no worker ou passou do prazo na tela (`erro_codigo`, pela `mensagemDaPreviaZerar`). */
export const fraseDaPreviaFalha = (previa: Pick<PreviaZerar, 'erro_codigo'>): string => mensagemDaPreviaZerar(previa.erro_codigo ?? '') ?? mensagemDoErro(null);

/** Frase de um código do zerar: a tabela do SDK (`mensagemDoZerar`); fora dela, a frase da API. */
export function fraseDoZerar(e: unknown): string {
  const f = e instanceof ErroPortal ? mensagemDoZerar(e.codigo) : null;
  return f ?? mensagemDoErro(e);
}

/** Recusa do POST: a senha errada vai para o campo senha (esvazia e volta o foco); o resto, para o bloco de erro. */
export function erroDoZerar(e: unknown): { texto: string; senha: boolean } {
  const senha = e instanceof ErroPortal && e.status === 403 && e.codigo === CODIGOS_ZERAR_EMPRESA.reautenticacaoFalhou;
  return { texto: fraseDoZerar(e), senha };
}

/** O que a fase de andamento mostra: giro, sucesso com as linhas apagadas ou a frase da falha. */
export function andamentoDoZerar(z: ZerarEmpresa | undefined): { tom: 'andamento' | 'success' | 'danger'; texto: string } {
  if (!z || z.situacao === 'em_andamento') return { tom: 'andamento', texto: TEXTOS_ZERAR.emAndamento };
  if (z.situacao === 'concluido') return { tom: 'success', texto: TEXTOS_ZERAR.concluido(z.linhas_apagadas ?? 0) };
  return { tom: 'danger', texto: mensagemDoZerar(z.erro_codigo ?? '') ?? mensagemDoErro(null) };
}

// ---------------------------------------------------------------------------------------------------------------- chamadas

/**
 * `POST …/zerar/previa` (202): o worker conta o que sai e o bloqueio. `id` gerado na tela (o mesmo id devolve a mesma prévia);
 * sem `entidades`: a empresa inteira.
 */
export const pedirPreviaZerar = (tenantId: string, id: string, entidades?: readonly EntidadeZerar[]): Promise<PreviaZerar> =>
  chamarPortal(rotaDoZerar('previa', tenantId), { metodo: 'POST', corpo: { id, ...(entidades?.length ? { entidades } : {}) }, schema: PreviaZerarSchema });

/** `GET …/zerar/previa/:previa_id`: a prévia pedida, em andamento, pronta ou falha. */
export const lerPreviaZerar = (tenantId: string, previaId: string): Promise<PreviaZerar> =>
  chamarPortal(rotaDoZerar('previaLer', tenantId, previaId), { schema: PreviaZerarSchema });

/** `POST …/zerar` (202). `id` gerado na tela: repetir o mesmo devolve o mesmo pedido. A senha vai só no corpo. */
export const pedirZerar = (
  tenantId: string,
  corpo: { id: string; codigo_confirmacao: string; senha: string; entidades?: readonly EntidadeZerar[] },
): Promise<ZerarEmpresa> => chamarPortal(rotaDoZerar('zerar', tenantId), { metodo: 'POST', corpo, schema: ZerarEmpresaSchema });

/** `GET …/zerar`: o zerar mais recente da empresa. */
export const lerZerar = (tenantId: string): Promise<ZerarEmpresa> => chamarPortal(rotaDoZerar('zerar', tenantId), { schema: ZerarEmpresaSchema });
