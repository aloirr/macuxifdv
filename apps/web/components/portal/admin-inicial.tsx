'use client';

/**
 * Bloco "Administrador da empresa" da Nova empresa (spec docs/design/telas/portal-config-enxuto.md §4 item 3; RN-CORE-34), o mesmo
 * no fluxo com planos (`passo-empresa.tsx`) e no passo antigo do servidor sem planos (`passo-empresa-legado.tsx`) (RD-2620): nome,
 * e-mail e a senha inicial com a lista das regras da RN-CORE-32 ao vivo. Senha vazia: só "Informe a senha inicial.", com as regras
 * neutras; o vermelho volta com senha digitada (RD-0272). A senha só vive no estado de quem chama (nunca em storage, URL ou log).
 * testIDs: empresa.admin, empresa.admin-erro, empresa.admin-nome, empresa.admin-email, empresa.admin-senha, empresa.admin-regras.
 */
import { useState } from 'react';
import { faltasNaSenha, mensagemDaSenha, SENHA_MIN_CARACTERES } from '@macuxi/core/contracts';
import { CampoSenha, Notice, Panel, RegrasDaSenha, SENHA_ATENDE_AS_REGRAS } from '@macuxi/ui/web';

import { Campo } from '@/components/campo-acesso';
import { TEXTOS_ADMIN, type AdminDoForm } from '@/lib/portal-nova-empresa';

export interface PropsAdminInicial {
  admin: AdminDoForm;
  /** Erros por campo (`admin.nome`, `admin.email`, `admin.senha`). */
  erros: Readonly<Record<string, string>>;
  /** Erro do bloco inteiro (422 `RN-CORE-34`). */
  erroAdmin: string | null;
  /** Tentou criar com a senha fora da RN-CORE-32: as faltas ficam em vermelho. */
  destacarSenha: boolean;
  aoMudar: (campo: keyof AdminDoForm, valor: string) => void;
}

export function AdminInicial({ admin, erros, erroAdmin, destacarSenha, aoMudar }: PropsAdminInicial) {
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const faltas = faltasNaSenha(admin.senha);
  return (
    <Panel title={TEXTOS_ADMIN.titulo}>
      <div data-testid="empresa.admin" className="flex flex-col gap-4">
        {erroAdmin && (
          <div data-testid="empresa.admin-erro">
            <Notice tone="danger">{erroAdmin}</Notice>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome" testId="empresa.admin-nome" autoComplete="off" value={admin.nome} erro={erros['admin.nome']} onChange={(e) => aoMudar('nome', e.target.value)} />
          <Campo rotulo="E-mail" testId="empresa.admin-email" type="email" autoComplete="off" spellCheck={false} value={admin.email} erro={erros['admin.email']} onChange={(e) => aoMudar('email', e.target.value)} />
        </div>
        <div className="flex w-full flex-col gap-2 sm:max-w-[calc(50%-8px)]">
          <CampoSenha
            id="empresa-admin-senha"
            rotulo="Senha inicial"
            testId="empresa.admin-senha"
            finalidade="criacao"
            visivel={senhaVisivel}
            onAlternar={() => setSenhaVisivel((v) => !v)}
            descrito="empresa-admin-senha-regras"
            value={admin.senha}
            erro={erros['admin.senha']}
            onChange={(e) => aoMudar('senha', e.target.value)}
          />
          <RegrasDaSenha
            id="empresa-admin-senha-regras"
            testId="empresa.admin-regras"
            faltas={faltas}
            destacar={destacarSenha && admin.senha !== '' && faltas.length > 0}
            minimo={SENHA_MIN_CARACTERES}
            resumo={mensagemDaSenha(faltas, admin.senha) ?? SENHA_ATENDE_AS_REGRAS}
          />
          <span className="text-[12px] text-ink-2">{TEXTOS_ADMIN.passeASenha}</span>
        </div>
      </div>
    </Panel>
  );
}
