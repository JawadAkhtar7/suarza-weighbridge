/**
 * Pick a customer who has been weighed here before (operator feedback).
 *
 * The directory is a by-product of weighing, so there is no "add a customer"
 * step and nothing to keep tidy. Choosing one fills in what is known — name,
 * company, phone, and the vehicle and product they last brought — and every
 * field stays editable, because the same customer turns up with a different
 * truck all the time.
 *
 * The box is never locked to the list: a customer who has never been here is
 * the normal case, and the operator just types.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Autocomplete, type AutocompleteOption } from '@suarza/ui';
import { customerLabel, type Customer } from '@suarza/shared';
import { agentApi } from '../lib/api.js';
import { useDebounced } from '../hooks/use-debounced.js';

interface CustomerPickerProps {
  onPick: (customer: Customer) => void;
}

export function CustomerPicker({ onPick }: CustomerPickerProps) {
  const [query, setQuery] = useState('');
  // Debounced so a fast typist doesn't fire a query per keystroke at the
  // database the weighbridge is also writing to.
  const debounced = useDebounced(query, 200);

  const search = useQuery({
    queryKey: ['customers', debounced],
    queryFn: () => agentApi.searchCustomers(debounced),
    retry: false,
    // The list changes only when someone is weighed.
    staleTime: 30_000,
  });

  // Memoised so the list keeps its identity across the live-weight re-renders
  // happening three times a second behind this form.
  const options: AutocompleteOption<Customer>[] = useMemo(
    () =>
      (search.data?.customers ?? []).map((customer) => ({
        value: customer.id,
        label: customerLabel(customer),
        description:
          customer.weighment_count === 1
            ? 'Weighed once here'
            : `Weighed ${customer.weighment_count} times here`,
        data: customer,
      })),
    [search.data],
  );

  return (
    <div>
      <Autocomplete
        id="customer-picker"
        value={query}
        onValueChange={setQuery}
        options={options}
        isLoading={search.isFetching}
        listLabel="Existing customers"
        emptyMessage="No customer by that name yet — just fill the form in below."
        placeholder="Search an existing customer or company…"
        aria-label="Search an existing customer"
        onSelect={(option) => {
          if (!option.data) return;
          onPick(option.data);
          // The chosen customer STAYS in the box. Clearing it left the
          // placeholder showing, so the operator could not tell whether their
          // pick had registered.
          setQuery(customerLabel(option.data));
        }}
      />
    </div>
  );
}
