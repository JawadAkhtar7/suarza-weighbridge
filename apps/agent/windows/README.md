# Running the agent on the weighbridge PC

Written for: whoever sets up the Windows PC at the weighbridge.

## What you are installing

One Windows service, **Suarza Weighbridge Agent**. It reads the weight
indicator over the serial cable, stores every weighment on this PC, serves the
operator screen at `http://localhost:3100`, and sends completed records to the
cloud when there is internet.

It runs as a service so it starts when the PC boots — before anyone logs in —
and restarts itself if it ever stops.

## One-time setup

1. **Install Node.js 20 or newer** from nodejs.org (the LTS installer).

2. **Copy the agent folder** onto the PC, for example `C:\suarza\agent`.

3. **Create the configuration file.** Copy `.env.example` to `.env` and open it
   in Notepad. The settings that matter:

   | Setting            | What to put                                                              |
   | ------------------ | ------------------------------------------------------------------------ |
   | `SERIAL_PORT`      | The COM port the indicator is on — `COM3`, `COM4`…                       |
   | `SERIAL_BAUD_RATE` | From the indicator's manual, usually `9600`                              |
   | `USE_SIMULATOR`    | `false` on a real bridge; `true` to test with no hardware                |
   | `DATABASE_PATH`    | Leave as is, or point somewhere like `C:\suarza\data\weighbridge.sqlite` |
   | `CLOUD_API_URL`    | The address of the cloud server                                          |
   | `CLOUD_API_KEY`    | The ingest key from the cloud server's `.env` — the two must match       |

   **Finding the COM port:** plug in the indicator, open Device Manager, and
   look under _Ports (COM & LPT)_.

4. **Install the dependencies and build**, in a command prompt in that folder:

   ```
   npm install --omit=dev
   npm install node-windows
   ```

5. **Install the service** — this step needs an **Administrator** command
   prompt (right-click Command Prompt → _Run as administrator_):

   ```
   node windows\install-service.cjs
   ```

   It installs the service and starts it. You should see
   _"Suarza Weighbridge Agent is running."_

## Checking it works

- Open `http://localhost:3100` in Chrome — the operator screen should appear.
- Open `http://localhost:3100/health` — it should show `{"status":"ok"…}`.
- In Windows, open _Services_ (`services.msc`) and find
  **Suarza Weighbridge Agent**. Startup type should be **Automatic**.
- Restart the PC and check `http://localhost:3100` again without logging in
  first. That confirms it really does start at boot.

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

- **Logs:** the service writes to `daemon\` inside the agent folder.
- **Restart it:** Services → _Suarza Weighbridge Agent_ → Restart.
- **Backups:** set a backup folder in the operator app's Settings — ideally a
  different drive or a USB stick. The last 14 copies are kept.
- **Uninstall:** from an Administrator prompt,
  `node windows\uninstall-service.cjs`. Your records are not deleted.

## If something goes wrong

| What you see                                 | What it means                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Operator screen says **"No signal"**         | The indicator is off, unplugged, or on a different COM port. Weighing still works — use _Enter manually_. |
| Operator screen says **"Service offline"**   | The Windows service is not running. Check Services.                                                       |
| **"Cloud offline"** with a pending count     | No internet. Nothing is lost — records sync by themselves when it returns.                                |
| Receipts print in the wrong place on the pad | Settings → _Test print_, then adjust the top/left offsets.                                                |
