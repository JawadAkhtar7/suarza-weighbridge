/**
 * The slip entry box (brief §9: "A prominent slip-entry box").
 *
 * This is the operator's entire route into the second pass, typed off a paper
 * slip a driver just handed over — often dusty, often creased. So the input is
 * large, always auto-focused, and submits on Enter. The year is shown as part
 * of the box rather than typed: a slip number is the year and a sequence
 * (20265), the year is the same for a whole year, and four digits that never
 * change are four chances to mistype. Typing the whole number still works.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  Input,
} from '@suarza/ui';
import { currentSlipYear, normalizeSlipNumber } from '@suarza/shared';
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
  const year = currentSlipYear();

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
      {/* No heading and no hint: the field carries its own placeholder and
          the year is printed beside it, which says more than a paragraph. */}
      <CardContent className="space-y-4 pt-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          {/*
            The year is printed, not typed.
            
            A slip number is the year and a sequence — 20265. The operator reads
            it off a creased slip and types it back, and the first four digits
            are the same every time for a whole year. Showing them as part of
            the box means four fewer keystrokes to get wrong, and the field
            still accepts the whole number if somebody types it all.
          */}
          <div className="flex h-16 items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring sm:flex-1">
            <span
              aria-hidden
              className="tabular flex select-none items-center bg-muted px-4 text-3xl font-bold tracking-wide text-muted-foreground"
            >
              {year}
            </span>
            <Input
              ref={inputRef}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (error) onErrorCleared();
              }}
              inputMode="numeric"
              /* Not an example number: a lone "5" sitting in the box reads as a
                 value already typed rather than as a prompt. */
              placeholder="Slip number"
              aria-label={`Slip number, after ${year}`}
              autoComplete="off"
              spellCheck={false}
              className="tabular h-full flex-1 border-0 bg-transparent text-3xl font-bold tracking-wide shadow-none focus-visible:ring-0"
            />
          </div>
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

        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
