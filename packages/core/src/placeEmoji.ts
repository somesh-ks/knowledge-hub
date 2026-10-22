/**
 * A flag, or a globe, for a topic that names a place. Deterministic and checked before Jev: the
 * choice list holds no flags, and a place name is the one thing a table answers better than a model.
 *
 * A name that holds a place and a subject ("India tech", "Tech in India") gets the place's flag:
 * the place is the more distinctive signal, since a subject word is shared by thousands of topics.
 * When a name holds several places the first one wins ("India Pakistan relations" is 🇮🇳).
 * Matching is by whole word (or whole phrase, longest first), never by substring, so "Indian
 * politics" is 🇮🇳 while "Indiana Jones" and "Indie games" are not. Words of three letters or fewer
 * ("US", "UK", "EU") match only when written in capitals, so "tell us" is not 🇺🇸.
 *
 * England, Scotland and Wales use 🇬🇧: their own flags are tag sequences that many platforms draw
 * as a missing glyph. Names that mostly mean something else (Chad, Georgia, Jordan, Guinea) are
 * left out.
 */

/** ISO 3166-1 alpha-2 code, then the lowercase names and demonyms that stand for it, split by "|". */
const PLACES = `
AF afghanistan|afghan
AL albania|albanian
DZ algeria|algerian
AD andorra
AO angola|angolan
AR argentina|argentine|argentinian
AM armenia|armenian
AU australia|australian|aussie
AT austria|austrian
AZ azerbaijan
BS bahamas
BH bahrain
BD bangladesh|bangladeshi
BB barbados
BY belarus|belarusian
BE belgium|belgian
BZ belize
BJ benin
BT bhutan
BO bolivia|bolivian
BA bosnia|bosnian|bosnia and herzegovina
BW botswana
BR brazil|brazilian
BN brunei
BG bulgaria|bulgarian
BF burkina faso
BI burundi
KH cambodia|cambodian
CM cameroon
CA canada|canadian
CV cape verde
CF central african republic
CL chile|chilean
CN china|chinese|prc
CO colombia|colombian
KM comoros
CG republic of the congo
CD congo|democratic republic of the congo|drc
CR costa rica|costa rican
CI ivory coast|cote d ivoire
HR croatia|croatian
CU cuba|cuban
CY cyprus|cypriot
CZ czech republic|czechia|czech
DK denmark|danish
DJ djibouti
DO dominican republic
EC ecuador|ecuadorian
EG egypt|egyptian
SV el salvador
GQ equatorial guinea
ER eritrea
EE estonia|estonian
SZ eswatini|swaziland
ET ethiopia|ethiopian
FJ fiji
FI finland|finnish
FR france|french
GA gabon
GM gambia
DE germany|german|deutschland
GH ghana|ghanaian
GR greece|greek
GD grenada
GT guatemala
GW guinea bissau
GY guyana
HT haiti|haitian
HN honduras
HK hong kong
HU hungary|hungarian
IS iceland|icelandic
IN india|indian|indians
ID indonesia|indonesian
IR iran|iranian
IQ iraq|iraqi
IE ireland|irish
IL israel|israeli
IT italy|italian
JM jamaica|jamaican
JP japan|japanese
KZ kazakhstan
KE kenya|kenyan
KI kiribati
KP north korea|north korean
KR south korea|south korean|korea|korean
XK kosovo
KW kuwait
KG kyrgyzstan
LA laos
LV latvia|latvian
LB lebanon|lebanese
LS lesotho
LR liberia
LY libya|libyan
LI liechtenstein
LT lithuania|lithuanian
LU luxembourg
MO macau|macao
MG madagascar
MW malawi
MY malaysia|malaysian
MV maldives
ML mali
MT malta|maltese
MH marshall islands
MR mauritania
MU mauritius
MX mexico|mexican
FM micronesia
MD moldova
MC monaco
MN mongolia|mongolian
ME montenegro
MA morocco|moroccan
MZ mozambique
MM myanmar|burma|burmese
NA namibia
NR nauru
NP nepal|nepali|nepalese
NL netherlands|dutch|holland
NZ new zealand
NI nicaragua
NE niger
NG nigeria|nigerian
MK north macedonia|macedonia
NO norway|norwegian
OM oman
PK pakistan|pakistani
PW palau
PS palestine|palestinian|palestinians|gaza|west bank
PA panama
PG papua new guinea
PY paraguay
PE peru|peruvian
PH philippines|filipino|philippine
PL poland|polish
PT portugal|portuguese
PR puerto rico
QA qatar
RO romania|romanian
RU russia|russian
RW rwanda
KN saint kitts and nevis
LC saint lucia
VC saint vincent
WS samoa
SM san marino
ST sao tome
SA saudi arabia|saudi
SN senegal
RS serbia|serbian
SC seychelles
SL sierra leone
SG singapore|singaporean
SK slovakia|slovak
SI slovenia|slovenian
SB solomon islands
SO somalia
ZA south africa|south african
SS south sudan
ES spain|spanish
LK sri lanka
SD sudan
SR suriname
SE sweden|swedish
CH switzerland|swiss
SY syria|syrian
TW taiwan|taiwanese
TJ tajikistan
TZ tanzania
TH thailand|thai
TL timor leste|east timor
TG togo
TO tonga
TT trinidad and tobago|trinidad
TN tunisia
TR turkey|turkiye|turkish
TM turkmenistan
TV tuvalu
UG uganda
UA ukraine|ukrainian
AE uae|united arab emirates|emirates|dubai|abu dhabi
GB uk|u k|united kingdom|great britain|britain|british|england|english|scotland|scottish|wales|welsh|northern ireland
US usa|us|u s|u s a|united states|america|american|americans
UY uruguay
UZ uzbekistan
VU vanuatu
VA vatican|holy see
VE venezuela|venezuelan
VN vietnam|vietnamese
YE yemen
ZM zambia
ZW zimbabwe
EU eu|european union
`;

/** Regions and continents have no flag; a globe turned to face them stands for them. */
const REGIONS: Readonly<Record<string, string>> = {
  "🌍": "europe|european|africa|african|middle east|middle eastern|emea|mena",
  "🌎": "americas|latin america|latin american|south america|south american|north america|north american|central america|caribbean|latam",
  "🌏": "asia|asian|oceania|asia pacific|apac|southeast asia|east asia|pacific",
};

const MAX_WORDS = 5;

function flag(code: string): string {
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

const PLACE_BY_NAME = new Map<string, string>();
for (const line of PLACES.trim().split("\n")) {
  const space = line.indexOf(" ");
  const emoji = flag(line.slice(0, space));
  for (const name of line.slice(space + 1).split("|")) PLACE_BY_NAME.set(name, emoji);
}
for (const [emoji, names] of Object.entries(REGIONS))
  for (const name of names.split("|")) PLACE_BY_NAME.set(name, emoji);

/** How many places and regions the table holds, as names and codes alike. */
export const PLACE_NAME_COUNT = PLACE_BY_NAME.size;

/** The flag or globe for the first place a name holds, else undefined. */
export function placeEmoji(name: string): string | undefined {
  const words = (
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .match(/\p{L}+/gu) ?? []
  ).map((word) => ({ text: word.toLowerCase(), caps: word === word.toUpperCase() }));
  for (let start = 0; start < words.length; start++) {
    for (let length = Math.min(MAX_WORDS, words.length - start); length >= 1; length--) {
      const slice = words.slice(start, start + length);
      const key = slice.map((word) => word.text).join(" ");
      const hit = PLACE_BY_NAME.get(key);
      if (hit === undefined) continue;
      if (key.replace(/ /g, "").length <= 3 && !slice.every((word) => word.caps)) continue;
      return hit;
    }
  }
  return undefined;
}
