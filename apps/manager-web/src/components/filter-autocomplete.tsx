/**
 * A filter box that suggests names already in the records (manager feedback).
 *
 * Suggestions come from the weighments themselves, so a customer can be
 * suggested the moment they have been weighed once, and the list can never
 * offer a name that would return nothing.
 *
 * It stays a free-text filter: typing a partial name still works, because
 * partial matching is what the filter does anyway.
 */

import { useQuery } from '@tanstack/react-query';
import { Autocomplete, Label } from '@suarza/ui';
import { api } from '../lib/api.js';
import { useDebounced } from '../hooks/use-debounced.js';

interface FilterAutocompleteProps {
  id: string;
  label: string;
  field: 'customer_name' | 'customer_company';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function FilterAutocomplete({
  id,
  label,
  field,
  value,
  onChange,
  placeholder,
}: FilterAutocompleteProps) {
  // Debounced so a fast typist doesn't fire an aggregation per keystroke.
  const debounced = useDebounced(value);

  const query = useQuery({
    queryKey: ['suggestions', field, debounced],
    queryFn: () => api.suggestions(field, debounced),
    staleTime: 60_000,
    retry: false,
  });

  const options = (query.data?.values ?? []).map((name) => ({ value: name, label: name }));

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Autocomplete
        id={id}
        value={value}
        onValueChange={onChange}
        options={options}
        isLoading={query.isFetching}
        listLabel={`${label} suggestions`}
        emptyMessage="No matching records"
        placeholder={placeholder}
      />
    </div>
  );
}
