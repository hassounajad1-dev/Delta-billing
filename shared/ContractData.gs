/**
 * Setup.gs: creates the Settings, Rates and Facilities tabs with Delta's contract data.
 * Run "Delta Billing > First-time setup" once. It will not overwrite tabs that already exist.
 */

var RATE_HEADERS = ['Rate group', 'Chair', 'Base rate', 'Per mile', 'Wait fee', 'O2 fee',
  'Off-hours fee', 'No-show fee', 'Free miles per trip', 'Extra flat charge', 'Notes'];

// Rate group, Chair, Base, Per mile, Wait, O2, Off-hours, No-show, Free miles, Extra, Notes
// Blank = not in contract (N/A).
var SEED_RATES = [
  ['PAM Heights/Clearlake/Humble/Sugarland/Katy', 'Regular', 35, 3.5, '', '', '', '', '', '', ''],
  ['PAM Heights/Clearlake/Humble/Sugarland/Katy', 'Specialty', 125, 3.5, '', '', '', '', '', '', ''],
  ['PAM Beaumont/Victoria/Coleman', 'Regular', 45, 4.5, 25, 40, '', '', '', '', ''],
  ['PAM Beaumont/Victoria/Coleman', 'Specialty', 150, 5, 25, 40, '', '', '', '', ''],
  ['UTMB', 'Regular', 35, 3.5, 30, 20, 25, '', '', '', ''],
  ['UTMB', 'Specialty', 125, 4.5, 40, 20, 25, '', '', '', ''],
  ['Encompass Woodlands/Vision Park/Sugarland/Katy', 'Regular', 35, 3.5, 30, 20, 25, '', '', '', ''],
  ['Encompass Woodlands/Vision Park/Sugarland/Katy', 'Specialty', 125, 4.5, 40, 20, 25, '', '', '', ''],
  ['Encompass Vintage', 'Regular', 35, 3.5, 30, 20, 25, 50, '', '', 'Same as Woodlands group, plus no-show fee'],
  ['Encompass Vintage', 'Specialty', 125, 4.5, 40, 20, 25, 50, '', '', ''],
  ['Encompass Humble/Medical Center/Plano', 'Regular', 35, 3.5, 30, 20, 25, 30, '', '', ''],
  ['Encompass Humble/Medical Center/Plano', 'Specialty', 125, 4.5, 40, 20, 25, 30, '', '', ''],
  ['Encompass Humble/Medical Center/Plano', 'Bariatric', 200, 4.5, 40, 20, 25, 30, '', '', ''],
  ['Rollingbrook Rehab', 'Regular', 32.5, 3.25, 30, 20, 25, '', '', '', ''],
  ['Rollingbrook Rehab', 'Specialty', 122.5, 3.25, 40, 20, 25, '', '', '', ''],
  ['Voyages of Sugarland', 'Regular', 35, 4.5, '', '', '', '', '', '', ''],
  ['Voyages of Sugarland', 'Specialty', 125, 4.5, '', '', '', '', '', '', ''],
  ['Voyages of Conroe', 'Regular', 35, 3.5, '', '', '', '', '', '', ''],
  ['Voyages of Conroe', 'Specialty', 125, 3.5, '', '', '', '', '', '', ''],
  ['Heights of Tomball', 'Regular', 40, 4, 40, '', '', '', '', '', ''],
  ['Heights of Tomball', 'Specialty', 125, 4, 40, '', '', '', '', '', ''],
  ['Lawrence Street Healthcare', 'Regular', 35, 3.5, 40, '', '', '', '', '', ''],
  ['Lawrence Street Healthcare', 'Specialty', 155, 5, 40, '', '', '', '', '', ''],
  ['Concierge', 'Regular', 40, 4.5, 30, 40, 25, '', '', '', ''],
  ['Concierge', 'Specialty', 125, 4.5, 40, 40, 25, '', '', '', ''],
  ['The Shoal', 'Regular', 35, 3.5, 40, 40, 25, '', 4, '', 'First 4 miles of each trip free'],
  ['The Shoal', 'Specialty', 125, 4.5, 40, 40, 25, '', 4, '', 'First 4 miles of each trip free'],
  ['Exalt', 'Regular', 35, 3.5, 30, 20, 25, 30, '', '', ''],
  ['Exalt', 'Specialty', 125, 4.5, 40, 20, 25, 30, '', '', ''],
  ['Exalt', 'Bariatric', 200, 4.5, 40, 20, 25, 30, '', '', ''],
  ['Ignite Medical', 'Regular', 35, 3.5, 25, 20, '', '', '', '', ''],
  ['Ignite Medical', 'Specialty', 125, 4.5, 25, 20, '', '', '', '', ''],
  ['Kindred Main Street', 'Regular', 35, 3.5, 30, 20, 25, 30, '', '', ''],
  ['Kindred Main Street', 'Specialty', 125, 4.5, 40, 20, 25, 30, '', '', ''],
  ['Kindred Main Street', 'Bariatric', 200, 4.5, 40, 20, 25, 30, '', '', ''],
  ['Mid Jefferson Rehabilitation Hospital', 'Regular', 35, 3.5, 25, 25, 30, '', '', '', ''],
  ['Mid Jefferson Rehabilitation Hospital', 'Specialty', 125, 4.5, 25, 25, 30, '', '', '', ''],
  ['Mid Jefferson Rehabilitation Hospital', 'Bariatric', 125, 4.5, 25, 25, 30, '', '', 50, 'Add $50 to the total'],
  ['Oakgrove Nursing Home', 'Regular', 35, 3.5, 15, 20, '', '', '', '', ''],
  ['Oakgrove Nursing Home', 'Specialty', 125, 3.5, 15, 20, '', '', '', '', ''],
  ['Christus St Elizabeth', 'Regular', 35, 3.5, 25, 25, 30, '', '', '', ''],
  ['Christus St Elizabeth', 'Specialty', 125, 4.5, 25, 25, 30, '', '', '', ''],
  ['Christus St Elizabeth', 'Bariatric', 125, 4.5, 25, 25, 30, '', '', 50, 'Add $50 to the total'],
  ['Phoenix', 'Regular', 45, 4.5, 25, 25, 30, '', '', '', ''],
  ['Phoenix', 'Specialty', 125, 5, 25, 25, 30, '', '', '', ''],
  ['Phoenix', 'Bariatric', 175, 5, 25, 25, 30, '', '', '', ''],
  ['The Village', 'Regular', 45, 4.5, 25, 25, 30, '', '', '', ''],
  ['The Village', 'Specialty', 125, 5, 25, 25, 30, '', '', '', ''],
  ['The Village', 'Bariatric', 175, 5, 25, 25, 30, '', '', '', ''],
  ['Magnolia Nursing and Rehab Beaumont', 'Regular', 45, 4, '', 25, 20, '', '', '', ''],
  ['Magnolia Nursing and Rehab Beaumont', 'Specialty', 125, 5, '', 25, 20, '', '', '', ''],
  ['Crescent Regional Hospital', 'Regular', 50, 5, 25, 25, 30, '', '', '', ''],
  ['Crescent Regional Hospital', 'Specialty', 125, 5, 25, 25, 30, '', '', '', ''],
  ['Crescent Regional Hospital', 'Bariatric', 125, 5, 25, 25, 30, '', '', 50, 'Specialty rate plus $50'],
  ['Vital Care', 'Regular', 50, 5, '', 25, '', '', '', '', 'No specialty rate in contract'],
  ['Harbor Point', 'Regular', 35, 3.5, 25, 20, '', '', '', '', ''],
  ['Harbor Point', 'Specialty', 125, 4.5, 25, 20, '', '', '', '', '']
];

var FACILITY_HEADERS = ['Facility (billed and reported separately)', 'Also written as (separate with ;)',
  'Street address (optional, helps matching)', 'Rate group'];

var SEED_FACILITIES = [
  ['PAM Heights', 'Post Acute Medical Heights', '', 'PAM Heights/Clearlake/Humble/Sugarland/Katy'],
  ['PAM Clearlake North', 'PAM Clear Lake North; PAM Clearlake N', '', 'PAM Heights/Clearlake/Humble/Sugarland/Katy'],
  ['PAM Clearlake South', 'PAM Clear Lake South; PAM Clearlake S', '', 'PAM Heights/Clearlake/Humble/Sugarland/Katy'],
  ['PAM Humble', 'Post Acute Medical Humble', '', 'PAM Heights/Clearlake/Humble/Sugarland/Katy'],
  ['PAM Sugarland', 'PAM Sugar Land', '', 'PAM Heights/Clearlake/Humble/Sugarland/Katy'],
  ['PAM Katy', 'Post Acute Medical Katy', '', 'PAM Heights/Clearlake/Humble/Sugarland/Katy'],
  ['PAM Beaumont', 'Post Acute Medical Beaumont', '', 'PAM Beaumont/Victoria/Coleman'],
  ['PAM Victoria North', 'PAM Victoria N', '', 'PAM Beaumont/Victoria/Coleman'],
  ['PAM Victoria South', 'PAM Victoria S', '', 'PAM Beaumont/Victoria/Coleman'],
  ['PAM Victoria Coleman', 'PAM Coleman', '', 'PAM Beaumont/Victoria/Coleman'],
  ['UTMB Galveston', '', '', 'UTMB'],
  ['UTMB Clearlake', 'UTMB Clear Lake', '', 'UTMB'],
  ['UTMB League City', 'UTMB League', '', 'UTMB'],
  ['UTMB Angleton', 'UTMB Angelton', '', 'UTMB'],
  ['Encompass Woodlands', 'Encompass The Woodlands', '', 'Encompass Woodlands/Vision Park/Sugarland/Katy'],
  ['Encompass Vision Park', '', '', 'Encompass Woodlands/Vision Park/Sugarland/Katy'],
  ['Encompass Sugarland', 'Encompass Sugar Land', '', 'Encompass Woodlands/Vision Park/Sugarland/Katy'],
  ['Encompass Katy', '', '', 'Encompass Woodlands/Vision Park/Sugarland/Katy'],
  ['Encompass Vintage', 'Encompass Chasewood', '20180 Chasewood Park Dr, Houston, TX 77070', 'Encompass Vintage'],
  ['Encompass Humble', '', '19002 McKay Dr, Humble, TX 77338', 'Encompass Humble/Medical Center/Plano'],
  ['Encompass Medical Center', '', '', 'Encompass Humble/Medical Center/Plano'],
  ['Encompass Plano', '', '', 'Encompass Humble/Medical Center/Plano'],
  ['Rollingbrook Rehab', 'Rollingbrook', '', 'Rollingbrook Rehab'],
  ['Voyages of Sugarland', 'Voyages Sugar Land', '', 'Voyages of Sugarland'],
  ['Voyages of Conroe', '', '', 'Voyages of Conroe'],
  ['Heights of Tomball', '', '', 'Heights of Tomball'],
  ['Lawrence Street Healthcare', 'Lawrence Street', '', 'Lawrence Street Healthcare'],
  ['Concierge', '', '', 'Concierge'],
  ['The Shoal', 'Shoal', '', 'The Shoal'],
  ['Exalt', '', '', 'Exalt'],
  ['Ignite Medical Webster', 'Ignite Webster', '', 'Ignite Medical'],
  ['Ignite Medical Katy', 'Ignite Katy', '', 'Ignite Medical'],
  ['Kindred Main Street', 'Kindred Main', '', 'Kindred Main Street'],
  ['Mid Jefferson Rehabilitation Hospital', 'Mid Jefferson', '', 'Mid Jefferson Rehabilitation Hospital'],
  ['Oakgrove Nursing Home', 'Oak Grove Nursing', '', 'Oakgrove Nursing Home'],
  ['Christus St Elizabeth', 'Christus Southeast Texas St Elizabeth; St Elizabeth', '', 'Christus St Elizabeth'],
  ['Phoenix', '', '', 'Phoenix'],
  ['The Village', '', '', 'The Village'],
  ['Magnolia Nursing and Rehab Beaumont', 'Magnolia Nursing', '', 'Magnolia Nursing and Rehab Beaumont'],
  ['Crescent Regional Hospital', 'Crescent Regional', '', 'Crescent Regional Hospital'],
  ['Vital Care', '', '', 'Vital Care'],
  ['Harbor Point', '', '', 'Harbor Point']
];

var SEED_SETTINGS = [
  ['Setting', 'Value', 'What it means'],
  ['Calendar ID', 'primary', 'The Google Calendar with the trips. "primary" = your main calendar, or paste the calendar ID from Calendar settings.'],
  ['Off-hours after', '5:30 PM', 'Pickups at or after this time get the off-hours fee.'],
  ['Off-hours before', '7:00 AM', 'Pickups before this time also get the off-hours fee. Weekends follow the same times.'],
  ['Bariatric weight (lbs)', 270, 'Patients over this weight are billed at a higher chair rate even if not written.'],
  ['Over-weight bills as', 'Bariatric', 'Bariatric = the contract\'s bariatric rate, or specialty if it has none. Specialty = always specialty.'],
  ['Mile rounding', '0.1', '0.1 = nearest tenth, whole = nearest mile, up = always round up.'],
  ['Add-ons on both legs', 'Yes', 'Yes = O2 and off-hours fees are charged on each leg of a Pickup and Return.'],
  ['Report folder', 'Delta Billing Reports', 'Google Drive folder where the weekly Excel files are saved.']
];

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, 'Settings', SEED_SETTINGS);
  ensureSheet_(ss, 'Rates', [RATE_HEADERS].concat(SEED_RATES));
  ensureSheet_(ss, 'Facilities', [FACILITY_HEADERS].concat(SEED_FACILITIES));
  SpreadsheetApp.getUi().alert('Setup done. Check the Settings tab (Calendar ID), then use Delta Billing > Pull trips.');
}

function ensureSheet_(ss, name, rows) {
  var sh = ss.getSheetByName(name);
  if (sh && sh.getLastRow() > 0) return sh;
  if (!sh) sh = ss.insertSheet(name);
  var width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 0);
  var data = rows.map(function (r) { while (r.length < width) r.push(''); return r; });
  sh.getRange(1, 1, data.length, width).setValues(data);
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#e8eef7');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, width);
  return sh;
}
