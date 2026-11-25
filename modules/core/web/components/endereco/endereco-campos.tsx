'use client';

import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { UFS_BRASIL, formatarCep } from '@macuxi/comum/endereco';
import { Button, CampoFormulario, IconAlert } from '@macuxi/ui/web';
import { ROTULOS_ENDERECO } from '../../../app/lib/pre-cadastro-formulario';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';
import { cepTemOitoDigitos, ERRO_CEP_INVALIDO } from '../../../contracts';
import { aplicarCep, CENTRO_PADRAO, type CampoEndereco, type FormEndereco } from '../../lib/endereco';
import { pesquisarCep } from '../../lib/rotas-criar-api';

const PontoNoMapa = dynamic(() => import('./ponto-no-mapa'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-neutral-soft text-[13px] text-ink-2">Carregando mapa…</div>,
});

export interface EnderecoCamposProps {
  value: FormEndereco;
  onChange: (v: FormEndereco) => void;
  /** erros já calculados (`errosDoEndereco`); só aparecem depois de a pessoa tentar salvar */
  erros?: Partial<Record<CampoEndereco, string>>;
  /** só no mapa; sem ele, o centro padrão */
  centro?: [number, number];
  disabled?: boolean;
  /** prefixo dos `data-testid` */
  testId: string;
  /** Endereço do usuário: sem o ponto no mapa e com o botão "Pesquisar CEP"; o ponto já gravado fica como está (não é editado aqui). */
  semMapa?: boolean;
}

/**
 * Componente único do endereço com o ponto no mapa (T-0191, RN-CORE-75; spec §5): CEP, rua, número, bairro, cidade, UF e o mapa de
 * 150 px com o marcador arrastável. Vale para o "Outro endereço" do diálogo da base; com `semMapa`, para a casa (gavetas Novo e Editar usuário), sem o mapa e com "Pesquisar CEP".
 */
export function EnderecoCampos({ value, onChange, erros = {}, centro, disabled, testId, semMapa }: EnderecoCamposProps) {
  const set = (p: Partial<FormEndereco>) => onChange({ ...value, ...p });
  const [pesquisando, setPesquisando] = useState(false);
  const [erroCep, setErroCep] = useState<string | null>(null);
  // a resposta se aplica ao formulário de agora (não ao do clique): o que foi digitado durante a espera fica
  const atual = useRef(value);
  atual.current = value;
  const pesquisar = async () => {
    setErroCep(null);
    if (!cepTemOitoDigitos(value.cep)) return setErroCep(ERRO_CEP_INVALIDO);
    setPesquisando(true);
    try {
      onChange(aplicarCep(atual.current, await pesquisarCep(value.cep)));
    } catch (e) {
      setErroCep(errorMessage(e));
    } finally {
      setPesquisando(false);
    }
  };
  const campo = (c: Exclude<CampoEndereco, 'ponto' | 'uf'>, extra: { classe?: string; maxLength?: number; inputMode?: 'numeric'; formatar?: (v: string) => string } = {}) => (
    <CampoFormulario rotulo={ROTULOS_ENDERECO[c]} erro={c === 'cep' ? (semMapa ? undefined : (erros.cep ?? erroCep ?? undefined)) : erros[c]} className={extra.classe}>
      <input
        value={value[c]}
        maxLength={extra.maxLength}
        inputMode={extra.inputMode}
        disabled={disabled}
        aria-invalid={erros[c] || (c === 'cep' && erroCep) ? true : undefined}
        onChange={(e) => {
          if (c === 'cep') setErroCep(null);
          set({ [c]: extra.formatar ? extra.formatar(e.target.value) : e.target.value });
        }}
        onKeyDown={
          c === 'cep' && semMapa
            ? (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (!disabled && !pesquisando) void pesquisar();
              }
            : undefined
        }
        className={`${CLASSE_CAMPO_BKO} w-full`}
        data-testid={`${testId}.${c}`}
      />
    </CampoFormulario>
  );
  // fora do <label> (o nome do campo não repete o erro); com `semMapa` o erro aparece aqui, sob o CEP e o botão, na largura toda
  const msgCep = erros.cep ?? erroCep ?? '';
  const avisoCep = (
    <span role="alert" className={semMapa && msgCep ? 'flex items-start gap-1 text-[12px] font-normal text-danger' : 'sr-only'}>
      {semMapa && msgCep && <IconAlert size={13} className="mt-[2px] shrink-0" />}
      {msgCep}
    </span>
  );
  const campoCep = campo('cep', { maxLength: 9, inputMode: 'numeric', formatar: (v) => (v.replace(/\D/g, '').length === 8 ? formatarCep(v) : v) });
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {semMapa ? (
        <>
          <div className="grid grid-cols-[130px_max-content] items-end gap-3">
            {campoCep}
            <Button size="sm" className="h-[44px] whitespace-nowrap" disabled={disabled || pesquisando} onClick={() => void pesquisar()} data-testid={`${testId}.pesquisar-cep`}>
              {pesquisando ? 'Pesquisando…' : 'Pesquisar CEP'}
            </Button>
          </div>
          {avisoCep}
          <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-3">
            {campo('logradouro', { maxLength: 120 })}
            {campo('numero', { maxLength: 20 })}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-[130px_minmax(0,1fr)_90px] gap-3">
          {campoCep}
          {avisoCep}
          {campo('logradouro', { maxLength: 120 })}
          {campo('numero', { maxLength: 20 })}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px] gap-3">
        {campo('bairro', { maxLength: 80 })}
        {campo('cidade', { maxLength: 80 })}
        <CampoFormulario rotulo={ROTULOS_ENDERECO.uf} erro={erros.uf}>
          <select
            value={value.uf.toUpperCase()}
            disabled={disabled}
            aria-invalid={erros.uf ? true : undefined}
            onChange={(e) => set({ uf: e.target.value })}
            className={`${CLASSE_CAMPO_BKO} w-full`}
            data-testid={`${testId}.uf`}
          >
            <option value="" />
            {UFS_BRASIL.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </CampoFormulario>
      </div>
      {!semMapa && (
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink">Ponto no mapa</span>
        <div className="relative isolate z-0 h-[150px] overflow-hidden rounded-xl border border-line-2" data-testid={`${testId}.mapa`}>
          <PontoNoMapa valor={value.lat !== null && value.lng !== null ? { lat: value.lat, lng: value.lng } : null} onChange={(p) => set({ lat: p.lat, lng: p.lng })} centro={centro ?? CENTRO_PADRAO} disabled={disabled} />
        </div>
        {erros.ponto ? <span className="text-[12px] font-medium text-danger">{erros.ponto}</span> : <span className="text-[12px] text-ink-2">{value.lat !== null && value.lng !== null ? 'Arraste o marcador até a porta.' : 'Clique no mapa, na porta.'}</span>}
      </div>
      )}
    </div>
  );
}
