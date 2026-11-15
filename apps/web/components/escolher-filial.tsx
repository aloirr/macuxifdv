'use client';

/**
 * "Escolha a sua filial" (T-0176; RN-CORE-39, ADR 0056; spec docs/design/filial-cadastro-venda §5, telas 16a a 16e). Com a conta sem
 * filial de cadastro (403 `USUARIO_SEM_FILIAL`), o BKO abre só esta tela, na moldura do login e sem menu, até a filial ser salva.
 * - 16a carregando: o campo sem toque com "Carregando…" e o "Salvar" desabilitado;
 * - 16b escolher: as filiais em ordem alfabética, "Escolha…" no início; "Salvando…" durante o PUT;
 * - 16c empresa sem filial: o aviso e o "Tentar de novo" (busca a lista outra vez);
 * - 16d erro ao salvar (inclui o 409 `USUARIO_FILIAL_JA_INFORMADA`): o aviso acima do campo, a escolha continua; no 409 a tela
 *   relê o GET e, com a filial já definida, entra no Início;
 * - 16e salvo: `onSalvo` (o shell volta ao Início, com o menu);
 * - o GET falhou (rede, servidor): o `ErrorBlock` do kit com o "Tentar de novo";
 * - sem a ação `usuario.filial_editar` (`pode_informar=false`): só o aviso aprovado e o "Sair".
 * testIDs: filial.tela, filial.campo, filial.salvar, filial.sair, filial.erro, filial.sem-filiais, filial.tentar, filial.sem-permissao.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MinhaFilialCadastro } from '@macuxi/core/contracts';
import { MENSAGEM_USUARIO_SEM_FILIAL } from '@macuxi/platform-sdk';
import { api } from '@macuxi/platform-sdk/web';
import { Button, CLASSE_CAMPO_ACESSO, ErrorBlock, Notice } from '@macuxi/ui/web';
import { Moldura } from '@/components/login-screen';
import {
  depoisDeSalvar,
  buscarMinhaFilial,
  estadoDaEscolha,
  ROTA_MINHA_FILIAL,
  salvarMinhaFilial,
  TEXTOS_ESCOLHER_FILIAL as T,
  type EstadoEscolherFilial,
} from '@/lib/escolher-filial';

const ID_CAMPO = 'filial-cadastro';

export interface PropsTelaEscolherFilial {
  estado: EstadoEscolherFilial;
  filiais: readonly Pick<MinhaFilialCadastro['filiais'][number], 'id' | 'nome'>[];
  escolhida: string;
  salvando: boolean;
  erroSalvar: boolean;
  onEscolher: (id: string) => void;
  onSalvar: () => void;
  onTentar: () => void;
  onSair: () => void;
}

/** A tela em si (sem consulta): os estados da spec §5. */
export function TelaEscolherFilial(p: PropsTelaEscolherFilial) {
  const campo = useRef<HTMLSelectElement>(null);
  const comCampo = p.estado === 'carregando' || p.estado === 'escolher';
  useEffect(() => {
    if (p.estado === 'escolher') campo.current?.focus();
  }, [p.estado]);

  const sair = (
    <Button
      data-testid="filial.sair"
      variant="link"
      className="min-h-[44px] self-start text-[14px]"
      onClick={p.onSair}
    >
      {T.sair}
    </Button>
  );

  if (p.estado === 'sem_permissao') {
    return (
      <Moldura>
        <div data-testid="filial.tela" className="flex flex-col gap-5">
          <div data-testid="filial.sem-permissao" aria-live="polite">
            <Notice tone="danger">{MENSAGEM_USUARIO_SEM_FILIAL}</Notice>
          </div>
          {sair}
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <form
        data-testid="filial.tela"
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (p.estado === 'escolher' && p.escolhida && !p.salvando) p.onSalvar();
        }}
      >
        <h1 className="m-0 font-display text-[28px] font-extrabold">{T.titulo}</h1>
        <div aria-live="polite" className="contents">
          {p.estado === 'escolher' && p.erroSalvar ? (
            <div data-testid="filial.erro">
              <Notice tone="danger">{T.erroSalvar}</Notice>
            </div>
          ) : p.estado === 'sem_filiais' ? (
            <div data-testid="filial.sem-filiais">
              <Notice tone="warning">{T.semFiliais}</Notice>
            </div>
          ) : null}
        </div>
        {comCampo ? (
          <>
            <label htmlFor={ID_CAMPO} className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-ink">{T.rotulo}</span>
              <select
                id={ID_CAMPO}
                ref={campo}
                data-testid="filial.campo"
                className={CLASSE_CAMPO_ACESSO}
                disabled={p.estado === 'carregando' || p.salvando}
                value={p.estado === 'carregando' ? '' : p.escolhida}
                onChange={(e) => p.onEscolher(e.target.value)}
              >
                {p.estado === 'carregando' ? (
                  <option value="">{T.carregando}</option>
                ) : (
                  <>
                    <option value="">{T.escolha}</option>
                    {p.filiais.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
            <Button
              data-testid="filial.salvar"
              type="submit"
              variant="primary"
              disabled={p.estado === 'carregando' || !p.escolhida || p.salvando}
            >
              {p.salvando ? T.salvando : T.salvar}
            </Button>
          </>
        ) : p.estado === 'erro_carga' ? (
          <div data-testid="filial.erro-carga">
            <ErrorBlock message={T.erroCarga} onRetry={p.onTentar} />
          </div>
        ) : (
          <Button data-testid="filial.tentar" variant="primary" onClick={p.onTentar}>
            {T.tentar}
          </Button>
        )}
        {sair}
      </form>
    </Moldura>
  );
}

/** Chave do GET no cache do React Query. */
export const CHAVE_MINHA_FILIAL = ['core', 'eu', 'filial-cadastro'] as const;

/** A tela com o GET e o PUT de `eu/filial-cadastro`. `onSalvo`: a filial ficou definida (salva agora ou por outro admin). */
export function EscolherFilial({ onSalvo, onSair }: { onSalvo: () => void; onSair: () => void }) {
  const consulta = useQuery({
    queryKey: CHAVE_MINHA_FILIAL,
    queryFn: () => buscarMinhaFilial((rota) => api<unknown>(rota)),
    staleTime: 0,
    retry: false,
  });
  const [escolhida, setEscolhida] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState(false);
  const estado = estadoDaEscolha({
    carregando: consulta.isLoading,
    erro: consulta.isError,
    dados: consulta.data,
  });

  useEffect(() => {
    if (estado === 'ja_tem_filial') onSalvo();
  }, [estado, onSalvo]);

  const salvar = async () => {
    setSalvando(true);
    setErroSalvar(false);
    const r = await salvarMinhaFilial(escolhida, (corpo) =>
      api(ROTA_MINHA_FILIAL, { method: 'PUT', body: corpo }),
    );
    setSalvando(false);
    const d = depoisDeSalvar(r);
    if (d.entrar) return onSalvo();
    setErroSalvar(d.erro);
    // 409: outra pessoa já informou a filial; o GET relido leva ao Início (estado `ja_tem_filial`)
    if (d.reler) void consulta.refetch();
  };

  return (
    <TelaEscolherFilial
      estado={estado}
      filiais={consulta.data?.filiais ?? []}
      escolhida={escolhida}
      salvando={salvando}
      erroSalvar={erroSalvar}
      onEscolher={(id) => {
        setEscolhida(id);
        setErroSalvar(false);
      }}
      onSalvar={() => void salvar()}
      onTentar={() => void consulta.refetch()}
      onSair={onSair}
    />
  );
}
