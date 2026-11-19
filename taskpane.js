/* Delta Billing Excel add-in: task pane logic.
 * Uses billing-core.js (parseTripEvent, buildLegs, SEED_* data) shared with the Google Sheet version.
 */

// Jad's billing sheet columns, in order. "Trip ID" is extra and kept hidden; it stops duplicates.
var COLUMNS = ['Name of Patient', 'Facility Name', 'Period (Month/year)', 'Date (Month/Day/Year)', 'Driver',
  'Type of Call', 'Pick Up Location', 'Drop Off Location', 'Trip Total Miles', 'Base Prcie', 'Price Per Mile',
  'Wait Time', 'Oxygen Supply Fees', 'Off Hours Fees', 'Other Extra Fees', 'Total Amount', 'Pay Type',
  'Payment Status', 'Notes', 'Voucher/Code #', 'Case Manager', 'Trip ID'];
var MONEY_COLS = [9, 10, 11, 12, 13, 14, 15];   // zero-based: Base .. Total

var SETTINGS_ROWS = [
  ['Setting', 'Value', 'What it means'],
  ['Google OAuth client ID', '', 'From Google Cloud > APIs & Services > Credentials (see setup steps).'],
  ['Google Maps API key', '', 'From Google Cloud, with the Routes API turned on. Used only to measure miles.'],
  ['Calendar ID', 'primary', '"primary" = the signed-in account\'s main calendar, or paste a calendar ID.'],
  ['Off-hours after', '5:30 PM', 'Pickups at or after this time get the off-hours fee.'],
  ['Off-hours before', '7:00 AM', 'Pickups before this time also get it. Weekends follow the same times.'],
  ['Bariatric weight (lbs)', 270, 'Patients over this weight get a higher chair rate even if not written.'],
  ['Over-weight bills as', 'Bariatric', 'Bariatric = contract bariatric rate, or specialty if it has none.'],
  ['Mile rounding', '0.1', '0.1 = nearest tenth, whole = nearest mile, up = round up.'],
  ['Add-ons on both legs', 'Yes', 'Yes = O2 and off-hours fees on each leg of a Pickup and Return.'],
  ['New facility trip status', 'Invoice In process', 'What goes in Payment Status for new facility trips.']
];

var state = { token: null, tokenExpires: 0 };

Office.onReady(function () {
  $('signin').onclick = signIn;
  $('pull').onclick = function () { run(pullTrips); };
  $('setup').onclick = function () { run(setupWorkbook); };
  $('range').onchange = function () { $('customDates').hidden = this.value !== 'custom'; };
});

function $(id) { return document.getElementById(id); }
function say(msg, kind) { var s = $('status'); s.textContent = msg; s.className = kind || ''; }

async function run(fn) {
  $('pull').disabled = true;
  try { await fn(); }
  catch (e) { console.error(e); say('Something went wrong: ' + (e.message || e), 'warn'); }
  finally { $('pull').disabled = !state.token; }
}

/* ---------------- Google sign-in (Office dialog + Google OAuth) ---------------- */

async function signIn() {
  var settings = await readSettings();
  if (!settings.clientId) { say('Add your Google OAuth client ID on the Settings sheet first. Click "Add Settings, Rates and Facilities sheets" if it is not there.', 'warn'); return; }
  var base = location.href.replace(/[^\/]*$/, '');
  var url = base + 'auth.html?client_id=' + encodeURIComponent(settings.clientId);
  Office.context.ui.displayDialogAsync(url, { height: 60, width: 30 }, function (res) {
    if (res.status !== Office.AsyncResultStatus.Succeeded) { say('Could not open the sign-in window: ' + res.error.message, 'warn'); return; }
    var dlg = res.value;
    dlg.addEventHandler(Office.EventType.DialogMessageReceived, function (arg) {
      dlg.close();
      var msg = JSON.parse(arg.message);
      if (!msg.ok) { say('Sign-in failed: ' + msg.error, 'warn'); return; }
      state.token = msg.token;
      state.tokenExpires = Date.now() + (msg.expiresIn - 60) * 1000;
      $('who').textContent = 'Signed in. Good for about an hour.';
      $('pull').disabled = false;
      say('Signed in. Pick dates and click Pull trips.', 'ok');
    });
  });
}

/* ---------------- Workbook setup ---------------- */

async function setupWorkbook() {
  await Excel.run(async function (ctx) {
    var made = [];
    if (await addSheetIfMissing(ctx, 'Settings', SETTINGS_ROWS)) made.push('Settings');
    if (await addSheetIfMissing(ctx, 'Rates', [RATE_HEADERS].concat(SEED_RATES))) made.push('Rates');
    if (await addSheetIfMissing(ctx, 'Facilities', [FACILITY_HEADERS].concat(SEED_FACILITIES))) made.push('Facilities');
    if (await addSheetIfMissing(ctx, 'Mileage', [['From', 'To', 'Driving miles (edit to correct)']])) made.push('Mileage');
    await ctx.sync();
    say(made.length ? 'Added: ' + made.join(', ') + '. Fill in the client ID and Maps key on Settings.' : 'All setup sheets already exist.', 'ok');
  });
}

async function addSheetIfMissing(ctx, name, rows) {
  var ws = ctx.workbook.worksheets.getItemOrNullObject(name);
  await ctx.sync();
  if (!ws.isNullObject) return false;
  ws = ctx.workbook.worksheets.add(name);
  var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
  var data = rows.map(function (r) { r = r.slice(); while (r.length < width) r.push(''); return r; });
  ws.getRangeByIndexes(0, 0, data.length, width).values = data;
  styleHeader(ws.getRangeByIndexes(0, 0, 1, width));
  ws.freezePanes.freezeRows(1);
  ws.getRangeByIndexes(0, 0, data.length, width).format.autofitColumns();
  return true;
}

function styleHeader(r) { r.format.font.bold = true; r.format.fill.color = '#E8EEF7'; }

/* ---------------- Reading Settings / Rates / Facilities / Mileage ---------------- */

async function readSheetValues(name) {
  return Excel.run(async function (ctx) {
    var ws = ctx.workbook.worksheets.getItemOrNullObject(name);
    await ctx.sync();
    if (ws.isNullObject) return null;
    var used = ws.getUsedRangeOrNullObject(true);
    used.load('values');
    await ctx.sync();
    return used.isNullObject ? [] : used.values;
  });
}

/** Excel may store "5:30 PM" as a fraction of a day (0.729...). Turn either form into text. */
function cellText(v) {
  if (typeof v === 'number' && v > 0 && v < 1) {
    var mins = Math.round(v * 1440), h = Math.floor(mins / 60), mm = mins % 60;
    return (h % 12 || 12) + ':' + pad(mm) + (h >= 12 ? ' PM' : ' AM');
  }
  return String(v).trim();
}

async function readSettings() {
  var vals = await readSheetValues('Settings');
  var m = {};
  (vals || []).slice(1).forEach(function (r) { m[String(r[0]).trim()] = cellText(r[1]); });
  return {
    clientId: m['Google OAuth client ID'] || '',
    mapsKey: m['Google Maps API key'] || '',
    calendarId: m['Calendar ID'] || 'primary',
    offHoursAfter: parseTimeToMinutes_(m['Off-hours after'] || '5:30 PM'),
    offHoursBefore: parseTimeToMinutes_(m['Off-hours before'] == null ? '7:00 AM' : m['Off-hours before']),
    bariatricLbs: Number(m['Bariatric weight (lbs)']) || 270,
    overweightTier: /specialty/i.test(m['Over-weight bills as'] || '') ? 'Specialty' : 'Bariatric',
    mileRounding: (m['Mile rounding'] || '0.1').toLowerCase(),
    addOnsEachLeg: !/^n/i.test(m['Add-ons on both legs'] || 'Yes'),
    newStatus: m['New facility trip status'] || 'Invoice In process'
  };
}

async function readFacilities() {
  var vals = await readSheetValues('Facilities');
  var rows = vals ? vals.slice(1) : SEED_FACILITIES;
  return rows.filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
    return { name: String(r[0]).trim(),
      aliases: String(r[1] || '').split(';').map(function (s) { return s.trim(); }).filter(String),
      address: String(r[2] || '').trim(), group: String(r[3] || '').trim() || String(r[0]).trim() };
  });
}

async function readRates() {
  var vals = await readSheetValues('Rates');
  var rows = vals ? vals.slice(1) : SEED_RATES;
  var rates = {};
  rows.forEach(function (r) {
    var g = String(r[0]).trim(), t = String(r[1]).trim();
    if (!g || !t) return;
    t = /bar/i.test(t) ? 'Bariatric' : /spec/i.test(t) ? 'Specialty' : 'Regular';
    (rates[g] = rates[g] || {})[t] = { base: r[2], perMile: r[3], wait: r[4], o2: r[5], offHours: r[6],
      noShow: r[7], freeMiles: r[8], extra: r[9] };
  });
  return rates;
}

/* ---------------- Google Calendar ---------------- */

async function fetchEvents(calendarId, start, end) {
  var out = [], pageToken = '';
  do {
    var q = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true',
      orderBy: 'startTime', maxResults: '2500' });
    if (pageToken) q.set('pageToken', pageToken);
    var res = await fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) +
      '/events?' + q, { headers: { Authorization: 'Bearer ' + state.token } });
    if (res.status === 401) throw new Error('Google sign-in expired. Click "Sign in with Google" again.');
    if (!res.ok) throw new Error('Calendar error ' + res.status + ': ' + (await res.text()).slice(0, 200));
    var data = await res.json();
    out = out.concat((data.items || []).filter(function (e) { return e.status !== 'cancelled'; }));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

/* ---------------- Miles: Google Routes API, cached on the Mileage sheet ---------------- */

async function loadMileageCache() {
  var vals = (await readSheetValues('Mileage')) || [];
  var cache = {};
  vals.slice(1).forEach(function (r) { if (r[0] && r[1] && r[2] !== '') cache[r[0] + '\u0001' + r[1]] = Number(r[2]); });
  return cache;
}

async function drivingMiles(from, to, key) {
  var res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters' },
    body: JSON.stringify({ origin: { address: from }, destination: { address: to }, travelMode: 'DRIVE', units: 'IMPERIAL' })
  });
  if (!res.ok) { console.warn('Routes API', res.status, await res.text()); return null; }
  var data = await res.json();
  if (!data.routes || !data.routes.length) return null;
  return Math.round(data.routes[0].distanceMeters / 1609.344 * 100) / 100;
}

/* ---------------- Main pull ---------------- */

function dateRange() {
  var now = new Date(), v = $('range').value;
  if (v === 'last') return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)];
  if (v === 'custom') {
    if (!$('from').value || !$('to').value) throw new Error('Pick both dates.');
    var f = $('from').value.split('-'), t = $('to').value.split('-');
    return [new Date(+f[0], f[1] - 1, +f[2]), new Date(+t[0], t[1] - 1, +t[2] + 1)];
  }
  return [new Date(now.getFullYear(), now.getMonth(), 1), now];
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function pullTrips() {
  if (!state.token || Date.now() > state.tokenExpires) throw new Error('Please sign in with Google first.');
  var settings = await readSettings();
  if (!settings.mapsKey) throw new Error('Add the Google Maps API key on the Settings sheet.');
  var facilities = await readFacilities();
  var rates = await readRates();
  var range = dateRange();

  say('Reading Google Calendar…');
  var events = await fetchEvents(settings.calendarId, range[0], range[1]);

  // 1. Parse every event
  var trips = [], skipped = 0;
  events.forEach(function (ev) {
    var t = parseTripEvent(ev.summary || '', ev.description || '');
    var hasRoute = (t.pickup.address || t.pickup.name) && (t.destination.address || t.destination.name);
    if (!hasRoute && !t.noShow) { skipped++; return; }
    var st = new Date(ev.start.dateTime || ev.start.date + 'T00:00:00');
    if (t.pickupMinutes == null && ev.start.dateTime) t.pickupMinutes = st.getHours() * 60 + st.getMinutes();
    trips.push({ ev: ev, trip: t, start: st });
  });

  // 2. Miles for every facility leg (private pay doesn't need miles)
  var cache = await loadMileageCache(), fresh = [];
  var pairs = {};
  trips.forEach(function (x) {
    if (x.trip.noShow) return;
    var a = x.trip.pickup.address || x.trip.pickup.name, b = x.trip.destination.address || x.trip.destination.name;
    if (!a || !b) return;
    pairs[a + '\u0001' + b] = [a, b];
    if (x.trip.roundTrip) pairs[b + '\u0001' + a] = [b, a];
    // Multi-stop: every segment
    var stops = [x.trip.destination].concat(x.trip.extraStops || []);
    for (var k = 0; k + 1 < stops.length; k++) {
      var c = stops[k].address || stops[k].name, d = stops[k + 1].address || stops[k + 1].name;
      if (c && d) pairs[c + '\u0001' + d] = [c, d];
    }
    var last = stops[stops.length - 1], lastA = last.address || last.name;
    if (x.trip.roundTrip && lastA) pairs[lastA + '\u0001' + a] = [lastA, a];
  });
  var todo = Object.keys(pairs).filter(function (k) { return !(k in cache); });
  for (var i = 0; i < todo.length; i++) {
    say('Measuring miles ' + (i + 1) + ' of ' + todo.length + '…');
    var p = pairs[todo[i]];
    var mi = await drivingMiles(p[0], p[1], settings.mapsKey);
    cache[todo[i]] = mi;
    if (mi != null) fresh.push([p[0], p[1], mi]);
  }
  var milesFn = function (a, b) { var v = cache[a + '\u0001' + b]; return v == null ? null : v; };

  // 3. Build sheet rows
  var bySheet = {}, legCount = 0, review = 0;
  trips.forEach(function (x) {
    var d = x.start;
    var period = MONTHS[d.getMonth()] + '-' + String(d.getFullYear()).slice(2);
    var date = pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear();
    buildLegs(x.trip, facilities, rates, settings, milesFn).forEach(function (L, idx) {
      legCount++;
      var tripId = x.ev.id + '#' + idx;
      var notes = [];
      if (L.review) { notes.push('CHECK: ' + L.review); review++; }
      var row;
      if (L.privatePay) {
        if (L.riders) notes.push(L.riders + ' extra riders');
        if (x.trip.roundTrip) notes.unshift('Pickup and Return');
        // Same layout as Jad's private-pay rows: source in Facility Name, N/A rates, Self Pay
        var pa = addr(x.trip.pickup), pb = addr(x.trip.destination);
        var pm = milesFn(pa, pb);
        var tag = x.trip.titleTag.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        row = [L.patient, tag, period, date, '', x.trip.chair === 'Standard' ? 'Wheelchair' : x.trip.chair + ' Wheelchair',
          pa, pb, pm == null ? '' : roundMiles_(pm, settings.mileRounding), 'N/A', 'N/A', '', '', '', '',
          L.total, 'Self Pay', L.paymentStatus || '', notes.join('; '), '', '', tripId];
        (bySheet[sheetName(tag)] = bySheet[sheetName(tag)] || []).push(row);
        return;
      }
      if (L.info) notes.unshift(L.info);
      if (L.leg !== 'One way') notes.unshift(L.leg);
      var from = L.fromLoc || x.trip.pickup;
      var to = L.toLoc || x.trip.destination;
      row = [L.patient, L.facility, period, date, '', L.chair + ' Wheelchair', addr(from), addr(to),
        L.miles == null ? '' : L.miles, L.baseRate, L.perMile, blank0(L.waitFee), blank0(L.o2Fee), blank0(L.offHoursFee),
        blank0(money(L.extraFee + L.noShowFee)), L.total, L.facility, settings.newStatus, notes.join('; '), '', '', tripId];
      (bySheet[sheetName(L.facility)] = bySheet[sheetName(L.facility)] || []).push(row);
    });
  });

  // 4. Write: one sheet per facility, only trips not already there
  say('Writing to Excel…');
  var added = 0, already = 0, sheetsTouched = [];
  await Excel.run(async function (ctx) {
    for (var name in bySheet) {
      var ws = ctx.workbook.worksheets.getItemOrNullObject(name);
      await ctx.sync();
      if (ws.isNullObject) {
        ws = ctx.workbook.worksheets.add(name);
        ws.getRangeByIndexes(0, 0, 1, COLUMNS.length).values = [COLUMNS];
        styleHeader(ws.getRangeByIndexes(0, 0, 1, COLUMNS.length));
        ws.freezePanes.freezeRows(1);
        ws.getRangeByIndexes(0, COLUMNS.length - 1, 1, 1).getEntireColumn().columnHidden = true;
      }
      var used = ws.getUsedRange(true);
      used.load('rowCount,values');
      await ctx.sync();
      var idCol = used.values[0].indexOf('Trip ID');
      if (idCol < 0) {   // one of Jad's existing sheets: add the hidden Trip ID column so re-runs don't duplicate
        idCol = COLUMNS.length - 1;
        ws.getRangeByIndexes(0, idCol, 1, 1).values = [['Trip ID']];
        ws.getRangeByIndexes(0, idCol, 1, 1).getEntireColumn().columnHidden = true;
      }
      var have = {};
      if (idCol >= 0) used.values.forEach(function (r) { if (r[idCol]) have[r[idCol]] = 1; });
      var rows = bySheet[name].filter(function (r) { var dup = have[r[r.length - 1]]; if (dup) already++; return !dup; });
      if (!rows.length) continue;
      var target = ws.getRangeByIndexes(used.rowCount, 0, rows.length, COLUMNS.length);
      target.values = rows;
      MONEY_COLS.forEach(function (c) { ws.getRangeByIndexes(used.rowCount, c, rows.length, 1).numberFormat = rows.map(function () { return ['$#,##0.00']; }); });
      rows.forEach(function (r, i) {
        if (/CHECK:/.test(r[18])) ws.getRangeByIndexes(used.rowCount + i, 0, 1, COLUMNS.length).format.fill.color = '#FFF4CC';
      });
      added += rows.length;
      sheetsTouched.push(name + ' (' + rows.length + ')');
    }
    if (fresh.length) {
      var mws = ctx.workbook.worksheets.getItemOrNullObject('Mileage');
      await ctx.sync();
      if (!mws.isNullObject) {
        var mu = mws.getUsedRange(true); mu.load('rowCount'); await ctx.sync();
        mws.getRangeByIndexes(mu.rowCount, 0, fresh.length, 3).values = fresh;
      }
    }
    await ctx.sync();
  });

  say(events.length + ' calendar events read, ' + skipped + ' skipped (not trips).\n' +
    added + ' new rows added' + (already ? ', ' + already + ' already in the sheets and left alone' : '') + '.\n' +
    (review ? review + ' rows highlighted yellow need a look (see Notes).\n' : '') +
    (sheetsTouched.length ? '\nSheets: ' + sheetsTouched.join(', ') : ''), review ? 'warn' : 'ok');
}

function addr(loc) { return loc.address || loc.name || ''; }
/** Jad's sheets leave a fee box empty rather than $0. */
function blank0(x) { return Number(x) ? x : ''; }
function money(x) { return Math.round((Number(x) || 0) * 100) / 100; }
/** Excel sheet names: max 31 characters, none of : \ / ? * [ ] */
function sheetName(s) { return String(s).replace(/[:\\\/\?\*\[\]]/g, '-').slice(0, 31).trim(); }
