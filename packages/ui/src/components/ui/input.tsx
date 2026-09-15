import * as React from 'react';
import { cn } from '../../lib/utils.js';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

/** Numeric input tuned for the weighbridge: right-aligned tabular digits and a
 *  numeric soft keyboard on the tablet the operator sometimes uses. */
const NumberInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <Input
      ref={ref}
      type="number"
      inputMode="decimal"
      className={cn('tabular text-right', className)}
      {...props}
    />
  ),
);
NumberInput.displayName = 'NumberInput';

export { Input, NumberInput };
