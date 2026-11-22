/**
 * Marca na faixa Azul noite (marca v1, T-0172; docs/marca/manual.md §4): o logo horizontal negativo e, ao lado, o nome da
 * área no texto claro da faixa (`faixa-texto`, 8,07:1). Usada no topo do portal de implantação e do login do BKO, sobre o
 * Pérola. O nome "Macuxi Força de Vendas" é o `alt` do logo.
 * `naBarra`: dentro do cabeçalho do portal, que já é a faixa inteira (MC-0022/MC-0023, docs/design/telas/portal-config-enxuto.md
 * §0): sem fundo nem arredondado próprios. Logo a 104 px com 14 px de folga nos dois casos (área de proteção, MC-0022): na faixa
 * solta (Entrar, Escolha a empresa e login do BKO), `gap-3.5` e `p-3.5`.
 */
import { cx } from '@macuxi/ui/web';

import { PROPORCAO_LOGO_HORIZONTAL, SRC_LOGO_NEGATIVO_HORIZONTAL } from '@/lib/logo-marca';

export function MarcaNaFaixa({ area, naBarra }: { area: string; naBarra?: boolean }) {
  const largura = 104;
  return (
    <div className={cx('flex items-center gap-3.5', naBarra ? 'py-3.5' : 'rounded-xl bg-faixa p-3.5')}>
      {/* data URI do SVG da marca: sem a otimização do Next (não há o que otimizar num vetor) */}
      <img
        src={SRC_LOGO_NEGATIVO_HORIZONTAL}
        alt="Macuxi Força de Vendas"
        width={largura}
        height={Math.round(largura / PROPORCAO_LOGO_HORIZONTAL)}
        className="block h-auto w-[104px]"
      />
      <span aria-hidden="true" className="h-6 w-px bg-faixa-texto/40" />
      <span className="text-[15px] font-bold text-faixa-texto">{area}</span>
    </div>
  );
}
