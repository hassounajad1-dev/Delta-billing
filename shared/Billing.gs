/**
 * Billing.gs: decides which facility pays and what each leg costs.
 * Pure functions only. Rates come from the "Rates" tab, facility names from the
 * "Facilities" tab, rules from the "Settings" tab.
 *
 * facilities: [{ name, aliases: [..], address, group }]
 * rates: { groupName: { Regular: {...}, Specialty: {...}, Bariatric: {...} } }
 *   each tier: { base, perMile, wait, o2, offHours, noShow, freeMiles, extra }
 */

var STOPWORDS_ = { the: 1, of: 1, and: 1, at: 1, a: 1, health: 1, hospital: 1, rehabilitation: 1, rehab: 1 };

function norm_(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens_(s) {
  return norm_(s).split(' ').filter(function (t) { return t && !STOPWORDS_[t]; });
}

/** "19002 McKay Dr, Humble, TX" -> "19002 mckay" (street number + first street word). */
function streetKey_(address) {
  var m = norm_(address).match(/^(\d+) ([a-z0-9]+)/);
  return m ? m[1] + ' ' + m[2] : '';
}

/**
 * Find the contracted facility at one end of a trip, or null.
 * A facility matches when every word of its name (or one of its "also written as" names)
 * appears in the location name. Longer names are tried first, so "PAM Clearlake South"
 * wins over "PAM Clearlake". A street-address match on the Facilities tab also counts.
 */
function matchFacility(location, facilities) {
  var text = location.name || location.address;
  var have = {};
  tokens_(text).forEach(function (t) { have[t] = 1; });

  var candidates = [];
  facilities.forEach(function (f) {
    [f.name].concat(f.aliases || []).forEach(function (n) {
      var tk = tokens_(n);
      if (tk.length) candidates.push({ f: f, tk: tk });
    });
  });
  candidates.sort(function (a, b) { return b.tk.length - a.tk.length; });
  for (var i = 0; i < candidates.length; i++) {
    var ok = candidates[i].tk.every(function (t) { return have[t]; });
    if (ok) return candidates[i].f;
  }
  var key = streetKey_(location.address);
  if (key) {
    for (var j = 0; j < facilities.length; j++) {
      if (facilities[j].address && streetKey_(facilities[j].address) === key) return facilities[j];
    }
  }
  return null;
}

/**
 * Who pays (Jad's rules):
 *  Discharge   -> facility at pickup
 *  Admission   -> facility at destination
 *  Appointment -> facility at pickup; if pickup is a home, the contracted facility at destination
 */
function payingFacility(trip, facilities) {
  // The facility written in the title, e.g. "(Encompass Humble) ...", wins when it matches.
  if (trip.titleTag && !trip.privatePay) {
    var byTag = matchFacility({ name: trip.titleTag, address: '' }, facilities);
    if (byTag) return byTag;
  }
  var atPickup = matchFacility(trip.pickup, facilities);
  var atDest = matchFacility(trip.destination, facilities);
  if (trip.tripType === 'Discharge' || trip.tripType === 'Appointment + Discharge') return atPickup;
  if (trip.tripType === 'Admission') return atDest;
  return atPickup || atDest;
}

function roundMiles_(miles, rule) {
  if (miles == null) return null;
  if (rule === 'up') return Math.ceil(miles - 1e-9);
  if (rule === 'whole') return Math.round(miles);
  return Math.round(miles * 10) / 10;
}

function isOffHours_(minutes, settings) {
  if (minutes == null) return false;
  if (settings.offHoursAfter != null && minutes >= settings.offHoursAfter) return true;
  if (settings.offHoursBefore != null && minutes < settings.offHoursBefore) return true;
  return false;
}

function minutesToText_(m) {
  if (m == null) return '';
  var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ap;
}

function num_(x) { var n = Number(x); return isNaN(n) || x === '' || x == null ? 0 : n; }
function money_(x) { return Math.round((x || 0) * 100) / 100; }

/**
 * Pick the chair tier for a trip at a given rate group.
 * Bariatric is used when the event says Bariatric or the patient is over the weight limit.
 * If the contract has no Bariatric row, it is billed at the Specialty rate.
 */
function chooseTier_(trip, groupRates, settings, notes) {
  var wanted = 'Regular', reason = '';
  if (trip.chair === 'Bariatric') { wanted = 'Bariatric'; reason = 'Written as bariatric'; }
  else if (trip.chair === 'Specialty') { wanted = 'Specialty'; reason = 'Written as specialty'; }
  if (trip.weight != null && trip.weight > settings.bariatricLbs && wanted !== 'Bariatric') {
    wanted = settings.overweightTier === 'Specialty' ? (wanted === 'Regular' ? 'Specialty' : wanted) : 'Bariatric';
    reason = 'Over ' + settings.bariatricLbs + ' lbs';
  }
  if (!groupRates) return { tier: wanted, rate: null, reason: reason };
  var tier = wanted;
  if (tier === 'Bariatric' && !groupRates.Bariatric) tier = 'Specialty';
  if (tier === 'Specialty' && !groupRates.Specialty) {
    notes.push('Contract has no specialty rate, billed as regular');
    tier = 'Regular';
  }
  return { tier: tier, rate: groupRates[tier] || null, reason: reason };
}

/**
 * Turn a parsed trip into billable rows (one per one-way leg, or one no-show row).
 * @param {Object} trip  from parseTripEvent
 * @param {Array} facilities  rows from the Facilities tab
 * @param {Object} rates  from the Rates tab
 * @param {Object} settings  from the Settings tab
 * @param {function(string,string):number|null} milesFn  driving miles between two addresses
 */
function buildLegs(trip, facilities, rates, settings, milesFn) {
  var notes = trip.warnings.slice();
  if (trip.privatePay) {
    // Private pay: history only. Patient, addresses and the total; every charge box left empty.
    // Card numbers are never copied out of the event.
    if (trip.amount == null) notes.push('Private pay: no $ amount found in the event');
    return [{
      facility: 'Private pay (' + trip.titleTag + ')', group: '', patient: trip.patient, tripType: trip.tripType,
      chair: '', chairReason: '', weight: null, o2: '', leg: trip.roundTrip ? 'Pickup and Return' : 'One way',
      time: minutesToText_(trip.pickupMinutes), from: locText_(trip.pickup), to: locText_(trip.destination),
      miles: null, offHours: '', baseRate: '', perMile: '', freeMiles: '', mileageCharge: '', offHoursFee: '',
      o2Fee: '', waitFee: '', extraFee: '', noShowFee: '', total: trip.amount == null ? '' : trip.amount,
      privatePay: true, paymentStatus: trip.paymentStatus, riders: trip.riders, review: notes.join('; ')
    }];
  }
  var facility = payingFacility(trip, facilities);
  var groupRates = facility ? rates[facility.group] : null;
  if (!facility) notes.push('No contracted facility matched. Add the name on the Facilities tab, or bill privately');
  else if (!groupRates) notes.push('Rate group "' + facility.group + '" not found on the Rates tab');

  var pick = chooseTier_(trip, groupRates, settings, notes);
  var r = pick.rate || {};
  if (groupRates && !pick.rate) notes.push('No ' + pick.tier + ' rate in contract');

  var base = {
    facility: facility ? facility.name : '(no contract match)',
    group: facility ? facility.group : '',
    patient: trip.patient,
    tripType: trip.tripType,
    chair: pick.tier,
    chairReason: pick.reason,
    weight: trip.weight,
    o2: trip.o2 ? (trip.o2Flow != null ? 'O2 ' + trip.o2Flow + 'L' : 'O2') : 'No'
  };

  if (trip.noShow) {
    var fee = num_(r.noShow);
    if (!fee) notes.push('Contract has no no-show fee');
    return [Object.assign({}, base, {
      leg: 'No show', time: minutesToText_(trip.pickupMinutes),
      from: locText_(trip.pickup), to: locText_(trip.destination), miles: null, offHours: 'No',
      baseRate: 0, perMile: 0, freeMiles: 0, mileageCharge: 0, offHoursFee: 0, o2Fee: 0, waitFee: 0,
      extraFee: 0, noShowFee: fee, total: money_(fee), review: notes.join('; ')
    })];
  }

  var legs = [{ leg: trip.roundTrip ? 'Leg 1 (out)' : 'One way', from: trip.pickup, to: trip.destination, minutes: trip.pickupMinutes }];
  var stopWaits = 0;
  if (trip.extraStops && trip.extraStops.length) {
    // Multi-stop: pickup -> destination (wait) -> 2nd destination (wait) -> ... -> final stop,
    // then back to the pickup if it says Pickup and Return. Every drive is its own row with its
    // own base rate; one wait fee per stop where we waited, split evenly across the rows.
    var stops = [trip.pickup, trip.destination].concat(trip.extraStops);
    legs = [];
    for (var k = 0; k + 1 < stops.length; k++) {
      legs.push({ leg: 'Stop ' + (k + 1) + ' of ' + (stops.length - 1), from: stops[k], to: stops[k + 1],
        minutes: k === 0 ? trip.pickupMinutes : null });
    }
    if (trip.roundTrip) legs.push({ leg: 'Return', from: stops[stops.length - 1], to: trip.pickup,
      minutes: trip.returnMinutes, guessed: false });
    stopWaits = stops.length - 2;
  } else if (trip.roundTrip) {
    // The return time is not in the event; the appointment time is used for the off-hours check.
    legs.push({ leg: 'Leg 2 (return)', from: trip.destination, to: trip.pickup,
      minutes: trip.returnMinutes != null ? trip.returnMinutes : trip.apptMinutes, guessed: trip.returnMinutes == null });
  }

  return legs.map(function (L, idx) {
    var legNotes = notes.slice();
    var fromAddr = L.from.address || L.from.name;
    var toAddr = L.to.address || L.to.name;
    var rawMiles = (fromAddr && toAddr) ? milesFn(fromAddr, toAddr) : null;
    if (rawMiles == null) legNotes.push('Miles not found, check the addresses');
    var miles = roundMiles_(rawMiles, settings.mileRounding);

    var addOnsApply = idx === 0 || settings.addOnsEachLeg;
    var offHours = isOffHours_(L.minutes, settings) || (trip.addOffHours && idx === 0);
    var offFee = offHours && addOnsApply ? num_(r.offHours) : 0;
    var o2Fee = trip.o2 && addOnsApply ? num_(r.o2) : 0;
    // Wait fee (when the contract has one):
    //  - Pickup and Return appointment: split evenly across the two legs ($40 -> $20 + $20)
    //  - One-way trip: only when the event says "ADD WAIT FEE", then the full fee
    //  - "Wait fee x3" multiplies the contract wait fee (then split the same way)
    var waitTotal = num_(r.wait) * (trip.waitMultiplier || 1);
    var waitFee = 0;
    if (stopWaits) waitFee = money_(waitTotal * stopWaits / legs.length);
    else if ((trip.roundTrip || legs.length === 2) && (trip.tripType === 'Appointment' || trip.addWait)) waitFee = money_(waitTotal / legs.length);
    else if (!trip.roundTrip && trip.addWait) waitFee = waitTotal;
    if (trip.addWait && !num_(r.wait) && idx === 0) legNotes.push('ADD WAIT FEE written, but this contract has no wait fee');
    if (trip.addOffHours && !num_(r.offHours) && idx === 0) legNotes.push('ADD OFF HOURS FEE written, but this contract has no off-hours fee');
    // Flat surcharge some contracts add for bariatric ("add $50 to the total"), once per trip
    var extra = idx === 0 ? num_(r.extra) : 0;
    // Only worth a look when the guessed return time is late enough that off-hours might apply
    if (L.guessed && L.minutes != null && settings.offHoursAfter != null && L.minutes >= settings.offHoursAfter - 120)
      legNotes.push('No return time in event, off-hours based on appointment time');
    if (trip.o2 && trip.o2Flow == null) legNotes.push('Oxygen mentioned but no flow rate');

    var free = num_(r.freeMiles);
    var billMiles = miles == null ? 0 : Math.max(0, miles - free);
    var mileageCharge = money_(billMiles * num_(r.perMile));
    var total = money_(num_(r.base) + mileageCharge + offFee + o2Fee + waitFee + extra);

    return Object.assign({}, base, {
      leg: L.leg,
      time: minutesToText_(L.minutes),
      from: locText_(L.from),
      to: locText_(L.to),
      fromLoc: L.from,
      toLoc: L.to,
      miles: miles,
      offHours: offHours ? 'Yes' : 'No',
      baseRate: num_(r.base),
      perMile: num_(r.perMile),
      freeMiles: free,
      mileageCharge: mileageCharge,
      offHoursFee: offFee,
      o2Fee: o2Fee,
      waitFee: waitFee,
      extraFee: extra,
      noShowFee: 0,
      total: total,
      review: legNotes.join('; ')
    });
  });
}

function locText_(loc) {
  return [loc.name, loc.address, loc.details].filter(String).join(' | ');
}
