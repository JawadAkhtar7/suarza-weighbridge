/**
 * A text input that suggests matches as you type.
 *
 * Built here rather than pulled in, because all three places that need it want
 * slightly different things from the same shape: the dashboard filters want a
 * free-text box that *offers* suggestions (any text is a valid filter), and the
 * weighing form wants to pick an existing customer and fill a whole row of
 * fields. Both are "type, see matches, optionally choose one".
 *
 * The input is never locked to the list. An operator with a truck on the bridge
 * must be able to type a new customer's name straight in, not hunt for an
 * "add new" affordance.
 */

import * as React from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Input } from './input.js';

export interface AutocompleteOption<T = unknown> {
  /** Stable identity for the option. */
  value: string;
  /** Shown as the main line, and written into the input when chosen. */
  label: string;
  /** Optional second line — a company, a count, a date. */
  description?: string;
  /** Carried through to `onSelect` so callers get their own object back. */
  data?: T;
}

export interface AutocompleteProps<T = unknown> extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onSelect' | 'value' | 'onChange'
> {
  value: string;
  onValueChange: (value: string) => void;
  options: AutocompleteOption<T>[];
  onSelect?: (option: AutocompleteOption<T>) => void;
  isLoading?: boolean;
  /** Shown when the list is empty and something has been typed. */
  emptyMessage?: string;
  /** Label for the dropdown button, for screen readers. */
  listLabel?: string;
}

export function Autocomplete<T = unknown>({
  value,
  onValueChange,
  options,
  onSelect,
  isLoading = false,
  emptyMessage = 'No matches',
  listLabel = 'Suggestions',
  className,
  onKeyDown,
  onFocus,
  onBlur,
  id,
  ...inputProps
}: AutocompleteProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const listId = `${id ?? React.useId()}-listbox`;

  // Close when focus leaves the whole control — not just the input, or clicking
  // an option would close the list before the click registers.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  /**
   * Reset the highlight only when the option SET changes — not on every new
   * array.
   *
   * Callers rebuild this array on each render, and the operator screen
   * re-renders three times a second because the live weight is polling. Keying
   * the effect on the array itself therefore cleared the highlight ~3x/second
   * and the hover appeared to flicker off while the mouse was still on it.
   */
  const optionKey = options.map((option) => option.value).join('\u0000');
  React.useEffect(() => {
    setActiveIndex(-1);
  }, [optionKey]);

  /**
   * Guards against the same choice arriving twice.
   *
   * Options respond to BOTH pointerdown and click: pointerdown so a mouse
   * selection beats the input's blur closing the list, and click because that
   * is what assistive technology dispatches when a user activates the option
   * without ever touching a pointer. A pointer press fires both, so the second
   * one has to be ignored.
   */
  const justChosen = React.useRef<string | null>(null);

  const choose = (option: AutocompleteOption<T>) => {
    if (justChosen.current === option.value) return;
    justChosen.current = option.value;
    window.setTimeout(() => {
      justChosen.current = null;
    }, 0);

    onValueChange(option.label);
    onSelect?.(option);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => {
        if (options.length === 0) return -1;
        const next = current + delta;
        // Wraps, so holding the key never dead-ends.
        return ((next % options.length) + options.length) % options.length;
      });
      return;
    }

    if (event.key === 'Enter' && open && activeIndex >= 0) {
      const option = options[activeIndex];
      if (option) {
        // Only swallow Enter when a suggestion is actually highlighted, so
        // Enter still submits the form the rest of the time.
        event.preventDefault();
        choose(option);
      }
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const showList = open && (isLoading || options.length > 0 || value.trim() !== '');

  return (
    <div ref={containerRef} className="relative">
      <Input
        {...inputProps}
        id={id}
        value={value}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        className={cn('pr-9', className)}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
        }}
        onFocus={(event) => {
          onFocus?.(event);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
      />

      <button
        type="button"
        tabIndex={-1}
        aria-label={listLabel}
        className="absolute right-0 top-0 flex h-full w-9 items-center justify-center text-muted-foreground"
        onClick={() => setOpen((current) => !current)}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {isLoading ? 'Searching…' : emptyMessage}
            </li>
          ) : (
            options.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onClick={() => choose(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm',
                    index === activeIndex && 'bg-accent text-accent-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {option.label === value && <Check className="h-4 w-4 shrink-0 opacity-60" />}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
