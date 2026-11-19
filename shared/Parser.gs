/**
 * Delta Wheelchair Services - trip billing
 * Parser.gs: reads one Google Calendar event (title + description) into trip fields.
 * Pure functions only, so they can be tested outside Google.
 */

// Lines in an event that are never the patient's name
var NOT_A_NAME_ = /^\W*(today|tomorrow|tonight|asap|(mon|tues|wednes|thurs|fri|satur|sun)day|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(\s+\d{1,2}(st|nd|rd|th)?)?|\d{1,2}(st|nd|rd|th)?|drop\s*-?\s*off\s*only|one\s*way|pick\s*-?\s*up\s*(and|&)\s*return.*|(one|two|three|\d+)\s*riders?.*|.*\bride with us\b.*|google|referral|private pay|no\s*o2|o2.*|\d+\s*lbs?|.*wheel\s*chair.*|.*\bfees?\b.*|then\s+discharg.*|appointment then discharge|appointment\s*\/\s*discharge|.*\bno\s*show\b.*)\W*$/i;

var CITY_LINE_ = /,\s*(TX|Texas)\b|\b(TX|Texas)\s+\d{5}\b/i;

/** True for "8:30AM", "9 am", "17:45". */
function isJustTime_(s) {
  return /^\s*\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?\s*m\.?)?\s*$/i.test(String(s || '')) && parseTimeToMinutes_(s) != null;
}

/** Strip the Markdown-ish emphasis dispatchers use (**text**, *text*) and normalise spaces. */
function cleanText_(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')        // calendar descriptions can contain HTML
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ');
}

/** "8AM", "8:30 pm", "17:45", "8.30am" -> minutes after midnight, or null. */
function parseTimeToMinutes_(s) {
  if (!s) return null;
  var m = String(s).trim().match(/(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m?\.?/i);
  if (m) {
    var h = parseInt(m[1], 10) % 12;
    if (m[3].toLowerCase() === 'p') h += 12;
    return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  }
  m = String(s).trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return null;
}

/**
 * Reads a "Pickup:" or "Destination:" block. The first line is "Name:Address" or just
 * "Address". Following lines up to the next blank line are room / suite details.
 */
function parseLocationBlock_(lines, label) {
  var re = new RegExp('^\\s*' + label + '\\s*:\\s*(.*)$', 'i');
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(re);
    if (!m) continue;
    var first = m[1].trim();
    if (isJustTime_(first)) continue;   // "Pickup: 8:30AM" is the pickup time, not the place
    first = first.replace(/\s*:\s*$/, '');
    var name = '', address = first;
    // "Facility Name:123 Street, City, TX 77000" -> split on the colon before the street number
    var split = first.match(/^(.*?[A-Za-z].*?)\s*:\s*(\d.*)$/);
    if (split) { name = split[1].trim(); address = split[2].trim(); }
    else if (!/^\d/.test(first) && !CITY_LINE_.test(first)) { name = first; address = ''; }
    var details = [];
    for (var j = i + 1; j < lines.length; j++) {
      var l = lines[j].trim();
      if (!l || /^\s*(pick\s*-?\s*up|destination|pick ?up time|appointment|appt|return)\s*:/i.test(l) || /^\*/.test(l) || /^\s*\+?\s*\w*\s*destination\b.*:/i.test(l)) break;
      // An address on its own line right after a name-only first line
      if (!address && (/^\d/.test(l) || CITY_LINE_.test(l))) { address = l; continue; }
      // "Houston, Texas 77054" on the line under the street
      if (address && !/\b\d{5}(-\d{4})?\s*(,?\s*USA)?\s*$/i.test(address) && CITY_LINE_.test(l)) { address += ', ' + l; continue; }
      details.push(l);
    }
    // "Health Rehabilitation Hospital Chasewood:20180 Chasewood Park Dr" on a later line -> keep only the street part
    var tail = address.match(/^([^\d:][^:]*?)\s*:\s*(\d.*)$/);
    if (tail) { address = tail[2].trim(); if (!name) name = tail[1].trim(); }
    return { name: name, address: address, details: details.join(', ') };
  }
  return { name: '', address: '', details: '' };
}

/**
 * Parse one event.
 * @param {string} title  event title
 * @param {string} description  event description
 * @return {Object} trip fields plus `warnings` (things a person should check)
 */
function parseTripEvent(title, description) {
  var text = cleanText_(description);
  var titleText = cleanText_(title).trim();
  var all = titleText + '\n' + text;
  var lines = text.split('\n');
  var warnings = [];

  // Title tag: "(Encompass Humble) Patient Name Pick up & Return".
  // (Referral), (Google), (Private) mean private pay: recorded for history, not invoiced.
  var tag = '';
  var tm = titleText.match(/^\s*\(([^)]+)\)/) || titleText.match(/^\s*(google|referral|private pay)\b/i);
  if (tm) tag = tm[1].trim();
  var privatePay = /referral|google|private|self[\s-]?pay|cash/i.test(tag);

  // Private-pay amount, if written as "$123" or "Total: 123"
  var amt = all.match(/\$\s*(\d{1,5}(?:\.\d{1,2})?)/) || all.match(/\b(?:total|amount|price|charged?)\s*:?\s*(\d{1,5}(?:\.\d{1,2})?)\b/i);
  var amount = amt ? parseFloat(amt[1]) : null;
  // "$156-Not Paid" -> payment status "Not Paid"
  var ps = all.match(/\$\s*\d[\d.,]*\s*[-–:]?\s*((?:not\s+)?paid|unpaid|pending)\b/i);
  var paymentStatus = ps ? ps[1].toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : '';
  // Extra riders: "*2 People will Ride with us*"
  var rid = all.match(/(\d+)\s*(?:people|persons?|riders?|family)[^\n]*ride/i);
  var riders = rid ? parseInt(rid[1], 10) : 0;

  // Trip type
  var tripType = '';
  var isAppt = /\bappt\b|\bap{1,2}oi?nt?m[a-z]*\b/i.test(all);
  if (/discharg/i.test(all) && isAppt) tripType = 'Appointment + Discharge';
  else if (/discharg/i.test(all)) tripType = 'Discharge';
  else if (/admi(t|ssion)/i.test(all)) tripType = 'Admission';
  else if (isAppt) tripType = 'Appointment';
  else if (!privatePay && !/\bno[\s\-]?show\b/i.test(all)) warnings.push('Trip type not found (Discharge / Admission / Appointment)');

  // Patient name: title without the trip type word, else the first plain line of the description
  var patient = titleText.replace(/^\s*\([^)]*\)\s*/, '').replace(/^\s*(google|referral|private pay)\b[:\-\s]*/i, '')
    .replace(/\bpick\s*-?\s*up\s*(and|&)\s*return\b/ig, '').replace(/\b(discharge|admission|admit|appointment|appt|no[\s\-]?show)\b[:\-\s]*/ig, '').trim();
  if (!patient) {
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l || /:/.test(l) || NOT_A_NAME_.test(l) || /^\*/.test(l) || /^[\d\s\-()+\/$]+$/.test(l) || /\b(discharge|admission|appointment|appt)\b/i.test(l) || /^\W*$/.test(l)) continue;
      patient = l; break;
    }
  }
  if (!patient) warnings.push('Patient name not found');

  var pickup = parseLocationBlock_(lines, 'pick\\s*-?\\s*up');
  var destination = parseLocationBlock_(lines, 'destination');
  var roundTrip = /pick\s*-?\s*up\s*(and|&)\s*return/i.test(all) || /round\s*trip/i.test(all);

  // "Then Discharge 2002 Holcombe Blvd, Houston, TX": after the appointment the patient goes
  // to this address instead of back to the pickup.
  var thenDischarge = null;
  var td = text.match(/^\s*then\s+discharg\w*\s*(?:to\s*)?:?\s*(.*)$/im) ||
    text.match(/^\s*discharg\w*\s*(?:add?ress|to|location)\s*:\s*(.*)$/im);
  if (td) {
    var tdLines = [td[1]].concat(text.slice(td.index + td[0].length).split('\n').slice(1));
    var tdText = [];
    for (var q = 0; q < tdLines.length; q++) { var tl = tdLines[q].trim(); if (!tl && tdText.length) break; if (tl) tdText.push(tl); if (tdText.length >= 3) break; }
    thenDischarge = parseLocationBlock_(['Destination: ' + (tdText[0] || '')].concat(tdText.slice(1)), 'destination');
  }

  // Extra stops: "+2nd Destination:", "3rd Destination:", "Destination 2:"
  // A "Then Discharge" address counts as the next stop (and there is no return to the pickup).
  var extraStops = [];
  if (thenDischarge && (thenDischarge.address || thenDischarge.name)) { extraStops.push(thenDischarge); roundTrip = false; }
  [['2', 'nd'], ['3', 'rd'], ['4', 'th'], ['5', 'th']].forEach(function (n) {
    var stop = parseLocationBlock_(lines, '\\+?\\s*(?:' + n[0] + '\\s*' + n[1] + '|second|third|fourth|fifth)\\s*destination');
    if (!stop.address && !stop.name) stop = parseLocationBlock_(lines, '\\+?\\s*destination\\s*#?\\s*' + n[0]);
    if (stop.address || stop.name) extraStops.push(stop);
  });
  if (!pickup.address && !pickup.name) warnings.push('Pickup not found');
  if (!destination.address && !destination.name) warnings.push('Destination not found');

  var pt = all.match(/pick\s*-?\s*up\s*time\s*:?\s*([^\n]+)/i);
  if (!pt) pt = all.match(/(?:^|\n)\s*time\s*:\s*([^\n]+)/i);   // "Time: 12:30 PM"
  if (!pt) {   // "Pickup: 8:30AM"
    lines.forEach(function (l) {
      var m = !pt && l.match(/^\s*pick\s*-?\s*up\s*:\s*(.+)$/i);
      if (m && isJustTime_(m[1])) pt = m;
    });
  }
  var rt = all.match(/return\s*(?:time)?\s*:\s*([^\n]+)/i);
  var returnMinutes = rt ? parseTimeToMinutes_(rt[1]) : null;
  var at = all.match(/(?:appointment|appt)\s*(?:time\s*:?|:)\s*([^\n]+)/i);
  var pickupMinutes = pt ? parseTimeToMinutes_(pt[1]) : null;
  var apptMinutes = at ? parseTimeToMinutes_(at[1]) : null;


  var w = all.match(/(\d{2,3}(?:\.\d+)?)\s*(?:lbs?|pounds)\b/i);
  var weight = w ? parseFloat(w[1]) : null;

  // Oxygen: "No o2", "o2/2L", "O2 2 L", "oxygen 3l"
  var o2Flow = null, o2 = false;
  if (!/\bno\s*-?\s*([o0]2|oxygen)\b/i.test(all)) {
    var o = all.match(/\b(?:[o0]2|oxygen)\b\s*[\/@:\-]?\s*(?:at\s*)?(\d+(?:\.\d+)?)\s*(?:l|lpm|liters?)\b/i);
    if (o) { o2 = true; o2Flow = parseFloat(o[1]); }
    else if (/\b(o2|oxygen)\b/i.test(all)) { o2 = true; }   // "02" alone is too ambiguous to count
  }

  // Chair
  var chair = 'Standard', chairReason = '';
  if (/bar+i?atric/i.test(all)) { chair = 'Bariatric'; chairReason = 'Bariatric wheelchair'; }
  else if (/special(i)?ty/i.test(all)) { chair = 'Specialty'; chairReason = 'Specialty wheelchair'; }

  // Dispatcher overrides: "ADD WAIT FEE", "ADD OFF HOURS FEE"
  // "Wait fee x3" / "Wait fee ×3" = three times the contract wait fee (implies the wait fee applies)
  var wm = all.match(/wait(?:ing)?\s*(?:time\s*)?fee\s*[x×*]\s*(\d+)/i) || all.match(/(\d+)\s*[x×*]\s*wait(?:ing)?\s*(?:time\s*)?fee/i);
  var waitMultiplier = wm ? parseInt(wm[1], 10) : 1;
  var addWait = !!wm || /\badd\s*(?:a\s*)?wait(?:ing)?\s*(?:time\s*)?fee\b/i.test(all);
  var addOffHours = /\badd\s*(?:an?\s*)?off[\s-]*hours?\s*fee\b/i.test(all);

  var noShow = /\bno[\s\-]?show\b/i.test(all);

  return {
    tripType: tripType,
    patient: patient,
    pickup: pickup,
    destination: destination,
    extraStops: extraStops,
    thenDischarge: thenDischarge,
    pickupMinutes: pickupMinutes,
    apptMinutes: apptMinutes,
    returnMinutes: returnMinutes,
    roundTrip: roundTrip,
    weight: weight,
    o2: o2,
    o2Flow: o2Flow,
    chair: chair,
    chairReason: chairReason,
    noShow: noShow,
    addWait: addWait,
    waitMultiplier: waitMultiplier,
    addOffHours: addOffHours,
    titleTag: tag,
    privatePay: privatePay,
    amount: amount,
    paymentStatus: paymentStatus,
    riders: riders,
    warnings: warnings
  };
}
