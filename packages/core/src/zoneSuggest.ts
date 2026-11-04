import { clockSignature, flagOf, SUPPORTED_TIMEZONES } from "./time.js";

/**
 * The country of a device's time zone, for the flag beside its place in the time zone prompt
 * (D239). Every IANA zone of tzdata's zone.tab, by ISO 3166 country, and the older names a browser
 * may still report (Chrome says Asia/Calcutta for India), written old>current. A table, not
 * Intl.Locale's getTimeZones: Firefox has none. Its own module, imported only by the lazy prompt
 * (zonePrompt.ts), so no page loads the table up front.
 */
const ZONES = `
AD Europe/Andorra
AE Asia/Dubai
AF Asia/Kabul
AG America/Antigua
AI America/Anguilla
AL Europe/Tirane
AM Asia/Yerevan
AO Africa/Luanda
AQ Antarctica/McMurdo Antarctica/Casey Antarctica/Davis Antarctica/DumontDUrville Antarctica/Mawson Antarctica/Palmer Antarctica/Rothera Antarctica/Syowa Antarctica/Troll Antarctica/Vostok Antarctica/South_Pole>Antarctica/McMurdo
AR America/Argentina/Buenos_Aires America/Argentina/Cordoba America/Argentina/Salta America/Argentina/Jujuy America/Argentina/Tucuman America/Argentina/Catamarca America/Argentina/La_Rioja America/Argentina/San_Juan America/Argentina/Mendoza America/Argentina/San_Luis America/Argentina/Rio_Gallegos America/Argentina/Ushuaia America/Buenos_Aires>America/Argentina/Buenos_Aires America/Catamarca>America/Argentina/Catamarca America/Cordoba>America/Argentina/Cordoba America/Jujuy>America/Argentina/Jujuy America/Mendoza>America/Argentina/Mendoza America/Argentina/ComodRivadavia>America/Argentina/Catamarca America/Rosario>America/Argentina/Cordoba
AS Pacific/Pago_Pago Pacific/Samoa>Pacific/Pago_Pago
AT Europe/Vienna
AU Australia/Lord_Howe Antarctica/Macquarie Australia/Hobart Australia/Melbourne Australia/Sydney Australia/Broken_Hill Australia/Brisbane Australia/Lindeman Australia/Adelaide Australia/Darwin Australia/Perth Australia/Eucla Australia/North>Australia/Darwin Australia/Queensland>Australia/Brisbane Australia/South>Australia/Adelaide Australia/Tasmania>Australia/Hobart Australia/Victoria>Australia/Melbourne Australia/West>Australia/Perth Australia/Yancowinna>Australia/Broken_Hill Australia/Canberra>Australia/Sydney Australia/Currie>Australia/Hobart
AW America/Aruba
AX Europe/Mariehamn
AZ Asia/Baku
BA Europe/Sarajevo
BB America/Barbados
BD Asia/Dhaka Asia/Dacca>Asia/Dhaka
BE Europe/Brussels
BF Africa/Ouagadougou
BG Europe/Sofia
BH Asia/Bahrain
BI Africa/Bujumbura
BJ Africa/Porto-Novo
BL America/St_Barthelemy
BM Atlantic/Bermuda
BN Asia/Brunei
BO America/La_Paz
BQ America/Kralendijk
BR America/Noronha America/Belem America/Fortaleza America/Recife America/Araguaina America/Maceio America/Bahia America/Sao_Paulo America/Campo_Grande America/Cuiaba America/Santarem America/Porto_Velho America/Boa_Vista America/Manaus America/Eirunepe America/Rio_Branco America/Porto_Acre>America/Rio_Branco
BS America/Nassau
BT Asia/Thimphu Asia/Thimbu>Asia/Thimphu
BW Africa/Gaborone
BY Europe/Minsk
BZ America/Belize
CA America/St_Johns America/Halifax America/Glace_Bay America/Moncton America/Goose_Bay America/Blanc-Sablon America/Toronto America/Iqaluit America/Atikokan America/Winnipeg America/Resolute America/Rankin_Inlet America/Regina America/Swift_Current America/Edmonton America/Cambridge_Bay America/Inuvik America/Vancouver America/Creston America/Dawson_Creek America/Fort_Nelson America/Whitehorse America/Dawson America/Montreal>America/Toronto America/Nipigon>America/Toronto America/Pangnirtung>America/Iqaluit America/Rainy_River>America/Winnipeg America/Thunder_Bay>America/Toronto America/Yellowknife>America/Edmonton America/Coral_Harbour>America/Atikokan
CC Indian/Cocos
CD Africa/Kinshasa Africa/Lubumbashi
CF Africa/Bangui
CG Africa/Brazzaville
CH Europe/Zurich
CI Africa/Abidjan
CK Pacific/Rarotonga
CL America/Santiago America/Coyhaique America/Punta_Arenas Pacific/Easter
CM Africa/Douala
CN Asia/Shanghai Asia/Urumqi Asia/Chongqing>Asia/Shanghai Asia/Harbin>Asia/Shanghai Asia/Kashgar>Asia/Urumqi Asia/Chungking>Asia/Shanghai
CO America/Bogota
CR America/Costa_Rica
CU America/Havana
CV Atlantic/Cape_Verde
CW America/Curacao
CX Indian/Christmas
CY Asia/Nicosia Asia/Famagusta Europe/Nicosia>Asia/Nicosia
CZ Europe/Prague
DE Europe/Berlin Europe/Busingen
DJ Africa/Djibouti
DK Europe/Copenhagen
DM America/Dominica
DO America/Santo_Domingo
DZ Africa/Algiers
EC America/Guayaquil Pacific/Galapagos
EE Europe/Tallinn
EG Africa/Cairo
EH Africa/El_Aaiun
ER Africa/Asmara Africa/Asmera>Africa/Asmara
ES Europe/Madrid Africa/Ceuta Atlantic/Canary
ET Africa/Addis_Ababa
FI Europe/Helsinki
FJ Pacific/Fiji
FK Atlantic/Stanley
FM Pacific/Chuuk Pacific/Pohnpei Pacific/Kosrae Pacific/Truk>Pacific/Chuuk Pacific/Yap>Pacific/Chuuk Pacific/Ponape>Pacific/Pohnpei
FO Atlantic/Faroe Atlantic/Faeroe>Atlantic/Faroe
FR Europe/Paris
GA Africa/Libreville
GB Europe/London Europe/Belfast>Europe/London
GD America/Grenada
GE Asia/Tbilisi
GF America/Cayenne
GG Europe/Guernsey
GH Africa/Accra
GI Europe/Gibraltar
GL America/Nuuk America/Danmarkshavn America/Scoresbysund America/Thule America/Godthab>America/Nuuk
GM Africa/Banjul
GN Africa/Conakry
GP America/Guadeloupe
GQ Africa/Malabo
GR Europe/Athens
GS Atlantic/South_Georgia
GT America/Guatemala
GU Pacific/Guam
GW Africa/Bissau
GY America/Guyana
HK Asia/Hong_Kong
HN America/Tegucigalpa
HR Europe/Zagreb
HT America/Port-au-Prince
HU Europe/Budapest
ID Asia/Jakarta Asia/Pontianak Asia/Makassar Asia/Jayapura Asia/Ujung_Pandang>Asia/Makassar
IE Europe/Dublin
IL Asia/Jerusalem Asia/Tel_Aviv>Asia/Jerusalem
IM Europe/Isle_of_Man
IN Asia/Kolkata Asia/Calcutta>Asia/Kolkata
IO Indian/Chagos
IQ Asia/Baghdad
IR Asia/Tehran
IS Atlantic/Reykjavik
IT Europe/Rome
JE Europe/Jersey
JM America/Jamaica
JO Asia/Amman
JP Asia/Tokyo
KE Africa/Nairobi
KG Asia/Bishkek
KH Asia/Phnom_Penh
KI Pacific/Tarawa Pacific/Kanton Pacific/Kiritimati Pacific/Enderbury>Pacific/Kanton
KM Indian/Comoro
KN America/St_Kitts
KP Asia/Pyongyang
KR Asia/Seoul
KW Asia/Kuwait
KY America/Cayman
KZ Asia/Almaty Asia/Qyzylorda Asia/Qostanay Asia/Aqtobe Asia/Aqtau Asia/Atyrau Asia/Oral
LA Asia/Vientiane
LB Asia/Beirut
LC America/St_Lucia
LI Europe/Vaduz
LK Asia/Colombo
LR Africa/Monrovia
LS Africa/Maseru
LT Europe/Vilnius
LU Europe/Luxembourg
LV Europe/Riga
LY Africa/Tripoli
MA Africa/Casablanca
MC Europe/Monaco
MD Europe/Chisinau Europe/Tiraspol>Europe/Chisinau
ME Europe/Podgorica
MF America/Marigot
MG Indian/Antananarivo
MH Pacific/Majuro Pacific/Kwajalein
MK Europe/Skopje
ML Africa/Bamako Africa/Timbuktu>Africa/Bamako
MM Asia/Yangon Asia/Rangoon>Asia/Yangon
MN Asia/Ulaanbaatar Asia/Hovd Asia/Choibalsan>Asia/Ulaanbaatar Asia/Ulan_Bator>Asia/Ulaanbaatar
MO Asia/Macau Asia/Macao>Asia/Macau
MP Pacific/Saipan
MQ America/Martinique
MR Africa/Nouakchott
MS America/Montserrat
MT Europe/Malta
MU Indian/Mauritius
MV Indian/Maldives
MW Africa/Blantyre
MX America/Mexico_City America/Cancun America/Merida America/Monterrey America/Matamoros America/Chihuahua America/Ciudad_Juarez America/Ojinaga America/Mazatlan America/Bahia_Banderas America/Hermosillo America/Tijuana America/Ensenada>America/Tijuana America/Santa_Isabel>America/Tijuana
MY Asia/Kuala_Lumpur Asia/Kuching
MZ Africa/Maputo
NA Africa/Windhoek
NC Pacific/Noumea
NE Africa/Niamey
NF Pacific/Norfolk
NG Africa/Lagos
NI America/Managua
NL Europe/Amsterdam
NO Europe/Oslo Atlantic/Jan_Mayen>Europe/Oslo
NP Asia/Kathmandu Asia/Katmandu>Asia/Kathmandu
NR Pacific/Nauru
NU Pacific/Niue
NZ Pacific/Auckland Pacific/Chatham
OM Asia/Muscat
PA America/Panama
PE America/Lima
PF Pacific/Tahiti Pacific/Marquesas Pacific/Gambier
PG Pacific/Port_Moresby Pacific/Bougainville
PH Asia/Manila
PK Asia/Karachi
PL Europe/Warsaw
PM America/Miquelon
PN Pacific/Pitcairn
PR America/Puerto_Rico
PS Asia/Gaza Asia/Hebron
PT Europe/Lisbon Atlantic/Madeira Atlantic/Azores
PW Pacific/Palau
PY America/Asuncion
QA Asia/Qatar
RE Indian/Reunion
RO Europe/Bucharest
RS Europe/Belgrade
RU Europe/Kaliningrad Europe/Moscow Europe/Kirov Europe/Volgograd Europe/Astrakhan Europe/Saratov Europe/Ulyanovsk Europe/Samara Asia/Yekaterinburg Asia/Omsk Asia/Novosibirsk Asia/Barnaul Asia/Tomsk Asia/Novokuznetsk Asia/Krasnoyarsk Asia/Irkutsk Asia/Chita Asia/Yakutsk Asia/Khandyga Asia/Vladivostok Asia/Ust-Nera Asia/Magadan Asia/Sakhalin Asia/Srednekolymsk Asia/Kamchatka Asia/Anadyr
RW Africa/Kigali
SA Asia/Riyadh
SB Pacific/Guadalcanal
SC Indian/Mahe
SD Africa/Khartoum
SE Europe/Stockholm
SG Asia/Singapore
SH Atlantic/St_Helena
SI Europe/Ljubljana
SJ Arctic/Longyearbyen
SK Europe/Bratislava
SL Africa/Freetown
SM Europe/San_Marino
SN Africa/Dakar
SO Africa/Mogadishu
SR America/Paramaribo
SS Africa/Juba
ST Africa/Sao_Tome
SV America/El_Salvador
SX America/Lower_Princes
SY Asia/Damascus
SZ Africa/Mbabane
TC America/Grand_Turk
TD Africa/Ndjamena
TF Indian/Kerguelen
TG Africa/Lome
TH Asia/Bangkok
TJ Asia/Dushanbe
TK Pacific/Fakaofo
TL Asia/Dili
TM Asia/Ashgabat Asia/Ashkhabad>Asia/Ashgabat
TN Africa/Tunis
TO Pacific/Tongatapu
TR Europe/Istanbul Asia/Istanbul>Europe/Istanbul
TT America/Port_of_Spain
TV Pacific/Funafuti
TW Asia/Taipei
TZ Africa/Dar_es_Salaam
UA Europe/Simferopol Europe/Kyiv Europe/Uzhgorod>Europe/Kyiv Europe/Zaporozhye>Europe/Kyiv Europe/Kiev>Europe/Kyiv
UG Africa/Kampala
UM Pacific/Midway Pacific/Wake
US America/New_York America/Detroit America/Kentucky/Louisville America/Kentucky/Monticello America/Indiana/Indianapolis America/Indiana/Vincennes America/Indiana/Winamac America/Indiana/Marengo America/Indiana/Petersburg America/Indiana/Vevay America/Chicago America/Indiana/Tell_City America/Indiana/Knox America/Menominee America/North_Dakota/Center America/North_Dakota/New_Salem America/North_Dakota/Beulah America/Denver America/Boise America/Phoenix America/Los_Angeles America/Anchorage America/Juneau America/Sitka America/Metlakatla America/Yakutat America/Nome America/Adak Pacific/Honolulu America/Indianapolis>America/Indiana/Indianapolis America/Knox_IN>America/Indiana/Knox America/Louisville>America/Kentucky/Louisville America/Atka>America/Adak America/Fort_Wayne>America/Indiana/Indianapolis America/Shiprock>America/Denver Pacific/Johnston>Pacific/Honolulu
UY America/Montevideo
UZ Asia/Samarkand Asia/Tashkent
VA Europe/Vatican
VC America/St_Vincent
VE America/Caracas
VG America/Tortola
VI America/St_Thomas America/Virgin>America/St_Thomas
VN Asia/Ho_Chi_Minh Asia/Saigon>Asia/Ho_Chi_Minh
VU Pacific/Efate
WF Pacific/Wallis
WS Pacific/Apia
YE Asia/Aden
YT Indian/Mayotte
ZA Africa/Johannesburg
ZM Africa/Lusaka
ZW Africa/Harare
`;

let index: Map<string, { country: string; zone: string }> | undefined;

/** A zone's country and current name; undefined for one with no country (UTC) or none known. */
function zoneHome(zone: string): { country: string; zone: string } | undefined {
  if (!index) {
    index = new Map();
    for (const line of ZONES.trim().split("\n")) {
      const [country = "", ...names] = line.split(" ");
      for (const name of names) {
        const [old = "", current = old] = name.split(">");
        index.set(old, { country, zone: current });
      }
    }
  }
  return index.get(zone);
}

/** The zone the schedule could move to, from the one a device reports. */
export interface ZoneSuggestion {
  zone: string;
  /** Where the device is: the list's name for a listed zone, else the zone's own city. */
  label: string;
  /** The flag of the device zone's country; none for a zone without one (UTC). */
  flag?: string;
}

/**
 * The zone to offer a device whose system zone is `device` while the schedule counts in `saved`
 * (D239), or null when there is nothing to offer: the same clock (a zone the list lacks, such as
 * Oslo, keeps Stockholm's time and asks for nothing), or a zone no entry of the list can stand for
 * (Kathmandu). A device zone on the list is offered as itself; one that is not, as the first entry
 * that keeps its time, still named and flagged as where the device is ("Copenhagen 🇩🇰").
 */
export function suggestZone(
  device: string | undefined,
  saved: string,
  at: Date = new Date(),
): ZoneSuggestion | null {
  if (!device || device === saved) return null;
  const mine = clockSignature(device, at);
  if (mine === null || mine === clockSignature(saved, at)) return null;
  const home = zoneHome(device);
  const current = home?.zone ?? device;
  const listed = SUPPORTED_TIMEZONES.find((option) => option.value === current);
  const match =
    listed ?? SUPPORTED_TIMEZONES.find((option) => clockSignature(option.value, at) === mine);
  if (!match) return null;
  const country = listed?.country ?? home?.country;
  return {
    zone: match.value,
    label: listed?.label ?? (current.split("/").pop() ?? current).replaceAll("_", " "),
    ...(country ? { flag: flagOf(country) } : {}),
  };
}
