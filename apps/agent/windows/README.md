# Running the agent on the weighbridge PC

Written for: whoever sets up the Windows PC at the weighbridge.

## What you are installing

One program, the **weighbridge agent**. It reads the weight indicator over the
serial cable, stores every weighment on this PC, serves the operator screen at
`http://localhost:3100`, and sends completed records to the cloud when there is
internet.

Everything the operator uses is that one address in a browser. Nothing else is
installed, and no other machine is involved in weighing.

## One-time setup

Done once, by whoever sets the machine up. After this the operator only ever
uses the desktop icon.

1. **Install Node.js 20 or newer** from nodejs.org (the LTS installer).

2. **Copy the agent folder** onto the PC, for example `C:\suarza\agent`.

3. **Run `windows\install.bat`** (double-click it). It installs the
   dependencies, builds the software, creates a `.env` for you to fill in, and
   puts a **Suarza Weighbridge** icon on the desktop.

4. **Open `.env` in Notepad** and set the values below. The one that always
   needs changing is `SERIAL_PORT`.

   | Setting            | What to put                                                              |
   | ------------------ | ------------------------------------------------------------------------ |
   | `SERIAL_PORT`      | The COM port the indicator is on — `COM3`, `COM4`…                       |
   | `SERIAL_BAUD_RATE` | From the indicator's manual, usually `9600`                              |
   | `USE_SIMULATOR`    | `false` on a real bridge; `true` to test with no hardware                |
   | `DATABASE_PATH`    | Leave as is, or point somewhere like `C:\suarza\data\weighbridge.sqlite` |
   | `CLOUD_API_URL`    | The address of the cloud server                                          |
   | `CLOUD_API_KEY`    | The ingest key from the cloud server's `.env` — the two must match       |

   **Finding the COM port:** plug in the indicator, open Device Manager, and
   look under _Ports (COM & LPT)_. The `sniff` tool shows what the indicator is
   actually sending: `npm run sniff COM3`.

## Every day

**The operator double-clicks _Suarza Weighbridge_ on the desktop.** That is the
whole routine, including after a power cut.

The icon:

- starts the software if it is not running, in a minimised window that can be
  ignored;
- waits until it is ready, then opens the weighing screen;
- if it is **already** running, just reopens the screen — it never starts a
  second copy. Two copies cannot both hold the port and the database file, and
  the error the second one produces (`EADDRINUSE`) means nothing to the person
  reading it.

Closing the weighing screen does not stop the software. Clicking the icon again
brings the screen straight back.

To stop it completely, close the minimised **Suarza Weighbridge Agent** window.

## Checking it works

- Open `http://localhost:3100` in Chrome — the operator screen should appear.
- Open `http://localhost:3100/health` — it should show `{"status":"ok"…}`.

## Silent printing

By default Chrome shows a print dialog for every receipt. To have receipts
print straight to the default printer, create a desktop shortcut to Chrome with
these arguments:

```
chrome.exe --kiosk-printing --app=http://localhost:3100
```

Then install the operator app from that window (Chrome menu → _Cast, save and
share_ → _Install page as app_). The operator gets a window with no address bar
that prints without asking.

## Day-to-day

- **Backups:** set a backup folder in the operator app's Settings — ideally a
  different drive or a USB stick. The last 14 copies are kept.
- **Restart it:** close the agent window and start it again.

## If something goes wrong

| What you see                                 | What it means                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Operator screen says **"No signal"**         | The indicator is off, unplugged, or on a different COM port. Weighing still works — use _Enter manually_. |
| Operator screen says **"Service offline"**   | The agent is not running. Start it again.                                                                 |
| **"Cloud offline"** with a pending count     | No internet. Nothing is lost — records sync by themselves when it returns.                                |
| Receipts print in the wrong place on the pad | Settings → _Test print_, then adjust the top/left offsets.                                                |
