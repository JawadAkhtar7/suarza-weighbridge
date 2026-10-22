/**
 * Who weighed this slip, by the username on the record.
 *
 * The record keeps a username because that is what the operator signed in
 * with; the slip shows a name and a shift, because that is what a person
 * reading it afterwards needs. The directory comes from the agent and is
 * cached for the session — it changes when a manager changes it, which is
 * not during the few seconds a slip is on screen.
 *
 * Null for the username the app used before anybody signed in, and on a
 * bridge that signs nobody in: the slip then simply carries no operator
 * line, rather than a line naming nobody.
 */

import { useQuery } from '@tanstack/react-query';
import { OPERATOR_SLOT_LABELS, type OperatorSlot } from '@suarza/shared';
import { agentApi } from '../lib/api.js';

export interface SlipOperator {
  name: string;
  shift: string | null;
}

export function useSlipOperator(username: string | undefined): SlipOperator | null {
  const directory = useQuery({
    queryKey: ['operator-directory'],
    queryFn: agentApi.operatorDirectory,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!username) return null;

  const match = directory.data?.operators.find(
    (operator) => operator.username.toLowerCase() === username.trim().toLowerCase(),
  );
  if (!match) return null;

  return {
    name: match.name,
    /* The administrator works no shift, and saying "Administrator shift"
       would be inventing one. */
    shift: match.slot === 'ADMIN' ? null : OPERATOR_SLOT_LABELS[match.slot as OperatorSlot],
  };
}
