# Delta Billing Excel add-in: setup

This is a one-time setup and takes about 20 minutes. After that, each week you open your billing workbook, click **Home > Pull Trips**, pick the dates, and click **Pull trips**.

## What it does
- It reads the trip events from your Google Calendar.
- It gets the driving miles from Google Maps. Each distance is saved on the **Mileage** sheet, so the same trip is never looked up twice. If a mileage is wrong, correct it there.
- It adds one row per leg to a sheet for each facility (for example "Encompass Sugarland"), using your columns: Name of Patient, Facility Name, Period … Case Manager.
- A Pickup and Return becomes two rows. The wait fee is split between them, the same way the facility sheets do it today.
- (Google) and (Referral) trips go on a "Google" or "Referral" sheet. Each gets one row with the patient, addresses, miles, total, Self Pay, and Paid or Not Paid, the same way private-pay trips are recorded today. **Card numbers and phone numbers are never copied.**
- Trips already in a sheet are skipped, so pulling again doesn't create duplicates. A hidden "Trip ID" column tracks this.
- Rows that need a person to check them are highlighted yellow, with the reason in **Notes**.
- Driver, Voucher/Code # and Case Manager are left blank for you to fill in.

## Step 1: Put the add-in files online (done)
The files are hosted free on GitHub Pages at **https://hassounajad1-dev.github.io/Delta-billing/**. This address is called **HOST** below. The files hold no keys and no patient data. Your Google client ID and Maps key live only in your workbook.

## Step 2: Google Cloud (Calendar access and Maps miles)
1. Go to console.cloud.google.com and sign in with the Google account that has the trips calendar. Create a project named "Delta Billing".
2. **APIs & Services > Library**: turn on **Google Calendar API** and **Routes API**.
3. **APIs & Services > OAuth consent screen**: choose External (or Internal if you have Google Workspace) and give it the app name "Delta Billing". Under *Test users*, add the Google accounts that will sign in.
4. **Credentials > Create credentials > OAuth client ID**, with type **Web application**:
   - Authorized JavaScript origins: `https://hassounajad1-dev.github.io`
   - Authorized redirect URIs: `HOST` + `auth.html`. That is: `https://hassounajad1-dev.github.io/Delta-billing/auth.html`
   - Copy the **Client ID**.
5. **Credentials > Create credentials > API key**. Click *Edit*:
   - Application restrictions: **Websites**. Add `https://hassounajad1-dev.github.io/*`
   - API restrictions: **Routes API** only.
   - Copy the **key**.
6. Maps needs a billing account on the project. Google gives thousands of route lookups free each month, and the add-in only looks up each address pair once, so normal use should cost $0. You can set a budget alert under **Billing > Budgets** if you want one.

## Step 3: Install it in Excel
1. Download `manifest.xml` from the repository. It already points at HOST.
2. In Excel, go to **Home > Add-ins > More Add-ins > My Add-ins > Upload My Add-in** and pick `manifest.xml`. (In older Excel versions this is under **Insert > My Add-ins**.)
3. A **Pull Trips** button appears on the Home tab.

## Step 4: First run
1. Open your billing workbook and click **Pull Trips**. In the panel, click **Add Settings, Rates and Facilities sheets**.
2. On **Settings**, paste the Client ID and the Maps key. If the trips are on a calendar other than your main one, paste its Calendar ID (Google Calendar > that calendar's settings > *Integrate calendar*).
3. Click **Sign in with Google**, then **Pull trips**.
4. Check the yellow rows.

## Changing things later
- **Rates sheet:** change any contract rate here. Blank means the contract doesn't include that charge.
- **Facilities sheet:** one row per location that's billed separately. Add other spellings your dispatchers use in "Also written as", separated by `;`. A new facility needs a row here and a rate group on Rates.
- **Settings sheet:** off-hours time (5:30 PM), the 270 lb rule, mile rounding, and the status for new facility trips ("Invoice In process").

## How dispatchers should write events (what it understands)
- Title: `(Encompass Humble) Patient Name …` names the facility. `(Google)`, `(Referral)`, or just `Google` means private pay.
- `Discharge`, `Admission` or `Appointment` / `Appt` anywhere in the event.
- `Pickup:` and `Destination:`, with the facility name and/or address. The room, suite, and city lines underneath are fine too.
- `Pickup: 8:30AM` or `Pickup time:` or `Time:`. Also `Appt: 9:45AM` and `Return: 12PM`.
- `*Pickup and Return*` means two legs. `DROP OFF ONLY` means one leg.
- `**Specialty Wheelchair**` or `*Bariatric Wheelchair*`. The weight as `146lbs`.
- `No o2` or `o2/2L`. `**NO SHOW**` for no-shows.
- `ADD WAIT FEE` or `ADD OFF HOURS FEE` adds that fee to a trip that wouldn't get it otherwise. Without the note, a one-way trip gets no wait fee, and a Pickup and Return appointment gets the wait fee split across both legs.
- `Wait fee x3` (or ×3) charges three times the contract wait fee.
- Multi-stop: `+2nd Destination:`, `+3rd Destination:`, and so on. Each drive becomes its own row with its own base rate, plus one wait fee for each stop where we waited, split across the rows. With `Pickup and Return`, a last row goes back to the pickup.
- Appointment then discharge: `Then Discharge <address>`, `Discharge Address:` or `2nd Destination:`. This makes two rows, facility → appointment and appointment → discharge address, with one wait fee split across them. Billed to the pickup facility.
- Encompass Chasewood and Encompass Vintage are the same facility (Vintage sheet).
- Off-hours means pickups before 7:00 AM or at/after 5:30 PM, every day including weekends. Over 270 lbs means the bariatric rate, or the specialty rate if the contract has no bariatric rate.
- Private pay amount: `$156-Not Paid` or `$222 Paid`.
