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
import { SlipSearch } from './slip-search.js';
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
   * `fourth` — a truck that has been weighed here before. The operator types
   * an earlier slip number, both of its weights and all of its customer
   * details are fetched, either weight can be corrected, and a fresh slip is
   * issued. Nothing is weighed: the indicator is not consulted at all, which
   * is why each weight carries its own "mark as manual" box.
   *
   * One component rather than four: the customer and vehicle fields are the
   * same in all of them, and a near-copy of this form would drift from it
   * within a release or two — which is exactly how the receipt and the PDF
   * drifted.
   */
  flow?: 'first' | 'third' | 'fourth';
}

export function NewWeighmentForm({ captured, onSaved, flow = 'first' }: NewWeighmentFormProps) {
  const isSingleVisit = flow === 'third';
  /** Both weights come off an earlier slip rather than off the indicator. */
  const isRepeat = flow === 'fourth';
  // Typed, not weighed: the figure the driver gives for his empty truck.
  const [knownFirstWeight, setKnownFirstWeight] = useState('');
  // --- fourth weight: everything fetched from an earlier slip -------------
  const [repeatSecondWeight, setRepeatSecondWeight] = useState('');
  /*
   * Whether each weight prints "(MANUAL)" on the slip.
   *
   * The operator decides, rather than the software inferring it. Neither
   * figure was read off the indicator in this flow, so inferring would mark
   * both every time — but a weight copied unchanged from a slip that WAS
   * weighed is not a hand-typed number, and marking it as one would misread
   * the record. Default off; tick what was actually typed.
   */
  const [firstIsManual, setFirstIsManual] = useState(false);
  const [secondIsManual, setSecondIsManual] = useState(false);
  const [sourceSlip, setSourceSlip] = useState<string | null>(null);
  const [slipError, setSlipError] = useState<string | null>(null);
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

  /*
   * Fetch an earlier slip and fill the whole form from it.
   *
   * Deliberately fills the WEIGHTS as well as the details: the point of this
   * flow is that the truck's empty and loaded figures are already known, so
   * re-typing them is both slower and a chance to mistype. They stay editable.
   */
  const lookup = useMutation({
    mutationFn: (slip: string) => agentApi.getWeighment(slip),
    onSuccess: ({ weighment }) => {
      setSourceSlip(weighment.slip_number);
      setSlipError(null);

      form.reset({
        customer_name: weighment.customer_name,
        customer_company: weighment.customer_company,
        customer_phone: weighment.customer_phone ?? '',
        vehicle_type: weighment.vehicle_type as VehicleType,
        vehicle_plate: weighment.vehicle_plate,
        container_number: weighment.container_number ?? '',
        product: weighment.product,
        amount_charged: weighment.amount_charged,
      });
      // The rate is the one that slip was charged, not today's card, so the
      // amount must not be overwritten when settings next arrive.
      setAmountEdited(true);

      setKnownFirstWeight(String(weighment.first_weight_kg));
      setRepeatSecondWeight(
        weighment.second_weight_kg === null ? '' : String(weighment.second_weight_kg),
      );
      // Carry the earlier slip's own answer forward as the starting point.
      setFirstIsManual(weighment.first_weight_src === 'MANUAL');
      setSecondIsManual(weighment.second_weight_src === 'MANUAL');

      if (weighment.status === 'VOID') {
        // Allowed, but said out loud: the figures on a voided slip were
        // disowned for a reason, and carrying them forward unnoticed would
        // put them back into the record under a fresh number.
        toast.warning(`Slip ${weighment.slip_number} was voided`, {
          description: 'Its details have been filled in. Check both weights before saving.',
        });
      } else if (weighment.second_weight_kg === null) {
        toast.warning(`Slip ${weighment.slip_number} has no second weight yet`, {
          description: 'Its first weight has been filled in. Type the second one.',
        });
      } else {
        toast.success(`Filled from slip ${weighment.slip_number}`);
      }
    },
    onError: (error) => {
      setSourceSlip(null);
      setSlipError(
        error instanceof AgentApiError && error.status === 404
          ? 'No weighment found with that slip number.'
          : error instanceof Error
            ? error.message
            : 'Could not fetch that slip.',
      );
    },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {

      const details = {
        ...createWeighmentSchema
          .omit({ first_weight_kg: true, first_weight_src: true, operator_username: true })
          .parse(values),
        vehicle_type_label: vehicleTypes.labelFor(values.vehicle_type),
        operator_username: DEFAULT_OPERATOR_USERNAME,
      };

      if (isRepeat) {
        /*
         * Both figures are typed here, so both sources are the operator's
         * answer rather than anything the software can observe. A box left
         * unticked says the number came off a scale at some point — on the
         * earlier slip — and the receipt stays silent about it.
         */
        return agentApi.createCompletedWeighment({
          ...details,
          first_weight_kg: parseAmount(knownFirstWeight),
          first_weight_src: firstIsManual ? 'MANUAL' : 'SERIAL',
          second_weight_kg: parseAmount(repeatSecondWeight),
          second_weight_src: secondIsManual ? 'MANUAL' : 'SERIAL',
          payment_status: paymentStatus,
        });
      }

      // Everything below weighs something, so from here a capture is required.
      if (!captured) throw new Error('No weight captured');

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
      setRepeatSecondWeight('');
      setFirstIsManual(false);
      setSecondIsManual(false);
      setSourceSlip(null);
      setSlipError(null);
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
  const repeatSecondKg = parseAmount(repeatSecondWeight);
  const knownFirstWeightValid = (!isSingleVisit && !isRepeat) || knownKg > 0;
  const repeatWeightsValid = !isRepeat || (knownKg > 0 && repeatSecondKg > 0);
  /* Nothing is captured in the fourth flow, so the capture gate does not
     apply to it — the two typed weights are the gate instead. */
  const captureSatisfied = isRepeat || captured !== null;

  // No name, no customer account — the same rule the return screen enforces.
  const canGoOnAccount = String(form.watch('customer_name') ?? '').trim().length > 0;
  useEffect(() => {
    if (!canGoOnAccount && paymentStatus === 'ON_ACCOUNT') setPaymentStatus('PAID');
  }, [canGoOnAccount, paymentStatus]);

  const submit = form.handleSubmit(
    (values) => {
      if (isRepeat && !sourceSlip) {
        toast.error('Fetch an earlier slip first');
        return;
      }
      if (isRepeat && !repeatWeightsValid) {
        toast.error('Both weights are needed', {
          description: 'Fetch a slip that has both, or type the missing one.',
        });
        return;
      }
      if (isSingleVisit && !knownFirstWeightValid) {
        toast.error('Enter the empty weight the driver gave you');
        return;
      }
      if (!captureSatisfied) {
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
    setKnownFirstWeight('');
    setRepeatSecondWeight('');
    setFirstIsManual(false);
    setSecondIsManual(false);
    setSourceSlip(null);
    setSlipError(null);
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
      <CardContent className="pt-6">
        {/*
          * Outside the form below, deliberately.
          *
          * SlipSearch carries a form of its own, and a form inside a form is
          * invalid HTML: pressing Enter in the slip box submitted the OUTER
          * form, so the browser navigated — the page appeared to reload and
          * the typed slip number vanished.
          */}
        {isRepeat && (
          <div className="mb-5 space-y-2">
            <SlipSearch
              onSearch={(slip) => lookup.mutate(slip)}
              isSearching={lookup.isPending}
              error={slipError}
              onErrorCleared={() => setSlipError(null)}
            />

            {sourceSlip && (
              <p className="text-sm text-muted-foreground">
                Filled from slip <span className="tabular font-semibold">{sourceSlip}</span>. Both
                weights can be corrected below; saving issues a new slip.
              </p>
            )}
          </div>
        )}

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
              <Label htmlFor="known-first-weight" className="sr-only">
                Empty weight, as given by the driver
              </Label>
              <div className="relative">
                <NumberInput
                  id="known-first-weight"
                  min={0}
                  step="1"
                  inputMode="numeric"
                  /* Short, because this box renders at text-3xl and the full
                     label would run past its edge. */
                  placeholder="Empty weight"
                  value={knownFirstWeight}
                  onChange={(event) => setKnownFirstWeight(event.target.value)}
                  className="tabular h-16 pr-14 text-3xl font-bold"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground">
                  kg
                </span>
              </div>
            </div>
          )}

          {/* ---------------------------------------------- fourth weight */}
          {isRepeat && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <RepeatWeightField
                  id="repeat-first-weight"
                  label="First weight"
                  value={knownFirstWeight}
                  onChange={setKnownFirstWeight}
                  manual={firstIsManual}
                  onManualChange={setFirstIsManual}
                />
                <RepeatWeightField
                  id="repeat-second-weight"
                  label="Second weight"
                  value={repeatSecondWeight}
                  onChange={setRepeatSecondWeight}
                  manual={secondIsManual}
                  onManualChange={setSecondIsManual}
                />
              </div>

              {/* The figure the customer is billed on, shown before it is
                  committed rather than discovered on the printed slip. */}
              <div className="rounded-lg border-2 border-brand/40 bg-brand/5 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Net weight
                </p>
                <p className="tabular mt-1 text-3xl font-bold leading-none">
                  {repeatWeightsValid
                    ? `${Math.abs(knownKg - repeatSecondKg).toLocaleString()} kg`
                    : '—'}
                </p>
              </div>
            </>
          )}

          {!isRepeat && <CustomerPicker onPick={applyCustomer} />}

          {/* Below the search box, not above it. Sitting above, it read as a
              heading the search field belonged under, so operators typed the
              customer's name into the search instead of the name field. */}
          <div className="border-t pt-5">
            <h3 className="text-lg font-semibold leading-none tracking-tight">Customer Details</h3>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              htmlFor="customer_name"
              label="Customer name"
              error={errors.customer_name?.message}
            >
              <Input
                id="customer_name"
                autoFocus
                {...form.register('customer_name')}
                placeholder="Customer name"
              />
            </Field>

            <Field
              htmlFor="customer_company"
              label="Company"
              error={errors.customer_company?.message}
            >
              <Input
                id="customer_company"
                {...form.register('customer_company')}
                placeholder="Company"
              />
            </Field>

            <Field
              htmlFor="vehicle_type"
              label="Vehicle type"
              error={errors.vehicle_type?.message}
              required
              markClass="right-8"
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
                  <SelectValue placeholder="Vehicle type" />
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
              label="Number Plate"
              error={errors.vehicle_plate?.message}
              required
            >
              <Input
                id="vehicle_plate"
                {...form.register('vehicle_plate')}
                placeholder="Number Plate"
                /* pr-8 keeps a long plate from running under the asterisk. */
                className="uppercase placeholder:normal-case pr-8"
              />
            </Field>

            <Field htmlFor="product" label="Product" error={errors.product?.message}>
              <Input id="product" {...form.register('product')} placeholder="Product" />
            </Field>

            <Field
              htmlFor="container_number"
              label="Container number"
              error={errors.container_number?.message}
            >
              <Input
                id="container_number"
                {...form.register('container_number')}
                placeholder="Container number"
                className="uppercase placeholder:normal-case"
              />
            </Field>

            <Field
              htmlFor="customer_phone"
              label="Phone"
              error={errors.customer_phone?.message}
            >
              <Input
                id="customer_phone"
                {...form.register('customer_phone')}
                placeholder="Phone"
                inputMode="tel"
              />
            </Field>

            <Field
              htmlFor="amount_charged"
              label="Amount charged"
              error={errors.amount_charged?.message}
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
                  placeholder="Amount charged"
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
          {(isSingleVisit || isRepeat) && (
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
              disabled={
                !captureSatisfied ||
                !knownFirstWeightValid ||
                !repeatWeightsValid ||
                (isRepeat && !sourceSlip) ||
                mutation.isPending
              }
            >
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {isSingleVisit || isRepeat ? 'Save & print slip' : 'Save first weight'}
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

          {!captureSatisfied && (
            <p className="text-sm text-muted-foreground">
              {isSingleVisit
                ? 'Capture the loaded weight before saving.'
                : 'Capture the first weight before saving.'}
            </p>
          )}

          {isRepeat && !sourceSlip && (
            <p className="text-sm text-muted-foreground">
              Fetch an earlier slip to fill this in.
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
  /**
   * Where the asterisk sits inside the control. Defaults to the right edge;
   * a Select needs to clear its own chevron.
   */
  markClass?: string;
  children: React.ReactNode;
}

function Field({ htmlFor, label, error, hint, required, markClass, children }: FieldProps) {
  return (
    <div className="space-y-2">
      {/*
        * Visually hidden, deliberately not deleted.
        *
        * The name of each box now lives in its placeholder, which keeps the
        * form from being half labels. But a placeholder is not a label: it
        * vanishes the moment the operator types, and a screen reader reading
        * a box with no label can only say "edit text". This keeps the name
        * attached to the control, and keeps clicking it focusing the box.
        */}
      <Label htmlFor={htmlFor} className="sr-only">
        {label}
        {required && <span>{' '}(required)</span>}
      </Label>
      {/*
        * Required is marked, optional is not. Saying "(optional)" on six of
        * eight boxes made the exception the rule and put the most words on
        * the fields that matter least. The asterisk is decorative here — the
        * hidden label already tells a screen reader which fields are needed.
        */}
      <div className="relative">
        {children}
        {required && (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute top-1/2 -translate-y-1/2 text-base font-semibold text-destructive',
              markClass ?? 'right-3',
            )}
          >
            *
          </span>
        )}
      </div>
      {error ? (
        <p className="text-sm font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * One of the fourth flow's two weights: a figure and whether the slip says a
 * human chose it.
 *
 * The box is big and tabular for the same reason the capture readout is —
 * this number ends up on a slip and in a net weight, and a mistyped digit is
 * a wrong invoice.
 */
function RepeatWeightField({
  id,
  label,
  value,
  onChange,
  manual,
  onManualChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  manual: boolean;
  onManualChange: (manual: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
      </Label>

      <div className="relative">
        <NumberInput
          id={id}
          min={0}
          step="1"
          inputMode="numeric"
          placeholder={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="tabular h-14 pr-12 text-2xl font-bold"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground">
          kg
        </span>
      </div>

      {/* A plain checkbox rather than the two-button pattern used elsewhere:
          this is one yes/no about what the slip prints, not a choice between
          two things the operator is weighing up. */}
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={manual}
          onChange={(event) => onManualChange(event.target.checked)}
          className="h-4 w-4 cursor-pointer accent-[hsl(var(--brand-orange))]"
        />
        Print &ldquo;MANUAL&rdquo; on the slip
      </label>
    </div>
  );
}
