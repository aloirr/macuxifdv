/**
 * Marca na faixa Azul noite (marca v1, T-0172; docs/marca/manual.md §4): o logo horizontal negativo e, ao lado, o nome da
 * área no texto claro da faixa (`faixa-texto`, 8,07:1). Usada no topo do portal de implantação e do login do BKO, sobre o
 * Pérola. O nome "Macuxi Força de Vendas" é o `alt` do logo.
 * Portal (`noPortal`): MC-0022, logo a 104 px (22 px de altura) com 14 px de folga (área de proteção = altura do "M"); MC-0023,
 * `semFundo` = dentro do cabeçalho, que já é a faixa: sem o fundo e sem o arredondado próprios.
 */
import { PROPORCAO_LOGO_HORIZONTAL, SRC_LOGO_NEGATIVO_HORIZONTAL } from '@/lib/logo-marca';

export function MarcaNaFaixa({ area, noPortal = false, semFundo = false }: { area: string; noPortal?: boolean; semFundo?: boolean }) {
  const largura = noPortal ? 104 : 130;
  return (
    <div className={`flex items-center ${noPortal ? 'gap-3.5 p-3.5' : 'gap-3 px-3.5 py-2.5'} ${semFundo ? '' : 'rounded-xl bg-faixa'}`}>
      {/* data URI do SVG da marca: sem a otimização do Next (não há o que otimizar num vetor) */}
      <img
        src={SRC_LOGO_NEGATIVO_HORIZONTAL}
        alt="Macuxi Força de Vendas"
        width={largura}
        height={Math.round(largura / PROPORCAO_LOGO_HORIZONTAL)}
        className={`block h-auto ${noPortal ? 'w-[104px]' : 'w-[130px]'}`}
      />
      <span aria-hidden="true" className="h-6 w-px bg-faixa-texto/40" />
      <span className="font-display text-[14px] font-bold text-faixa-texto">{area}</span>
    </div>
  );
}
