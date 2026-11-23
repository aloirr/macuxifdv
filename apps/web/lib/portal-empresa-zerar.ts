/**
 * "Zerar dados" da empresa no portal `config.` (pedido do dono do produto na v1.0.31; ADR 0068; desenho
 * docs/desenho/empresa-zerar.md; RN-PLA-12). Textos, liberação do botão e as três chamadas. Regra, códigos e frases só do SDK
 * (`empresa-zerar.ts`): o bloqueio vem pronto da prévia (a API calcula com `conferirZerar`); aqui só se junta com o que foi digitado.
 */
import { ROTULO_ENTIDADE } from '@macuxi/integracao/contracts';
import {
  CODIGOS_ZERAR_EMPRESA,
  ENTIDADES_ZERAR,
  PreviaZerarEmpresaSchema,
  ROTAS_ZERAR_EMPRESA,
  ZerarEmpresaSchema,
  codigoDeConfirmacaoConfere,
  mensagemDoZerar,
  type EntidadeZerar,
  type PreviaZerarEmpresa,
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
  ficam: 'Mantém: empresa, plano, usuários, perfis, parâmetros e conectores.',
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

/** `GET …/zerar/previa[?entidades=a,b]`: contagem por tabela do que sai e o bloqueio atual. Sem `entidades`: a empresa inteira. */
export const lerPreviaZerar = (tenantId: string, entidades?: readonly EntidadeZerar[]): Promise<PreviaZerarEmpresa> =>
  chamarPortal(rotaDoZerar('previa', tenantId), { schema: PreviaZerarEmpresaSchema, query: { entidades: entidades?.length ? entidades.join(',') : undefined } });

/** `POST …/zerar` (202). `id` gerado na tela: repetir o mesmo devolve o mesmo pedido. A senha vai só no corpo. */
export const pedirZerar = (
  tenantId: string,
  corpo: { id: string; codigo_confirmacao: string; senha: string; entidades?: readonly EntidadeZerar[] },
): Promise<ZerarEmpresa> => chamarPortal(rotaDoZerar('zerar', tenantId), { metodo: 'POST', corpo, schema: ZerarEmpresaSchema });

/** `GET …/zerar`: o zerar mais recente da empresa. */
export const lerZerar = (tenantId: string): Promise<ZerarEmpresa> => chamarPortal(rotaDoZerar('zerar', tenantId), { schema: ZerarEmpresaSchema });
