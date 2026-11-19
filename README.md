# Delta Billing

An Excel add-in for Delta Wheelchair Services. It pulls trips from Google Calendar, measures the driving miles with Google Maps, applies each facility's contract rates, and fills one billing sheet per facility.

- **Setup:** [SETUP.md](SETUP.md)
- **Add-in page:** `taskpane.html` and `taskpane.js`. Google sign-in is in `auth.html`.
- **Billing rules:** `shared/Parser.gs` reads a calendar event, and `shared/Billing.gs` prices it. `shared/ContractData.gs` holds the default rates and facilities.
- **After changing anything in `shared/`:** run `sh build.sh` to regenerate `billing-core.js`.

No API keys or patient data are stored in this repository. Keys live in the workbook's Settings sheet.
