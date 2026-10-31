'use client';

import { useState } from 'react';
import { usePode } from '@macuxi/platform-sdk/react';
import { DEFAULT_TZ, ErrorBlock, IconLock, LoadingBlock } from '@macuxi/ui/web';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { ROLE_LABEL } from '../../../contracts';
import { useCurrentPlan, useMe, usePlans, useSellers } from '../../lib/queries';
import { PlanEditor } from './plan-editor';

/**
 * Parâmetros do plano de RV (RF-CORE metas/RV). Parte da `params-page` da Fase M: o plano fica no Core;
 * as alçadas de desconto viraram a página "Alçadas" do módulo Vendedor (cada uma com o seu menu).
 */
export function PlanoRvPage() {
  const me = useMe();
  const current = me.data?.today.slice(0, 7) ?? '';
  const [viewPeriod, setViewPeriod] = useState<string | null>(null);
  const period = viewPeriod ?? current;
  const plan = useCurrentPlan(period);
  const plans = usePlans();
  const sellers = useSellers();
  const role = me.data?.user.role;
  const canEdit = usePode('plano_rv.editar');
  const tz = me.data?.tenant.timezone ?? DEFAULT_TZ;

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5">
      {!canEdit && role && (
        <div className="flex items-center gap-2 rounded-[10px] bg-neutral-soft px-3 py-2.5 text-[13px] text-ink-3" role="status">
          <IconLock size={15} />
          Seu perfil ({ROLE_LABEL[role]}) só consulta. Só o perfil analista edita o plano de RV; o servidor também bloqueia.
        </div>
      )}
      {plan.isError && <ErrorBlock message={errorMessage(plan.error)} onRetry={() => void plan.refetch()} />}
      {plan.isPending && <LoadingBlock label="Carregando o plano de RV…" />}
      {plan.data && (
        <PlanEditor
          plan={plan.data}
          plans={plans.data ?? []}
          currentYm={current}
          sellersCount={sellers.data?.length ?? 0}
          canEdit={canEdit}
          tz={tz}
          onSaved={(saved) => setViewPeriod(saved.valid_from)}
        />
      )}
    </div>
  );
}
