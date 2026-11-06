'use client';

import { QueryError, QueryPending } from '@/components/elements/QueryStatus';
import { Button } from '@/components/ui/button';
import * as Card from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import {
  formToPolicy,
  type PolicyForm,
  type PolicyFormErrors,
  policyToForm
} from '@/lib/policy-form';
import { getAgentPolicyQueryParams } from '@/lib/queries';
import { QUERY_KEYS } from '@/lib/query-client';
import { TEST_IDS } from '@/lib/test-ids';
import { URLS } from '@/lib/urls';
import { type Policy } from '@kosha/shared/registry';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';

const THRESHOLD_LABELS: Record<Policy['thresholdAction'], string> = {
  warn: 'Warn, then pay',
  block: 'Block the payment',
  allow: 'Pay without a warning'
};

const Field = ({
  id,
  label,
  hint,
  error,
  children
}: {
  id: keyof PolicyForm;
  label: string;
  hint: string;
  error?: string;
  children: ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    {children}
    <p className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
      {error ?? hint}
    </p>
  </div>
);

const savePolicy = async (agentId: string, policy: Policy): Promise<Policy> => {
  const response = await api.put<Policy>(URLS.console.agentPolicy(agentId), policy);
  if (!response.ok) throw new Error(response.data.message || `save failed (${response.status})`);
  return response.data;
};

const Editor = ({ agentId, initial }: { agentId: string; initial: PolicyForm }) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<PolicyFormErrors>({});
  const save = useMutation({
    mutationFn: (policy: Policy) => savePolicy(agentId, policy),
    onSuccess: async () => {
      toast.success('Policy saved. Core applies it from the next quote.');
      // The budget left on the spend view comes from this policy
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.agentPolicy(agentId) }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.agentSpend(agentId) })
      ]);
    },
    onError: (error) => toast.error(`Policy not saved: ${error.message}`)
  });

  const set = (field: keyof PolicyForm) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const policy = formToPolicy(form);
    if (!policy.ok) {
      setErrors(policy.data);
      return;
    }
    setErrors({});
    save.mutate(policy.data);
  };

  const amount = (
    id: 'perPaymentUsdc' | 'dailyUsdc' | 'fyBudgetUsdc',
    label: string,
    hint: string
  ) => (
    <Field id={id} label={label} hint={hint} error={errors[id]}>
      <Input
        id={id}
        inputMode="decimal"
        value={form[id]}
        onChange={(event) => set(id)(event.target.value)}
        aria-invalid={errors[id] ? true : undefined}
        data-testid={TEST_IDS.policyField(id)}
      />
    </Field>
  );

  return (
    <Card.Card>
      <Card.CardHeader>
        <Card.CardDescription>
          Caps count the all-in total: the price plus any TDS reserved. Kosha Pay checks them before
          signing, and Core checks them again at every quote.
        </Card.CardDescription>
      </Card.CardHeader>
      <Card.CardContent>
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <div className="grid gap-5 sm:grid-cols-3">
            {amount('perPaymentUsdc', 'Per payment (USDC)', 'Largest single payment')}
            {amount('dailyUsdc', 'Per day (USDC)', 'Resets at midnight IST')}
            {amount('fyBudgetUsdc', 'Per financial year (USDC)', 'April to March')}
          </div>
          <Field
            id="thresholdAction"
            label="When a payment starts withholding TDS"
            hint="Applies when the threshold or the unverified tolerance is crossed"
          >
            <NativeSelect
              id="thresholdAction"
              value={form.thresholdAction}
              onChange={(event) => set('thresholdAction')(event.target.value)}
              data-testid={TEST_IDS.policyField('thresholdAction')}
            >
              {Object.entries(THRESHOLD_LABELS).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="allowlist"
              label="Allowed hosts"
              hint="One per line; *.example.com allows subdomains. Empty allows every host."
              error={errors.allowlist}
            >
              <Textarea
                id="allowlist"
                rows={4}
                value={form.allowlist}
                onChange={(event) => set('allowlist')(event.target.value)}
                data-testid={TEST_IDS.policyField('allowlist')}
              />
            </Field>
            <Field
              id="acceptRulepacks"
              label="Accepted rule packs"
              hint="One per line, e.g. in-2026.*"
              error={errors.acceptRulepacks}
            >
              <Textarea
                id="acceptRulepacks"
                rows={4}
                value={form.acceptRulepacks}
                onChange={(event) => set('acceptRulepacks')(event.target.value)}
                aria-invalid={errors.acceptRulepacks ? true : undefined}
                data-testid={TEST_IDS.policyField('acceptRulepacks')}
              />
            </Field>
          </div>
          <div>
            <Button type="submit" disabled={save.isPending} data-testid={TEST_IDS.policySave}>
              {save.isPending ? 'Saving…' : 'Save policy'}
            </Button>
          </div>
        </form>
      </Card.CardContent>
    </Card.Card>
  );
};

// The agent's spending rules, saved through Core's PUT policy
export const PolicyEditor = ({ agentId }: { agentId: string }) => {
  const policy = useQuery(getAgentPolicyQueryParams(agentId));

  if (policy.isPending) return <QueryPending label="policy" />;
  if (policy.error) {
    return <QueryError error={policy.error} onRetry={() => void policy.refetch()} />;
  }
  return (
    <div className="flex flex-col gap-2">
      {policy.data === null ? (
        <p className="text-sm text-muted-foreground">
          No policy yet, so this agent has no caps. Save one to set them.
        </p>
      ) : null}
      <Editor key={agentId} agentId={agentId} initial={policyToForm(policy.data)} />
    </div>
  );
};
