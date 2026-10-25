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
  CONTAINER_VEHICLE_TYPE,
  DECLARED_PAYLOAD_DEDUCTION_KG,
  OWNER_DECLARATION,
  createWeighmentSchema,
  formatPKR,
  requireContainerNumber,
  formatKg,
  netWeightKg,
  parseAmount,
  type Customer,
  type PaymentStatus,
  type VehicleType,
  type Weighment,
} from '@suarza/shared';
import { Loader2, Save } from 'lucide-react';
import { agentApi, AgentApiError, signedInUsername, type AgentWarning } from '../lib/api.js';
import type { CapturedWeight } from './weight-capture.js';
import { CustomerPicker } from './customer-picker.js';
import { SlipSearch } from './slip-search.js';
import { RecentWeighments } from './recent-weighments.js';
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

/*
 * What the form is validated against: the shape above, plus the rule that
 * spans two fields — a container must carry its number. The agent applies
 * the very same refinement, so the screen and the service cannot disagree
 * about what a container weighing needs.
 */
const resolverSchema = formSchema.superRefine(requireContainerNumber);

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
    /* Off unless the operator asks for it: most trucks cross the bridge once
       and a directory full of them is a directory nobody can search. */
    save_customer: false,
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
  /*
   * --- fourth weight: the container re-weigh ------------------------------
   *
   * The whole earlier weighing, not a handful of fields off it. Its two
   * figures are shown and cannot be edited: they are what the bridge
   * actually read on the day, and the only new number here is the one the
   * customer declares.
   */
  const [source, setSource] = useState<Weighment | null>(null);
  /** What the customer says is inside the container, in kilos. */
  const [declaredPayload, setDeclaredPayload] = useState('');
  const sourceSlip = source?.slip_number ?? null;
  /**
   * Whether the slip the figures came from has photographs to carry over.
   *
   * Null until it has been asked. Worth asking before the save rather than
   * after the printing: this flow photographs nothing — there is no truck on
   * the bridge — so a source slip with no pictures makes a slip with no
   * pictures, and that is better known at the window than at the printer.
   */
  const [sourceHasPhotos, setSourceHasPhotos] = useState<boolean | null>(null);
  const [slipError, setSlipError] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('PAID');
  const refreshSyncStatus = useRefreshSyncStatus();
  // The rate card belongs to the manager now: this is the copy this bridge
  // pulled, and nothing here can edit it.
  const vehicleTypes = useVehicleTypes();

  const form = useForm<FormValues>({
    resolver: zodResolver(resolverSchema),
    defaultValues: emptyValues(),
  });

  const vehicleType = form.watch('vehicle_type') as VehicleType;

  /*
   * The charge, which nobody types.
   *
   * It is the manager's rate for the vehicle type, full stop — one figure
   * with one source, so a slip can never carry a price the rate card does
   * not explain. The box on screen shows it and cannot be edited.
   *
   * The container re-weigh charges nothing: it re-issues a slip against a
   * weighing the customer has already paid for.
   */
  const charge = isRepeat ? 0 : vehicleTypes.rateFor(vehicleType);
  useEffect(() => {
    form.setValue('amount_charged', charge);
  }, [charge, form]);

  /* Set as soon as the flow is opened rather than only when a slip is
     fetched, so the locked field never shows a type this flow cannot issue. */
  useEffect(() => {
    if (isRepeat)
      form.setValue('vehicle_type', CONTAINER_VEHICLE_TYPE as VehicleType, {
        shouldValidate: true,
      });
  }, [isRepeat, form]);

  /*
   * Fetch an earlier slip and fill the form from it.
   *
   * Deliberately fills the WEIGHTS as well as the details: the point of this
   * flow is that the truck's empty and loaded figures are already known, so
   * re-typing them is both slower and a chance to mistype. They stay editable.
   *
   * The customer's details are filled only where the field is still empty.
   * Both ways of starting a repeat weighing — searching the customer, or
   * fetching the slip — are offered side by side now, and either may come
   * first; whichever did, a slip fetched afterwards must not quietly rewrite
   * a customer the operator has already chosen. The weights always come from
   * the slip, because that is the one thing only the slip knows.
   */
  const lookup = useMutation({
    mutationFn: (slip: string) => agentApi.getWeighment(slip),
    onSuccess: ({ weighment }) => {
      /*
       * Completed slips only.
       *
       * This flow re-issues a weighing against figures the bridge already
       * took, and an open ticket has only half of them — there is nothing
       * to re-issue. A voided one was disowned on purpose, and quietly
       * carrying its figures into a fresh slip would put them back into the
       * record under a new number. The recent list still shows both, so the
       * operator can see what is there; the refusal happens here, where the
       * slip is actually used.
       */
      if (weighment.status !== 'COMPLETED') {
        setSource(null);
        setSourceHasPhotos(null);
        setSlipError(
          weighment.status === 'VOID'
            ? `Slip ${weighment.slip_number} was voided, so it cannot be re-weighed.`
            : `Slip ${weighment.slip_number} is not finished — it has no second weight yet. Only completed slips can be re-weighed here.`,
        );
        return;
      }

      setSource(weighment);
      setDeclaredPayload('');
      setSlipError(null);

      /*
       * The pictures, asked for separately and never waited on. The slip is
       * filled in the moment the weighing arrives; whether it also has
       * photographs is a line of reassurance that can land a beat later.
       */
      setSourceHasPhotos(null);
      void agentApi
        .slipCaptures(weighment.slip_number)
        .then((found) => setSourceHasPhotos(Boolean(found.front ?? found.side)))
        .catch(() => setSourceHasPhotos(false));

      /*
       * Snapshot FIRST, for the same reason applyCustomer does: deciding what
       * to fill while already filling would let an earlier write make a later
       * field look like something the operator had typed.
       */
      const blank = (
        field:
          | 'customer_name'
          | 'customer_company'
          | 'customer_phone'
          | 'vehicle_plate'
          | 'container_number'
          | 'product',
      ) => String(form.getValues(field) ?? '').trim() === '';

      const wasEmpty = {
        name: blank('customer_name'),
        company: blank('customer_company'),
        phone: blank('customer_phone'),
        plate: blank('vehicle_plate'),
        container: blank('container_number'),
        product: blank('product'),
      };

      const fill = (
        field:
          | 'customer_name'
          | 'customer_company'
          | 'customer_phone'
          | 'vehicle_plate'
          | 'container_number'
          | 'product',
        value: string,
        empty: boolean,
      ) => {
        if (empty && value) form.setValue(field, value, { shouldValidate: true });
      };

      fill('customer_name', weighment.customer_name, wasEmpty.name);
      fill('customer_company', weighment.customer_company, wasEmpty.company);
      fill('customer_phone', weighment.customer_phone ?? '', wasEmpty.phone);
      fill('container_number', weighment.container_number ?? '', wasEmpty.container);
      fill('product', weighment.product, wasEmpty.product);

      /* The plate comes from the slip when no truck has been named; a plate
         already typed must not be contradicted by the slip it did not come
         from. The vehicle TYPE does not follow it here — see below. */
      if (wasEmpty.plate && weighment.vehicle_plate) {
        form.setValue('vehicle_plate', weighment.vehicle_plate, { shouldValidate: true });
      }

      /*
       * A container, whatever the earlier slip said.
       *
       * This flow exists for containers: the customer declares what is
       * inside one. Carrying the old slip's vehicle type across would let a
       * declaration be issued against a tipper, so the type is set here and
       * the field is locked for the rest of the flow.
       */
      form.setValue('vehicle_type', CONTAINER_VEHICLE_TYPE as VehicleType, {
        shouldValidate: true,
      });

      toast.success(`Filled from slip ${weighment.slip_number}`);
    },
    onError: (error) => {
      setSource(null);
      setSourceHasPhotos(null);
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
        operator_username: signedInUsername() ?? DEFAULT_OPERATOR_USERNAME,
      };

      if (isRepeat) {
        if (!source || declared === null) throw new Error('No declared payload');

        /*
         * The first weight is the earlier slip's, unchanged and with its own
         * provenance: it was read off the indicator then, and saying
         * otherwise would disown a measurement the bridge actually took.
         *
         * The second is NOT. It is worked back from what the customer says
         * is in his container, so it is MANUAL on the slip and the slip
         * carries the owner's declaration beside it — see OWNER_DECLARATION.
         */
        return agentApi.createCompletedWeighment({
          ...details,
          first_weight_kg: source.first_weight_kg,
          first_weight_src: source.first_weight_src,
          second_weight_kg: declared.secondWeightKg,
          second_weight_src: 'MANUAL',
          owner_declared: true,
          payment_status: paymentStatus,
          /*
           * The photographs come off the slip the figures came off.
           *
           * Nothing is on the bridge in this flow — the truck was weighed on
           * an earlier visit — so photographing the yard now would put an
           * empty plate, or somebody else's lorry, onto this slip. The
           * honest picture is the one taken when this truck was last
           * weighed.
           */
          copy_captures_from_slip: source.slip_number,
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
          /* The bridge weighed the load; nobody declared it. */
          owner_declared: false,
          payment_status: paymentStatus,
          /* The pictures taken when the weight was, not when Save was
             pressed: by now the truck has often pulled off the bridge. */
          capture_id: captured.captureId ?? undefined,
        });
      }

      return agentApi.createWeighment({
        ...details,
        first_weight_kg: captured.kg,
        first_weight_src: captured.source,
        capture_id: captured.captureId ?? undefined,
      });
    },
    onSuccess: (response) => {
      form.reset(emptyValues());
      setKnownFirstWeight('');
      setSource(null);
      setDeclaredPayload('');
      setSlipError(null);
      setPaymentStatus('PAID');
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

  /*
   * What the declared payload makes of the earlier weighing.
   *
   * The yard deducts a hundred kilos from whatever the customer says is in
   * the container, and the slip is issued on what is left. The second
   * weight is then worked BACK from that net, in the same direction the
   * original weighing ran — a truck weighed empty first and loaded second
   * must not come out with its figures the other way round.
   *
   * Null until there is a slip and a payload worth more than the deduction;
   * a declaration of 100 kg or less would make a net of nothing.
   */
  const declared = (() => {
    if (!isRepeat || !source || source.second_weight_kg === null) return null;
    const payload = parseAmount(declaredPayload);
    const net = payload - DECLARED_PAYLOAD_DEDUCTION_KG;
    if (!(net > 0)) return null;

    const loadedWasHeavier = source.second_weight_kg >= source.first_weight_kg;
    return {
      payload,
      netKg: net,
      secondWeightKg: loadedWasHeavier
        ? source.first_weight_kg + net
        : source.first_weight_kg - net,
    };
  })();

  /* Nothing is captured in the fourth flow — the truck is not on the bridge
     — so the declaration stands in for the capture gate. */
  const captureSatisfied = isRepeat || captured !== null;

  // No name, no customer account — the same rule the return screen enforces.
  const canGoOnAccount = String(form.watch('customer_name') ?? '').trim().length > 0;
  useEffect(() => {
    if (!canGoOnAccount && paymentStatus === 'ON_ACCOUNT') setPaymentStatus('PAID');
  }, [canGoOnAccount, paymentStatus]);

  const submit = form.handleSubmit(
    (values) => {
      if (isRepeat && !source) {
        toast.error('Fetch a completed slip first');
        return;
      }
      if (isRepeat && !declared) {
        toast.error('Enter the payload of the container', {
          description: `It must be more than ${DECLARED_PAYLOAD_DEDUCTION_KG} kg, which is deducted from it.`,
        });
        return;
      }
      if (isSingleVisit && !knownFirstWeightValid) {
        toast.error('Enter the empty weight the driver gave you');
        return;
      }
      if (!captureSatisfied) {
        toast.error(
          isSingleVisit
            ? 'Capture the loaded weight before saving'
            : 'Capture the first weight before saving',
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
    setKnownFirstWeight('');
    setSource(null);
    setDeclaredPayload('');
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

      /* The rate follows the type by itself — see `charge`. */
      if (customer.last_vehicle_type) {
        form.setValue('vehicle_type', customer.last_vehicle_type, { shouldValidate: true });
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
                Filled from slip <span className="tabular font-semibold">{sourceSlip}</span>. Its
                weights cannot be changed; saving issues a new slip.{' '}
                {sourceHasPhotos === true && 'Its photographs will be carried over.'}
                {sourceHasPhotos === false && (
                  <span className="font-medium text-brand">
                    It has no photographs, so this slip will print without them.
                  </span>
                )}
              </p>
            )}

            {/*
             * The same list the second-weight screen offers, and for the
             * same reason: reading six digits off a dusty slip and typing
             * them is slower and likelier to go wrong than picking the
             * truck from a list.
             *
             * It shows everything, open tickets included. Hiding them
             * would leave an operator wondering why a slip he can see on
             * the paper in his hand is missing from the screen; picking
             * one says plainly why it cannot be used here.
             */}
            {!sourceSlip && <RecentWeighments onPick={(slip) => lookup.mutate(slip)} />}
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
          {isRepeat && source && (
            <>
              {/*
               * What the bridge actually read, on the day it read it.
               *
               * Shown and not editable: these are the measurements this
               * slip is built on, and the only new figure in this flow is
               * the one the customer declares.
               */}
              <div className="grid gap-3 sm:grid-cols-3">
                <WeighedFigure label="First weight" kg={source.first_weight_kg} />
                <WeighedFigure label="Second weight" kg={source.second_weight_kg ?? 0} />
                <WeighedFigure
                  label="Net weight"
                  kg={netWeightKg(source.first_weight_kg, source.second_weight_kg)}
                />
              </div>

              {/* The one number typed in this flow, so it gets the big box
                  the captured weight gets everywhere else. */}
              <div className="space-y-2 rounded-lg border-2 border-brand/40 bg-brand/5 p-4">
                <Label htmlFor="declared-payload" className="text-sm font-medium">
                  What is the payload of the container?
                </Label>
                <div className="relative">
                  <NumberInput
                    id="declared-payload"
                    min={0}
                    step="1"
                    inputMode="numeric"
                    placeholder="Payload"
                    value={declaredPayload}
                    onChange={(event) => setDeclaredPayload(event.target.value)}
                    className="tabular h-16 pr-14 text-3xl font-bold"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground">
                    kg
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  As the owner declares it. {DECLARED_PAYLOAD_DEDUCTION_KG} kg is deducted, and the
                  new slip is issued on what is left.
                </p>
              </div>

              {/*
               * The arithmetic, in full, before it is committed.
               *
               * An operator about to hand a customer a slip should be able
               * to see where its figures came from — not discover them on
               * the printed sheet.
               */}
              <div className="rounded-lg border-2 border-brand/40 bg-brand/5 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      New net weight
                    </p>
                    <p className="tabular mt-1 text-3xl font-bold leading-none">
                      {declared ? `${declared.netKg.toLocaleString()} kg` : '—'}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      New second weight
                    </p>
                    <p className="tabular mt-1 text-xl font-semibold leading-none">
                      {declared ? `${declared.secondWeightKg.toLocaleString()} kg` : '—'}
                      <span className="ml-1 text-xs font-medium text-muted-foreground">
                        (MANUAL)
                      </span>
                    </p>
                  </div>
                </div>

                <p className="mt-3 border-t border-brand/20 pt-2 text-xs text-muted-foreground">
                  {declared
                    ? `${declared.payload.toLocaleString()} kg declared − ${DECLARED_PAYLOAD_DEDUCTION_KG} kg = ${declared.netKg.toLocaleString()} kg net.`
                    : `Enter a payload of more than ${DECLARED_PAYLOAD_DEDUCTION_KG} kg.`}{' '}
                  The slip will carry: “{OWNER_DECLARATION}”
                </p>
              </div>
            </>
          )}

          {/* Offered in the repeat flow too. The driver's slip gives the
              weights; the customer may still be quicker to find by name or
              plate than by hunting for an old slip number, and the two fill
              different halves of this form. */}
          <CustomerPicker onPick={applyCustomer} />

          {/* Below the search box, not above it. Sitting above, it read as a
              heading the search field belonged under, so operators typed the
              customer's name into the search instead of the name field. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            <h3 className="text-lg font-semibold leading-none tracking-tight">Customer Details</h3>

            {/*
             * Beside the heading it belongs to, not down with the save
             * buttons: it is a fact about this customer, decided while the
             * operator is looking at their name.
             *
             * Off by default. Ticking it for somebody already saved does not
             * make a second entry — the directory merges on name and company
             * — so the operator never has to remember who is in it.
             */}
            <label className="flex cursor-pointer select-none items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/60">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                {...form.register('save_customer')}
              />
              Make customer
              <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
                (save for next time)
              </span>
            </label>
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
                /* Locked in the container re-weigh: the flow issues a slip
                   against a customer's declaration of what is in his
                   container, so anything else is not a thing it can do. */
                disabled={isRepeat}
                /* The rate follows the type on its own — see `charge`. */
                onValueChange={(value) =>
                  form.setValue('vehicle_type', value as VehicleType, { shouldValidate: true })
                }
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
              {isRepeat && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Always a container in this flow.
                </p>
              )}
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

            {/* Only a container has one, and every container must have one:
                the number is what ties the weighing to the box it was for. */}
            {vehicleType === CONTAINER_VEHICLE_TYPE && (
              <Field
                htmlFor="container_number"
                label="Container number"
                error={errors.container_number?.message}
                required
              >
                <Input
                  id="container_number"
                  {...form.register('container_number')}
                  placeholder="Container number"
                  className="uppercase placeholder:normal-case"
                />
              </Field>
            )}

            <Field htmlFor="customer_phone" label="Phone" error={errors.customer_phone?.message}>
              <Input
                id="customer_phone"
                {...form.register('customer_phone')}
                placeholder="Phone"
                inputMode="tel"
              />
            </Field>

            {/*
             * Shown, not typed.
             *
             * The charge is the manager's rate for the vehicle type, and
             * leaving it editable meant a slip could carry a price the rate
             * card did not explain — and two operators charging differently
             * for the same lorry. It moves when the vehicle type moves, and
             * the container re-weigh charges nothing at all.
             */}
            <Field htmlFor="amount_charged" label="Amount charged">
              <div
                id="amount_charged"
                className="tabular flex h-10 items-center rounded-md border bg-muted/60 px-3 text-base font-semibold"
              >
                {formatPKR(charge)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {isRepeat
                  ? 'Nothing is charged for a re-issued slip.'
                  : "From the manager's rate card."}
              </p>
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
                (isRepeat && !declared) ||
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
            <p className="text-sm text-muted-foreground">Fetch a completed slip to fill this in.</p>
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
        {required && <span> (required)</span>}
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
 * A figure the bridge already read, shown and not editable.
 *
 * Not an input: these came off the indicator on an earlier visit and this
 * flow has no business changing them. The only new number here is the one
 * the customer declares, and it has a box of its own.
 */
function WeighedFigure({ label, kg }: { label: string; kg: number }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-xl font-bold leading-none">{formatKg(kg)}</p>
    </div>
  );
}
