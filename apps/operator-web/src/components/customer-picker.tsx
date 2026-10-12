/**
 * Pick a customer who has been weighed here before (operator feedback).
 *
 * The directory is a by-product of weighing, so there is no "add a customer"
 * step and nothing to keep tidy. Choosing one fills in what is known — name,
 * company, phone, and the vehicle and product they last brought — and every
 * field stays editable, because the same customer turns up with a different
 * truck all the time.
 *
 * Searches by name, company or vehicle plate. A plate search finds the
 * customer by any truck they have been weighed with, and picking that result
 * fills in that truck rather than the one they brought last.
 *
 * The box is never locked to the list: a customer who has never been here is
 * the normal case, and the operator just types.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
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
        /* Customer AND truck: a plate search lists one customer once per
           matching truck, and each must be its own option. */
        value: `${customer.id}|${customer.last_vehicle_plate ?? ''}`,
        label: customerLabel(customer),
        /* The truck, which is what tells two results for the same customer
           apart, and what a plate search was looking for. */
        description: customer.last_vehicle_plate ?? 'No plate recorded',
        data: customer,
      })),
    [search.data],
  );

  return (
    /* `relative` so the icon can sit over the box. The Autocomplete's own
       root is the only thing contributing height here - its dropdown is
       absolutely positioned - so inset-y-0 tracks the input exactly. */
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-3 z-10 my-auto h-4 w-4 text-muted-foreground"
      />
      <Autocomplete
        id="customer-picker"
        value={query}
        onValueChange={setQuery}
        options={options}
        isLoading={search.isFetching}
        listLabel="Existing customers"
        emptyMessage="No customer or vehicle like that yet — just fill the form in below."
        placeholder="Search customer or vehicle plate"
        aria-label="Search customer or vehicle plate"
        className="pl-9"
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
