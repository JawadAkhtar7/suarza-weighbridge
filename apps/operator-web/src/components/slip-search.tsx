/**
 * The slip entry box (brief §9: "A prominent slip-entry box").
 *
 * This is the operator's entire route into the second pass, typed off a paper
 * slip a driver just handed over — often dusty, often creased. So the input is
 * large, always auto-focused, submits on Enter, and accepts what is actually
 * printed as well as the shorthand people type: `SI-000123`, `000123`, `123`.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@suarza/ui';
import { normalizeSlipNumber } from '@suarza/shared';
import { Loader2, Search } from 'lucide-react';
import { useHotkeys } from '../hooks/use-hotkeys.js';
import { HOTKEYS } from '../lib/constants.js';

interface SlipSearchProps {
  onSearch: (slip: string) => void;
  isSearching: boolean;
  /** Shown inline under the field; a wrong slip is a typo, not an incident. */
  error: string | null;
  onErrorCleared: () => void;
}

export function SlipSearch({ onSearch, isSearching, error, onErrorCleared }: SlipSearchProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useHotkeys({
    [HOTKEYS.slip]: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  });

  const submit = () => {
    const slip = normalizeSlipNumber(value);
    if (!slip) return;
    onSearch(slip);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enter slip number</CardTitle>
        {/* Says where to find it, because a new operator's first question here
            is "which number?" and the answer is in the driver's hand. */}
        <CardDescription>It is printed at the top of the driver&rsquo;s slip.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <Input
            ref={inputRef}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) onErrorCleared();
            }}
            placeholder="SI-000123"
            aria-label="Slip number"
            autoComplete="off"
            spellCheck={false}
            className="tabular h-16 text-3xl font-bold uppercase tracking-wide sm:flex-1"
          />
          <Button
            type="submit"
            variant="brand"
            size="xl"
            disabled={isSearching || value.trim() === ''}
          >
            {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
            Fetch
          </Button>
        </form>

        {error ? (
          <p className="text-sm font-medium text-destructive">{error}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Type the number from the driver&apos;s slip.{' '}
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{HOTKEYS.slip}</kbd>{' '}
            jumps back here at any time.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
