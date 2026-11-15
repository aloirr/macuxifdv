/**
 * Backup, Inativar/Reativar e Excluir na lista de Empresas do portal `config.` (pedido R-20261114-195600-alexandre; ADR 0052;
 * spec docs/design/telas/portal-config-enxuto.md §15). Puro, para teste: textos, o que a coluna Backup mostra, quais ações do
 * menu ficam ligadas e a frase de cada recusa da API. Regras e códigos só do SDK (`empresa-acoes.ts`): aqui nada decide se a
 * exclusão libera; a tela lê `acoes.exclusao_bloqueada` (a API calcula com `conferirExclusao`).
 */
import { CODIGOS_ACOES_EMPRESA, ROTAS_ACOES_EMPRESA, ROTULO_STATUS_EMPRESA, type AcoesDaEmpresa, type EmpresaResumoSchema, type StatusEmpresa } from '@macuxi/platform-sdk';
import { formatDateTimeFull, type BadgeTone } from '@macuxi/ui/web';

import { ErroPortal } from './portal-api';

const C = CODIGOS_ACOES_EMPRESA;

/** Item da lista de empresas (`EmpresaResumoSchema`; o SDK não exporta o tipo). */
export type EmpresaResumo = ReturnType<typeof EmpresaResumoSchema.parse>;

export const TEXTOS_EMPRESA_ACOES = Object.freeze({
  colunaBackup: 'Backup',
  colunaAcoes: 'Ações',
  backup: 'Backup',
  inativar: 'Inativar',
  reativar: 'Reativar',
  reativando: 'Reativando…',
  excluir: 'Excluir',
  nenhum: 'Nenhum',
  emAndamento: 'Em andamento',
  cancelar: 'Cancelar',
  inativando: 'Inativando…',
  tituloInativar: (empresa: string) => `Inativar ${empresa}?`,
  corpoInativar: 'Todos os acessos ficam bloqueados.',
  tituloExcluir: (empresa: string) => `Excluir ${empresa}?`,
  backupUsado: 'Backup usado:',
  semVolta: 'Não dá para desfazer.',
  sufixoCodigo: 'para confirmar',
  senha: 'Sua senha',
  excluirEmpresa: 'Excluir empresa',
  excluindo: 'Excluindo…',
  backupNaoTerminou: (empresa: string) => `O backup da ${empresa} não terminou. Tente de novo.`,
  excluida: (empresa: string) => `${empresa} excluída.`,
  exclusaoNaoTerminou: (empresa: string) => `A exclusão da ${empresa} não terminou. Tente de novo.`,
});

/** Motivo do Excluir desabilitado, embaixo da data na coluna Backup (§15.1). `null` = sem linha de motivo. */
const MOTIVO_DO_BLOQUEIO: Partial<Record<string, string>> = {
  [C.exclusaoEmpresaAtiva]: 'Inative para excluir',
  [C.exclusaoBackupAntesDaInativacao]: 'Anterior à inativação',
  [C.exclusaoBackupVencido]: 'Vencido (mais de 7 dias)',
};

/** Situação da empresa em rótulo do SDK (`ROTULO_STATUS_EMPRESA`); valor fora da lista: 1ª letra maiúscula. */
export function rotuloDoStatus(status: string): string {
  const r = (ROTULO_STATUS_EMPRESA as Readonly<Record<string, string>>)[status];
  return r ?? (status ? status.charAt(0).toUpperCase() + status.slice(1) : '—');
}

/** Selo da Situação: "Ativa" verde; "Inativa" e o resto, neutro (§15.1). */
export function tomDoStatus(status: string): BadgeTone {
  return status === 'ativo' ? 'success' : 'neutral';
}

export interface CelulaBackup {
  /** Data e hora do último backup pronto, no fuso da empresa; "Em andamento" (com giro) ou "Nenhum". */
  texto: string;
  andamento: boolean;
  /** Por que o Excluir está desabilitado, quando a linha de cima não diz. */
  motivo: string | null;
}

/**
 * O que a coluna Backup mostra. `pedindo` = o clique em Backup já foi e a resposta ainda não chegou (a linha vira "Em andamento"
 * na hora). O backup que falhou não aparece: a célula fica no anterior (ou "Nenhum"), e o aviso de erro fica no topo da lista.
 */
export function celulaDoBackup(acoes: AcoesDaEmpresa, fuso: string, pedindo = false): CelulaBackup {
  const b = acoes.ultimo_backup;
  const andamento = pedindo || b?.situacao === 'em_andamento';
  const texto = andamento ? TEXTOS_EMPRESA_ACOES.emAndamento : b?.situacao === 'pronto' && b.concluido_em ? formatDateTimeFull(b.concluido_em, fuso) : TEXTOS_EMPRESA_ACOES.nenhum;
  const motivo = acoes.exclusao_bloqueada ? (MOTIVO_DO_BLOQUEIO[acoes.exclusao_bloqueada] ?? null) : null;
  return { texto, andamento, motivo };
}

export interface EstadoDasAcoes {
  backupLigado: boolean;
  /** `inativar` na ativa, `reativar` na inativa; `null` na empresa em exclusão. */
  situacao: 'inativar' | 'reativar' | null;
  situacaoLigada: boolean;
  excluirLigado: boolean;
}

/** Quais itens do menu ficam ligados. `ocupada` = esta linha já tem um pedido no ar (backup, reativar ou exclusão). */
export function estadoDasAcoes(status: string, acoes: AcoesDaEmpresa, o: { pedindoBackup?: boolean; ocupada?: boolean } = {}): EstadoDasAcoes {
  const st = status as StatusEmpresa;
  const emExclusao = st === 'encerrado' || acoes.exclusao?.situacao === 'em_andamento';
  const backupRodando = !!o.pedindoBackup || acoes.ultimo_backup?.situacao === 'em_andamento';
  return {
    backupLigado: !emExclusao && !backupRodando,
    situacao: emExclusao ? null : st === 'ativo' ? 'inativar' : 'reativar',
    situacaoLigada: !emExclusao && !o.ocupada,
    excluirLigado: !emExclusao && !backupRodando && !o.ocupada && acoes.exclusao_bloqueada === null,
  };
}

/** Caminho (relativo ao `/v1`, como o `ROTAS_PORTAL`) de uma rota de ações da empresa do SDK. */
export function rotaDaAcao(rota: keyof typeof ROTAS_ACOES_EMPRESA, tenantId: string, backupId?: string): string {
  return ROTAS_ACOES_EMPRESA[rota]
    .replace(/^\/v1/, '')
    .replace(':tenant_id', encodeURIComponent(tenantId))
    .replace(':backup_id', encodeURIComponent(backupId ?? ''));
}

export type ErroDoExcluir =
  /** Uma linha em `danger` embaixo do corpo do diálogo (§15.2). */
  | { tipo: 'linha'; texto: string; senha: boolean }
  /** Outro erro: o `ErrorBlock` padrão, com a mensagem da API. */
  | { tipo: 'bloco' };

/** Recusa do `POST …/exclusao` em frase curta (§15.2). A senha errada esvazia o campo e põe o foco nele. */
export function erroDoExcluir(e: unknown): ErroDoExcluir {
  if (!(e instanceof ErroPortal)) return { tipo: 'bloco' };
  if (e.status === 403 && e.codigo === C.reautenticacaoFalhou) return { tipo: 'linha', texto: 'Senha incorreta.', senha: true };
  if (e.status === 422) {
    if (e.codigo === C.exclusaoSemBackup || e.codigo === C.exclusaoBackupAntesDaInativacao || e.codigo === C.exclusaoBackupVencido)
      return { tipo: 'linha', texto: 'Faça o backup antes de excluir.', senha: false };
    if (e.codigo === C.exclusaoEmpresaAtiva) return { tipo: 'linha', texto: 'Inative a empresa antes de excluir.', senha: false };
    if (e.codigo === C.exclusaoCodigoNaoConfere) return { tipo: 'linha', texto: 'Código não confere.', senha: false };
  }
  return { tipo: 'bloco' };
}
