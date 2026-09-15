# Weighing trucks — operator guide

**Suarza International Weighbridge**

This is everything you need to weigh a truck, print its slip, and deal with the
things that go wrong. Keep it by the screen.

---

## The screen

The big number on the left is the **live weight** coming from the indicator. It
is always there, whatever else you are doing.

Next to it you will see one of these:

| It says                    | It means                                                                        |
| -------------------------- | ------------------------------------------------------------------------------- |
| **Stable**                 | The reading has settled. You can capture it.                                    |
| **Unstable**               | The truck is still moving or settling. Wait a moment.                           |
| **Stability not reported** | This indicator cannot tell us. You will be asked to confirm the number.         |
| **No signal**              | The indicator is off, unplugged, or on the wrong cable. Use **Enter manually**. |
| **Service offline**        | The weighbridge software has stopped. Tell whoever looks after the PC.          |

Below that it tells you whether the cloud is connected and how many records are
still waiting to be sent.

> **You can always keep weighing.** The internet is only used to send finished
> records upward. If it says _Cloud offline_, nothing is lost — records are
> saved on this PC and sent by themselves when the connection comes back.

---

## Weighing a truck: the two passes

Every truck is weighed **twice**. Once when it arrives, once when it leaves.
Two slips are printed.

### Pass 1 — the truck arrives

1. Make sure you are on the **First weight** tab at the top.
2. Let the truck drive fully onto the bridge and stop.
3. Wait for **Stable**, then press **Capture weight** (or the **F2** key).
4. Fill in the form: customer name, company, vehicle type, plate, product.
   Phone and container number are optional.
   - **If this customer has been here before**, type a few letters of their
     name or company into **Find an existing customer** and pick them from the
     list. Everything we already know about them fills in — name, company,
     phone, and the truck and load they brought last time. Change anything that
     is different today; nothing is locked.
   - The **amount** fills in by itself from the vehicle type. You can change it.
5. Press **Save first weight** (or **F9**).
6. The screen shows a **slip number** like `SI-000123` and the receipt opens in
   a **new tab**, ready to print. **Give that slip to the driver.** They need it
   to come back.
   - **Print** sends it to the printer. **Download PDF** saves a full copy with
     the company header and footer on it — useful for emailing a customer.
   - Close that tab when you are done. The weighing screen is still behind it.

### Pass 2 — the truck returns

1. Press the **Main** tab at the top.
2. Either **click the truck in the Recent weighments list** underneath, or type
   the slip number from the driver's paper and press Enter.
   - The list shows everything weighed recently. The ones still waiting for a
     second weight are at the top, marked **Awaiting 2nd weight**. Completed
     ones are below, so a driver who has lost their slip can still be found.
   - Typing works too: in full (`SI-000123`) or just the digits (`123`).
   - **F3** jumps to the slip box at any time.
3. The truck's details appear. They cannot be changed — they were settled at the
   first weighing and the driver's paper has to match.
4. Let the truck stop on the bridge, wait for **Stable**, press **Capture
   weight**.
5. The **net weight** appears straight away — in kilograms, tons and maunds —
   before you save anything. Check it looks right.
6. Check the **amount**. Change it if you need to.
7. Press **Complete weighing** (or **F9**). The second receipt prints.

---

## Keys worth learning

| Key    | Does                                |
| ------ | ----------------------------------- |
| **F2** | Capture the weight                  |
| **F3** | Jump to the slip number box         |
| **F4** | Clear the form / start another slip |
| **F9** | Save or complete                    |

---

## When things go wrong

### The indicator shows nothing

Press **Enter manually**, type the weight from the indicator's own display, and
press **Use this weight**.

The receipt and the record will both say the weight was entered by hand. That is
deliberate and normal — it is not a mistake, it is a note for later.

### The reading will not settle

Do not capture it. Ask the driver to switch the engine off and stay still. If it
still will not settle, use **Enter manually** and read the indicator's display.

### The driver has lost the slip

Look in the **Recent weighments** list on the **Main** tab — the truck is
almost certainly there, with the customer name and plate next to it. If it is
too old to be in the list, whoever has the manager dashboard can look it up.

### The slip has already been completed

The screen will tell you. You cannot weigh it twice. If the driver needs another
copy of the paper, press **Reprint receipt** — the reprint is stamped
**REPRINT** so it is not mistaken for the original.

### The truck never came back

Find the slip on the **Return** tab and press **Void ticket**. You must type a
reason — "Truck never returned" is fine.

The record is kept for the books but is not counted as money earned. Nothing is
ever deleted.

### The same truck already has an open ticket

You will see a warning, and the save still goes through. That is on purpose —
sometimes it is genuinely a second load. Just check it is not a mistake.

---

## The QR code on the receipt

Every receipt has a QR code. The customer can point a phone camera at it and see
their receipt on a web page, with a button to download a PDF.

**One thing to know:** the QR needs the internet, and it needs the record to
have reached the cloud — normally a second or two after you save it. If the PC
is offline when you print, the code will not work until the connection comes
back and the record syncs. It will start working by itself once that happens.

If a customer says the code does not work, that is almost always the reason.
Their paper slip is still valid.

---

## Printing

Receipts open in their **own tab**, so you can see what is about to come out and
print it again without redoing anything.

They print onto the pre-printed pads, which already have the company name and
address on them, so the software only prints the middle part. The **Download
PDF** button is different — that gives you the whole receipt, header and footer
included, for a customer who has no pad.

If the printing lands in the wrong place on the pad, open **Settings** (the gear
icon, top right) and:

1. Press **Test print** and put one blank pad sheet through.
2. Measure how far off it is.
3. Change **Top offset** and **Left offset** by that many millimetres.
4. Test print again until it sits inside the blank area.

The test sheet has a bar on it that should measure exactly 100 mm. If it does
not, the printer is shrinking the page — turn off "fit to page" in the print
dialog.

---

## At the end of the day

There is nothing to shut down or save. Every weighing is written to this PC the
moment you press save, and sent to the cloud by itself.

If the bottom of the live-weight panel still says records are waiting to sync,
that is fine — leave the PC on and they will go when the connection returns.
