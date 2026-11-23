/**
 * "Zerar dados" da empresa no portal `config.` (pedido do dono do produto na v1.0.30; ADR 0068; desenho
 * docs/desenho/empresa-zerar.md; RN-PLA-12). Textos, liberação do botão e as três chamadas. Regra, códigos e frases só do SDK
 * (`empresa-zerar.ts`): o bloqueio vem pronto da prévia (a API calcula com `conferirZerar`); aqui só se junta com o que foi digitado.
 */
import {
  CODIGOS_ZERAR_EMPRESA,
  PreviaZerarEmpresaSchema,
  ROTAS_ZERAR_EMPRESA,
  ZerarEmpresaSchema,
  codigoDeConfirmacaoConfere,
  mensagemDoZerar,
  type PreviaZerarEmpresa,
  type ZerarEmpresa,
} from '@macuxi/platform-sdk';
import { formatInt } from '@macuxi/ui/web';

import { chamarPortal, ErroPortal, mensagemDoErro } from './portal-api';
import type { EstadoDasAcoes } from './portal-empresa-acoes';

export const TEXTOS_ZERAR = Object.freeze({
  zerar: 'Zerar dados',
  titulo: (empresa: string) => `Zerar dados de ${empresa}?`,
  contando: 'Contando os dados…',
  sai: 'Vão ser apagados:',
  nadaASair: 'Não há dados para zerar.',
  ficam: 'Ficam a empresa, o plano, os usuários, os perfis, os parâmetros e os conectores.',
  sufixoCodigo: 'para confirmar',
  senha: 'Sua senha',
  cancelar: 'Cancelar',
  fechar: 'Fechar',
  zerando: 'Zerando…',
  emAndamento: 'Zerando os dados…',
  concluido: (linhas: number) => `Dados zerados: ${formatInt(linhas)} ${linhas === 1 ? 'linha apagada' : 'linhas apagadas'}.`,
});

/** Caminho (relativo ao `/v1`, como o `ROTAS_PORTAL`) de uma rota do zerar. */
export function rotaDoZerar(rota: keyof typeof ROTAS_ZERAR_EMPRESA, tenantId: string): string {
  return ROTAS_ZERAR_EMPRESA[rota].replace(/^\/v1/, '').replace(':tenant_id', encodeURIComponent(tenantId));
}

/** Item "Zerar dados" do menu "⋯": desligado na empresa em exclusão, com backup rodando ou com outro pedido da linha no ar. */
export function zerarLigadoNoMenu(est: Pick<EstadoDasAcoes, 'backupLigado' | 'situacaoLigada'>): boolean {
  return est.backupLigado && est.situacaoLigada;
}

/** "Zerar dados" liga só com a prévia sem bloqueio, alguma linha a sair, o código conferindo e a senha preenchida (RN-PLA-12). */
export function zerarLiberado(previa: PreviaZerarEmpresa | undefined, codigoDigitado: string, senha: string): boolean {
  return !!previa && previa.bloqueio === null && previa.total_linhas > 0 && !!senha && codigoDeConfirmacaoConfere(codigoDigitado, previa.codigo);
}

/** O zerar desta empresa já roda (outra aba, outra pessoa): o diálogo vai direto ao andamento. */
export const zerarJaRodando = (previa: PreviaZerarEmpresa | undefined): boolean => previa?.bloqueio === CODIGOS_ZERAR_EMPRESA.zerarEmAndamento;

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

/** `GET …/zerar/previa`: contagem por tabela do que sai e o bloqueio atual. */
export const lerPreviaZerar = (tenantId: string): Promise<PreviaZerarEmpresa> =>
  chamarPortal(rotaDoZerar('previa', tenantId), { schema: PreviaZerarEmpresaSchema });

/** `POST …/zerar` (202). `id` gerado na tela: repetir o mesmo devolve o mesmo pedido. A senha vai só no corpo. */
export const pedirZerar = (tenantId: string, corpo: { id: string; codigo_confirmacao: string; senha: string }): Promise<ZerarEmpresa> =>
  chamarPortal(rotaDoZerar('zerar', tenantId), { metodo: 'POST', corpo, schema: ZerarEmpresaSchema });

/** `GET …/zerar`: o zerar mais recente da empresa. */
export const lerZerar = (tenantId: string): Promise<ZerarEmpresa> => chamarPortal(rotaDoZerar('zerar', tenantId), { schema: ZerarEmpresaSchema });
