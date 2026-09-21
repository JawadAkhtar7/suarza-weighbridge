/**
 * New weighment form — pass 1 (brief §3 Scenario A, §6 fields).
 *
 * Validated with the shared Zod schema so the form and the agent agree on the
 * rules by construction, rather than by two copies that drift.
 */

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  toast,
} from '@suarza/ui';
import {
  createWeighmentSchema,
  formatPKR,
  parseAmount,
  type Customer,
  type PaymentStatus,
  type VehicleType,
  type Weighment,
} from '@suarza/shared';
import { Loader2, Save } from 'lucide-react';
import { agentApi, AgentApiError, type AgentWarning } from '../lib/api.js';
import type { CapturedWeight } from './weight-capture.js';
import { CustomerPicker } from './customer-picker.js';
import { DEFAULT_OPERATOR_USERNAME, HOTKEYS } from '../lib/constants.js';
import { useHotkeys } from '../hooks/use-hotkeys.js';
import { useRefreshSyncStatus } from '../hooks/use-refresh-sync-status.js';
import { useVehicleTypes } from '../hooks/use-vehicle-types.js';

/** The weight comes from capture, not from a field, so it is omitted here. */
const formSchema = createWeighmentSchema
  .omit({ first_weight_kg: true, first_weight_src: true, operator_username: true })
  // Number inputs hand back strings; coercing in the schema keeps the parsing
  // in one place instead of at every read site.
  .extend({ amount_charged: z.coerce.number().finite().min(0, 'Amount cannot be negative') });

type FormValues = z.input<typeof formSchema>;

const DEFAULT_VEHICLE: VehicleType = 'truck';

function emptyValues(): FormValues {
  return {
    customer_name: '',
    customer_company: '',
    customer_phone: '',
    vehicle_type: DEFAULT_VEHICLE,
    vehicle_plate: '',
    container_number: '',
    product: '',
    amount_charged: 0,
  };
}

interface NewWeighmentFormProps {
  captured: CapturedWeight | null;
  onSaved: (weighment: Weighment, warnings: AgentWarning[]) => void;
  /**
   * `first` — the usual pass 1: capture the weight, save an open ticket, the
   * truck comes back later for the rest.
   *
   * `third` — the whole weighing in one visit. The customer already knows his
   * empty weight and says so, the operator types it, and the captured weight
   * is the LOADED one. There is no open ticket and no second visit, so the
   * amount and whether it was paid are settled here too.
   *
   * One component rather than two: the customer and vehicle fields are the
   * same in both, and a near-copy of this form would drift from it within a
   * release or two — which is exactly how the receipt and the PDF drifted.
   */
  flow?: 'first' | 'third';
}

export function NewWeighmentForm({ captured, onSaved, flow = 'first' }: NewWeighmentFormProps) {
  const isSingleVisit = flow === 'third';
  // Typed, not weighed: the figure the driver gives for his empty truck.
  const [knownFirstWeight, setKnownFirstWeight] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('PAID');
  const [amountEdited, setAmountEdited] = useState(false);
  const refreshSyncStatus = useRefreshSyncStatus();
  // The rate card belongs to the manager now: this is the copy this bridge
  // pulled, and nothing here can edit it.
  const vehicleTypes = useVehicleTypes();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues(),
  });

  // Settings arrive a moment after first paint; the amount follows once they
  // do, unless the operator has already typed over it.
  const configuredDefaultPrice = vehicleTypes.rateFor(DEFAULT_VEHICLE);
  useEffect(() => {
    if (amountEdited || form.formState.isDirty) return;
    form.setValue('amount_charged', configuredDefaultPrice);
  }, [configuredDefaultPrice, amountEdited, form]);

  const vehicleType = form.watch('vehicle_type') as VehicleType;
  const tablePrice = vehicleTypes.rateFor(vehicleType);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      if (!captured) throw new Error('No weight captured');

      const details = {
        ...createWeighmentSchema
          .omit({ first_weight_kg: true, first_weight_src: true, operator_username: true })
          .parse(values),
        vehicle_type_label: vehicleTypes.labelFor(values.vehicle_type),
        operator_username: DEFAULT_OPERATOR_USERNAME,
      };

      if (isSingleVisit) {
        // The captured reading is the LOADED truck here; the empty weight is
        // the one the driver gave us.
        return agentApi.createCompletedWeighment({
          ...details,
          first_weight_kg: parseAmount(knownFirstWeight),
          first_weight_src: 'MANUAL',
          second_weight_kg: captured.kg,
          second_weight_src: captured.source,
          payment_status: paymentStatus,
        });
      }

      return agentApi.createWeighment({
        ...details,
        first_weight_kg: captured.kg,
        first_weight_src: captured.source,
      });
    },
    onSuccess: (response) => {
      form.reset(emptyValues());
      setKnownFirstWeight('');
      setPaymentStatus('PAID');
      setAmountEdited(false);
      refreshSyncStatus();
      onSaved(response.weighment, response.warnings);
    },
    onError: (error) => {
      if (error instanceof AgentApiError && error.isUnreachable) {
        toast.error('Weighbridge service is not running', {
          description: 'The record was not saved. Start the service and try again.',
        });
        return;
      }
      toast.error('Could not save the weighment', {
        description: error instanceof Error ? error.message : 'Unexpected error.',
      });
    },
  });

  // Typed before anything is weighed, so it is checked before the capture is.
  const knownKg = parseAmount(knownFirstWeight);
  const knownFirstWeightValid = !isSingleVisit || knownKg > 0;

  // No name, no customer account — the same rule the return screen enforces.
  const canGoOnAccount = String(form.watch('customer_name') ?? '').trim().length > 0;
  useEffect(() => {
    if (!canGoOnAccount && paymentStatus === 'ON_ACCOUNT') setPaymentStatus('PAID');
  }, [canGoOnAccount, paymentStatus]);

  const submit = form.handleSubmit(
    (values) => {
      if (isSingleVisit && !knownFirstWeightValid) {
        toast.error('Enter the empty weight the driver gave you');
        return;
      }
      if (!captured) {
        toast.error(
          isSingleVisit ? 'Capture the loaded weight before saving' : 'Capture the first weight before saving',
        );
        return;
      }
      mutation.mutate(values);
    },
    () => {
      // RHF already marks the fields; this is the nudge for an operator whose
      // eyes are on the truck, not the form.
      toast.error('Some details are missing', { description: 'Check the highlighted fields.' });
    },
  );

  const resetForm = () => {
    form.reset(emptyValues());
    setAmountEdited(false);
  };

  /**
   * Fill in what the directory knows about this customer.
   *
   * Only fields the operator has not already typed into are touched — someone
   * who typed a plate before picking the customer meant that plate. The last
   * vehicle and product are offered because the same customer usually sends
   * the same truck with the same load, but they are suggestions, not facts.
   */
  const applyCustomer = (customer: Customer) => {
    // Snapshot FIRST. Deciding what to fill while already filling would let an
    // earlier write make a later field look "already typed in".
    const wasEmpty = {
      phone: String(form.getValues('customer_phone') ?? '').trim() === '',
      plate: String(form.getValues('vehicle_plate') ?? '').trim() === '',
      product: String(form.getValues('product') ?? '').trim() === '',
    };

    // Identity always comes from the chosen customer — that is what was picked.
    form.setValue('customer_name', customer.name, { shouldValidate: true });
    form.setValue('customer_company', customer.company, { shouldValidate: true });

    if (wasEmpty.phone && customer.phone) {
      form.setValue('customer_phone', customer.phone, { shouldValidate: true });
    }
    if (wasEmpty.product && customer.last_product) {
      form.setValue('product', customer.last_product, { shouldValidate: true });
    }

    // The vehicle and its rate move together, and only when the operator has
    // not already named a truck — a typed plate must never be contradicted by
    // a vehicle type from last month.
    if (wasEmpty.plate && customer.last_vehicle_plate) {
      form.setValue('vehicle_plate', customer.last_vehicle_plate, { shouldValidate: true });

      if (customer.last_vehicle_type) {
        form.setValue('vehicle_type', customer.last_vehicle_type, { shouldValidate: true });
        if (!amountEdited) {
          form.setValue('amount_charged', vehicleTypes.rateFor(customer.last_vehicle_type));
        }
      }
    }

    toast.success(`Loaded ${customer.name}`, {
      description: 'Check the details and change anything that is different today.',
    });
  };

  useHotkeys({ [HOTKEYS.save]: () => void submit(), [HOTKEYS.reset]: resetForm });

  const errors = form.formState.errors;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer Details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5" noValidate>
          {/*
            * First on the screen, because it is first in the conversation: the
            * driver says the number while he is still at the window, before
            * anyone has typed a name or driven onto the bridge.
            *
            * Big, like the capture readout it stands in for — this figure goes
            * onto a slip and into a net weight, and a mistyped digit here is a
            * wrong invoice.
            */}
          {isSingleVisit && (
            <div className="space-y-2 rounded-lg border-2 border-brand/40 bg-brand/5 p-4">
              <Label htmlFor="known-first-weight" className="text-sm font-semibold">
                Empty weight, as given by the driver
              </Label>
              <div className="relative">
                <NumberInput
                  id="known-first-weight"
                  min={0}
                  step="1"
                  inputMode="numeric"
                  placeholder="0"
                  value={knownFirstWeight}
                  onChange={(event) => setKnownFirstWeight(event.target.value)}
                  className="tabular h-16 pr-14 text-3xl font-bold"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground">
                  kg
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Recorded as a manual entry and marked as such on the slip.
              </p>
            </div>
          )}

          <CustomerPicker onPick={applyCustomer} />

          <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
            <Field
              htmlFor="customer_name"
              label="Customer name"
              error={errors.customer_name?.message}
              optional
              hint="Needed only if this weighing goes on the customer's account."
            >
              <Input
                id="customer_name"
                autoFocus
                {...form.register('customer_name')}
                placeholder="Ali Raza"
              />
            </Field>

            <Field
              htmlFor="customer_company"
              label="Company"
              error={errors.customer_company?.message}
              optional
            >
              <Input
                id="customer_company"
                {...form.register('customer_company')}
                placeholder="Raza Traders"
              />
            </Field>

            <Field
              htmlFor="vehicle_type"
              label="Vehicle type"
              error={errors.vehicle_type?.message}
              required
            >
              <Select
                value={vehicleType}
                onValueChange={(value) => {
                  form.setValue('vehicle_type', value as VehicleType, { shouldValidate: true });
                  // Changing the vehicle type is a deliberate act, so the rate
                  // follows it. The field stays editable either way (brief §7.8).
                  form.setValue('amount_charged', vehicleTypes.rateFor(value));
                  setAmountEdited(false);
                }}
              >
                <SelectTrigger id="vehicle_type">
                  <SelectValue placeholder="Select a vehicle type" />
                </SelectTrigger>
                <SelectContent>
                  {vehicleTypes.types.map((type) => (
                    <SelectItem key={type.key} value={type.key}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              htmlFor="vehicle_plate"
              label="Vehicle plate"
              error={errors.vehicle_plate?.message}
              required
            >
              <Input
                id="vehicle_plate"
                {...form.register('vehicle_plate')}
                placeholder="LES-1234"
                className="uppercase"
              />
            </Field>

            <Field htmlFor="product" label="Product" error={errors.product?.message} optional>
              <Input id="product" {...form.register('product')} placeholder="Cement" />
            </Field>

            <Field
              htmlFor="container_number"
              label="Container number"
              error={errors.container_number?.message}
              optional
            >
              <Input
                id="container_number"
                {...form.register('container_number')}
                placeholder="Optional"
              />
            </Field>

            <Field
              htmlFor="customer_phone"
              label="Phone"
              error={errors.customer_phone?.message}
              optional
            >
              <Input
                id="customer_phone"
                {...form.register('customer_phone')}
                placeholder="Optional"
                inputMode="tel"
              />
            </Field>

            <Field
              htmlFor="amount_charged"
              label="Amount charged"
              error={errors.amount_charged?.message}
              hint={
                amountEdited
                  ? `Edited — rate for this vehicle is ${formatPKR(tablePrice)}`
                  : `Rate for ${vehicleTypes.labelFor(vehicleType)}`
              }
            >
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  Rs
                </span>
                <NumberInput
                  id="amount_charged"
                  {...form.register('amount_charged', {
                    onChange: () => setAmountEdited(true),
                  })}
                  min={0}
                  step="1"
                  className={cn('pl-9', amountEdited && 'border-primary')}
                />
              </div>
            </Field>
          </div>

          {/*
            * Settled here, because there is no second visit to settle it at.
            * The same two choices the return screen offers, and the same rule:
            * an account needs a name to charge it to.
            */}
          {isSingleVisit && (
            <div className="space-y-2 border-t pt-5">
              <Label>Payment</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setPaymentStatus('PAID')}
                  className={cn(
                    'rounded-md border-2 px-3 py-3 text-left transition-colors',
                    paymentStatus === 'PAID'
                      ? 'border-primary bg-primary/5'
                      : 'border-muted hover:border-muted-foreground/30',
                  )}
                >
                  <span className="block text-sm font-semibold">Paid now</span>
                  <span className="block text-xs text-muted-foreground">Customer has paid</span>
                </button>
                <button
                  type="button"
                  disabled={!canGoOnAccount}
                  onClick={() => setPaymentStatus('ON_ACCOUNT')}
                  className={cn(
                    'rounded-md border-2 px-3 py-3 text-left transition-colors',
                    paymentStatus === 'ON_ACCOUNT'
                      ? 'border-warning bg-warning/5'
                      : 'border-muted hover:border-muted-foreground/30',
                    !canGoOnAccount && 'cursor-not-allowed opacity-50 hover:border-muted',
                  )}
                >
                  <span className="block text-sm font-semibold">Add to account</span>
                  <span className="block text-xs text-muted-foreground">
                    Customer will pay later
                  </span>
                </button>
              </div>
              {!canGoOnAccount && (
                <p className="text-xs text-muted-foreground">
                  Enter a customer name to charge this to an account.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3 border-t pt-5">
            <Button
              type="submit"
              variant="brand"
              size="xl"
              disabled={!captured || !knownFirstWeightValid || mutation.isPending}
            >
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {isSingleVisit ? 'Save & print slip' : 'Save first weight'}
              <kbd className="ml-1 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-xs font-medium">
                {HOTKEYS.save}
              </kbd>
            </Button>

            <Button type="button" variant="ghost" size="xl" onClick={resetForm}>
              Clear form
              <kbd className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                {HOTKEYS.reset}
              </kbd>
            </Button>
          </div>

          {!captured && (
            <p className="text-sm text-muted-foreground">
              {isSingleVisit
                ? 'Capture the loaded weight before saving.'
                : 'Capture the first weight before saving.'}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

interface FieldProps {
  /** Ties the label to its control — without it a screen reader cannot say
   *  which box it is reading, and clicking the label does nothing. */
  htmlFor: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}

function Field({ htmlFor, label, error, hint, required, optional, children }: FieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="flex items-center gap-1.5">
        {label}
        {required && <span className="text-destructive">*</span>}
        {optional && <span className="text-xs font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-sm font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
