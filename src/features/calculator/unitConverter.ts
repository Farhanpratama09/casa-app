/**
 * unitConverter.ts — Offline Unit, Timezone & 155+ World Currency Converter
 *
 * Categories:
 *  - currency    (155+ ISO-4217 world currencies, offline presets + auto-fetched live cache via Rust proxy)
 *  - length      (mm, cm, m, km, in, ft, mi)
 *  - mass        (mg, g, kg, oz, lb)
 *  - temperature (°C, °F, K)
 *  - data        (B, KB, MB, GB, KiB, MiB, GiB)
 *  - timezone    (WIB, WITA, WIT, UTC)
 */

import { formatCalcNumber, normalizeDecimalPrecision } from './calcParser';

export type ConverterCategoryId =
  | 'length'
  | 'mass'
  | 'temperature'
  | 'data'
  | 'timezone'
  | 'currency';

export interface ConverterUnitOption {
  id: string;
  label: string;
  shortLabel: string;
}

export interface ConverterCategoryMeta {
  id: ConverterCategoryId;
  label: string;
  units: ConverterUnitOption[];
  defaultFrom: string;
  defaultTo: string;
}

export type SupportedCurrencyCode = string;

export const CORE_CURRENCY_CODES = ['USD', 'IDR', 'SGD', 'JPY', 'KRW', 'EUR'] as const;

export interface CurrencyMetadata {
  code: string;
  name: string;
  country: string;
  keywords: string;
  defaultRate: number;
}

const POPULAR_CURRENCY_ORDER = [
  'IDR',
  'USD',
  'SAR',
  'KRW',
  'JPY',
  'SGD',
  'MYR',
  'EUR',
  'GBP',
  'AUD',
  'CNY',
  'THB',
  'PHP',
  'VND',
  'AED',
  'QAR',
  'KWD',
  'TRY',
  'INR',
  'CHF',
  'CAD',
  'HKD',
  'TWD',
  'NZD',
];

const POPULAR_ORDER_MAP = new Map<string, number>(
  POPULAR_CURRENCY_ORDER.map((c, idx) => [c, idx])
);

const ZERO_DECIMAL_CURRENCIES = new Set([
  'IDR',
  'JPY',
  'KRW',
  'VND',
  'CLP',
  'PYG',
  'UGX',
  'RWF',
  'KMF',
  'GNF',
  'MGA',
  'XOF',
  'XAF',
  'XPF',
  'BIF',
  'DJF',
  'ISK',
  'LAK',
  'KHR',
  'IRR',
  'IQD',
  'KPW',
]);

const THREE_DECIMAL_CURRENCIES = new Set(['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'LYD']);

// Comprehensive 162 ISO-4217 world currency catalog with Indonesian & English search terms
export const WORLD_CURRENCY_CATALOG: CurrencyMetadata[] = [
  { code: 'IDR', name: 'Rupiah', country: 'Indonesia', keywords: 'indonesia jakarta bali rupiah rp idr', defaultRate: 16250 },
  { code: 'USD', name: 'US Dollar', country: 'Amerika Serikat', keywords: 'amerika serikat united states usa us dollar dolar usd', defaultRate: 1 },
  { code: 'SAR', name: 'Saudi Riyal', country: 'Arab Saudi', keywords: 'arab saudi saudi arabia riyal rial mekah madinah umroh haji sar', defaultRate: 3.75 },
  { code: 'KRW', name: 'South Korean Won', country: 'Korea Selatan', keywords: 'korea selatan south korea seoul won krw', defaultRate: 1390 },
  { code: 'JPY', name: 'Japanese Yen', country: 'Jepang', keywords: 'jepang japan tokyo osaka yen jpy', defaultRate: 154 },
  { code: 'SGD', name: 'Singapore Dollar', country: 'Singapura', keywords: 'singapura singapore dollar dolar sgd', defaultRate: 1.34 },
  { code: 'MYR', name: 'Malaysian Ringgit', country: 'Malaysia', keywords: 'malaysia kuala lumpur ringgit rm myr', defaultRate: 4.45 },
  { code: 'EUR', name: 'Euro', country: 'Uni Eropa', keywords: 'eropa europe euro jerman prancis belanda spanyol italia eur', defaultRate: 0.92 },
  { code: 'GBP', name: 'Pound Sterling', country: 'Inggris', keywords: 'inggris united kingdom uk britania british london pound sterling gbp', defaultRate: 0.79 },
  { code: 'AUD', name: 'Australian Dollar', country: 'Australia', keywords: 'australia sydney melbourne dollar dolar aud', defaultRate: 1.53 },
  { code: 'CNY', name: 'Chinese Yuan Renminbi', country: 'Tiongkok', keywords: 'tiongkok china cina beijing shanghai yuan rmb renminbi cny', defaultRate: 7.24 },
  { code: 'THB', name: 'Thai Baht', country: 'Thailand', keywords: 'thailand bangkok baht thb', defaultRate: 34.6 },
  { code: 'PHP', name: 'Philippine Peso', country: 'Filipina', keywords: 'filipina philippines manila peso php', defaultRate: 58.6 },
  { code: 'VND', name: 'Vietnamese Dong', country: 'Vietnam', keywords: 'vietnam hanoi saigon dong vnd', defaultRate: 25400 },
  { code: 'AED', name: 'UAE Dirham', country: 'Uni Emirat Arab', keywords: 'uni emirat arab uae dubai abu dhabi dirham aed', defaultRate: 3.6725 },
  { code: 'QAR', name: 'Qatari Riyal', country: 'Qatar', keywords: 'qatar doha riyal qar', defaultRate: 3.64 },
  { code: 'KWD', name: 'Kuwaiti Dinar', country: 'Kuwait', keywords: 'kuwait dinar kwd', defaultRate: 0.307 },
  { code: 'TRY', name: 'Turkish Lira', country: 'Turki', keywords: 'turki turkey turkiye istanbul ankara lira try', defaultRate: 34.4 },
  { code: 'INR', name: 'Indian Rupee', country: 'India', keywords: 'india delhi mumbai rupee inr', defaultRate: 84.4 },
  { code: 'CHF', name: 'Swiss Franc', country: 'Swiss', keywords: 'swiss switzerland zurich franc chf', defaultRate: 0.88 },
  { code: 'CAD', name: 'Canadian Dollar', country: 'Kanada', keywords: 'kanada canada toronto dollar dolar cad', defaultRate: 1.4 },
  { code: 'HKD', name: 'Hong Kong Dollar', country: 'Hong Kong', keywords: 'hong kong dollar dolar hkd', defaultRate: 7.78 },
  { code: 'TWD', name: 'New Taiwan Dollar', country: 'Taiwan', keywords: 'taiwan taipei dollar dolar twd', defaultRate: 32.5 },
  { code: 'NZD', name: 'New Zealand Dollar', country: 'Selandia Baru', keywords: 'selandia baru new zealand kiwi dollar dolar nzd', defaultRate: 1.69 },
  { code: 'BRL', name: 'Brazilian Real', country: 'Brasil', keywords: 'brasil brazil real brl', defaultRate: 5.79 },
  { code: 'MXN', name: 'Mexican Peso', country: 'Meksiko', keywords: 'meksiko mexico peso mxn', defaultRate: 20.3 },
  { code: 'RUB', name: 'Russian Ruble', country: 'Rusia', keywords: 'rusia russia moskow ruble rubel rub', defaultRate: 98.5 },
  { code: 'ZAR', name: 'South African Rand', country: 'Afrika Selatan', keywords: 'afrika selatan south africa rand zar', defaultRate: 18.1 },
  { code: 'EGP', name: 'Egyptian Pound', country: 'Mesir', keywords: 'mesir egypt kairo cairo pound egp', defaultRate: 49.4 },
  { code: 'PKR', name: 'Pakistani Rupee', country: 'Pakistan', keywords: 'pakistan karachi islamabad rupee pkr', defaultRate: 277.8 },

  { code: 'BDT', name: 'Bangladeshi Taka', country: 'Bangladesh', keywords: 'bangladesh dhaka taka bdt', defaultRate: 119.5 },
  { code: 'BND', name: 'Brunei Dollar', country: 'Brunei Darussalam', keywords: 'brunei darussalam bandar seri begawan dollar bnd', defaultRate: 1.34 },
  { code: 'KHR', name: 'Cambodian Riel', country: 'Kamboja', keywords: 'kamboja cambodia phnom penh riel khr', defaultRate: 4065 },
  { code: 'LAK', name: 'Lao Kip', country: 'Laos', keywords: 'laos vientiane kip lak', defaultRate: 21900 },
  { code: 'MMK', name: 'Myanmar Kyat', country: 'Myanmar', keywords: 'myanmar burma yangon kyat mmk', defaultRate: 2100 },
  { code: 'LKR', name: 'Sri Lankan Rupee', country: 'Sri Lanka', keywords: 'sri lanka colombo rupee lkr', defaultRate: 292 },
  { code: 'NPR', name: 'Nepalese Rupee', country: 'Nepal', keywords: 'nepal kathmandu rupee npr', defaultRate: 135 },
  { code: 'OMR', name: 'Omani Rial', country: 'Oman', keywords: 'oman muscat rial omr', defaultRate: 0.385 },
  { code: 'BHD', name: 'Bahraini Dinar', country: 'Bahrain', keywords: 'bahrain manama dinar bhd', defaultRate: 0.376 },
  { code: 'JOD', name: 'Jordanian Dinar', country: 'Yordania', keywords: 'yordania jordan amman dinar jod', defaultRate: 0.709 },
  { code: 'ILS', name: 'Israeli New Shekel', country: 'Israel', keywords: 'israel shekel ils', defaultRate: 3.74 },
  { code: 'IQD', name: 'Iraqi Dinar', country: 'Irak', keywords: 'irak iraq baghdad dinar iqd', defaultRate: 1310 },
  { code: 'IRR', name: 'Iranian Rial', country: 'Iran', keywords: 'iran tehran rial irr', defaultRate: 42000 },
  { code: 'LBP', name: 'Lebanese Pound', country: 'Lebanon', keywords: 'lebanon beirut pound lbp', defaultRate: 89500 },
  { code: 'SYP', name: 'Syrian Pound', country: 'Suriah', keywords: 'suriah syria damaskus pound syp', defaultRate: 13000 },
  { code: 'YER', name: 'Yemeni Rial', country: 'Yaman', keywords: 'yaman yemen sanaa rial yer', defaultRate: 250 },
  { code: 'AFN', name: 'Afghan Afghani', country: 'Afganistan', keywords: 'afganistan afghanistan kabul afghani afn', defaultRate: 68.5 },
  { code: 'MNT', name: 'Mongolian Tugrik', country: 'Mongolia', keywords: 'mongolia ulaanbaatar tugrik mnt', defaultRate: 3400 },
  { code: 'KZT', name: 'Kazakhstani Tenge', country: 'Kazakhstan', keywords: 'kazakhstan astana almaty tenge kzt', defaultRate: 495 },
  { code: 'UZS', name: 'Uzbekistani Som', country: 'Uzbekistan', keywords: 'uzbekistan tashkent samarkand som uzs', defaultRate: 12800 },
  { code: 'KGS', name: 'Kyrgystani Som', country: 'Kirgizstan', keywords: 'kirgizstan kyrgyzstan bishkek som kgs', defaultRate: 86.4 },
  { code: 'TJS', name: 'Tajikistani Somoni', country: 'Tajikistan', keywords: 'tajikistan dushanbe somoni tjs', defaultRate: 10.65 },
  { code: 'TMT', name: 'Turkmenistani Manat', country: 'Turkmenistan', keywords: 'turkmenistan ashgabat manat tmt', defaultRate: 3.5 },
  { code: 'GEL', name: 'Georgian Lari', country: 'Georgia', keywords: 'georgia tbilisi lari gel', defaultRate: 2.73 },
  { code: 'AMD', name: 'Armenian Dram', country: 'Armenia', keywords: 'armenia yerevan dram amd', defaultRate: 387 },
  { code: 'AZN', name: 'Azerbaijani Manat', country: 'Azerbaijan', keywords: 'azerbaijan baku manat azn', defaultRate: 1.7 },
  { code: 'MOP', name: 'Macanese Pataca', country: 'Makau', keywords: 'makau macau pataca mop', defaultRate: 8.01 },
  { code: 'MVR', name: 'Maldivian Rufiyaa', country: 'Maladewa', keywords: 'maladewa maldives male rufiyaa mvr', defaultRate: 15.4 },
  { code: 'BTN', name: 'Bhutanese Ngultrum', country: 'Bhutan', keywords: 'bhutan thimphu ngultrum btn', defaultRate: 84.4 },
  { code: 'KPW', name: 'North Korean Won', country: 'Korea Utara', keywords: 'korea utara north korea pyongyang won kpw', defaultRate: 900 },

  { code: 'PLN', name: 'Polish Zloty', country: 'Polandia', keywords: 'polandia poland warsawa warsaw zloty pln', defaultRate: 4.09 },
  { code: 'CZK', name: 'Czech Koruna', country: 'Ceko', keywords: 'ceko czechia praha prague koruna czk', defaultRate: 23.9 },
  { code: 'HUF', name: 'Hungarian Forint', country: 'Hungaria', keywords: 'hungaria hungary budapest forint huf', defaultRate: 385 },
  { code: 'RON', name: 'Romanian Leu', country: 'Rumania', keywords: 'rumania romania bucharest leu ron', defaultRate: 4.65 },
  { code: 'BGN', name: 'Bulgarian Lev', country: 'Bulgaria', keywords: 'bulgaria sofia lev bgn', defaultRate: 1.83 },
  { code: 'SEK', name: 'Swedish Krona', country: 'Swedia', keywords: 'swedia sweden stockholm krona sek', defaultRate: 10.9 },
  { code: 'NOK', name: 'Norwegian Krone', country: 'Norwegia', keywords: 'norwegia norway oslo krone nok', defaultRate: 11.0 },
  { code: 'DKK', name: 'Danish Krone', country: 'Denmark', keywords: 'denmark kopenhagen copenhagen krone dkk', defaultRate: 6.99 },
  { code: 'ISK', name: 'Icelandic Krona', country: 'Islandia', keywords: 'islandia iceland reykjavik krona isk', defaultRate: 138 },
  { code: 'UAH', name: 'Ukrainian Hryvnia', country: 'Ukraina', keywords: 'ukraina ukraine kyiv hryvnia uah', defaultRate: 41.3 },
  { code: 'BYN', name: 'Belarusian Ruble', country: 'Belarus', keywords: 'belarus minsk ruble byn', defaultRate: 3.27 },
  { code: 'MDL', name: 'Moldovan Leu', country: 'Moldova', keywords: 'moldova chisinau leu mdl', defaultRate: 18.0 },
  { code: 'RSD', name: 'Serbian Dinar', country: 'Serbia', keywords: 'serbia belgrade dinar rsd', defaultRate: 109.8 },
  { code: 'BAM', name: 'Bosnia-Herzegovina Mark', country: 'Bosnia & Herzegovina', keywords: 'bosnia herzegovina sarajevo mark bam', defaultRate: 1.83 },
  { code: 'MKD', name: 'Macedonian Denar', country: 'Makedonia Utara', keywords: 'makedonia utara north macedonia skopje denar mkd', defaultRate: 57.6 },
  { code: 'ALL', name: 'Albanian Lek', country: 'Albania', keywords: 'albania tirana lek all', defaultRate: 92.5 },
  { code: 'GGP', name: 'Guernsey Pound', country: 'Guernsey', keywords: 'guernsey pound ggp', defaultRate: 0.79 },
  { code: 'JEP', name: 'Jersey Pound', country: 'Jersey', keywords: 'jersey pound jep', defaultRate: 0.79 },
  { code: 'IMP', name: 'Manx Pound', country: 'Isle of Man', keywords: 'isle of man manx pound imp', defaultRate: 0.79 },
  { code: 'GIP', name: 'Gibraltar Pound', country: 'Gibraltar', keywords: 'gibraltar pound gip', defaultRate: 0.79 },
  { code: 'FKP', name: 'Falkland Islands Pound', country: 'Kepulauan Falkland', keywords: 'falkland islands pound fkp', defaultRate: 0.79 },
  { code: 'SHP', name: 'Saint Helena Pound', country: 'Saint Helena', keywords: 'saint helena pound shp', defaultRate: 0.79 },
  { code: 'FOK', name: 'Faroese Krona', country: 'Kepulauan Faroe', keywords: 'faroe islands krona fok', defaultRate: 6.99 },

  { code: 'MAD', name: 'Moroccan Dirham', country: 'Maroko', keywords: 'maroko morocco casablanca rabat dirham mad', defaultRate: 9.95 },
  { code: 'DZD', name: 'Algerian Dinar', country: 'Aljazair', keywords: 'aljazair algeria algiers dinar dzd', defaultRate: 133.5 },
  { code: 'TND', name: 'Tunisian Dinar', country: 'Tunisia', keywords: 'tunisia tunis dinar tnd', defaultRate: 3.12 },
  { code: 'LYD', name: 'Libyan Dinar', country: 'Libya', keywords: 'libya tripoli dinar lyd', defaultRate: 4.86 },
  { code: 'NGN', name: 'Nigerian Naira', country: 'Nigeria', keywords: 'nigeria lagos abuja naira ngn', defaultRate: 1650 },
  { code: 'KES', name: 'Kenyan Shilling', country: 'Kenya', keywords: 'kenya nairobi shilling kes', defaultRate: 129 },
  { code: 'GHS', name: 'Ghanaian Cedi', country: 'Ghana', keywords: 'ghana accra cedi ghs', defaultRate: 16.0 },
  { code: 'TZS', name: 'Tanzanian Shilling', country: 'Tanzania', keywords: 'tanzania dodoma dar es salaam shilling tzs', defaultRate: 2660 },
  { code: 'UGX', name: 'Ugandan Shilling', country: 'Uganda', keywords: 'uganda kampala shilling ugx', defaultRate: 3670 },
  { code: 'ETB', name: 'Ethiopian Birr', country: 'Etiopia', keywords: 'etiopia ethiopia addis ababa birr etb', defaultRate: 122 },
  { code: 'RWF', name: 'Rwandan Franc', country: 'Rwanda', keywords: 'rwanda kigali franc rwf', defaultRate: 1370 },
  { code: 'BIF', name: 'Burundian Franc', country: 'Burundi', keywords: 'burundi gitega franc bif', defaultRate: 2900 },
  { code: 'DJF', name: 'Djiboutian Franc', country: 'Djibouti', keywords: 'djibouti franc djf', defaultRate: 177.7 },
  { code: 'ERN', name: 'Eritrean Nakfa', country: 'Eritrea', keywords: 'eritrea asmara nakfa ern', defaultRate: 15 },
  { code: 'SOS', name: 'Somali Shilling', country: 'Somalia', keywords: 'somalia mogadishu shilling sos', defaultRate: 571 },
  { code: 'SDG', name: 'Sudanese Pound', country: 'Sudan', keywords: 'sudan khartoum pound sdg', defaultRate: 601 },
  { code: 'SSP', name: 'South Sudanese Pound', country: 'Sudan Selatan', keywords: 'sudan selatan south sudan juba pound ssp', defaultRate: 130 },
  { code: 'MRU', name: 'Mauritanian Ouguiya', country: 'Mauritania', keywords: 'mauritania nouakchott ouguiya mru', defaultRate: 39.7 },
  { code: 'GMD', name: 'Gambian Dalasi', country: 'Gambia', keywords: 'gambia banjul dalasi gmd', defaultRate: 71 },
  { code: 'GNF', name: 'Guinean Franc', country: 'Guinea', keywords: 'guinea conakry franc gnf', defaultRate: 8600 },
  { code: 'SLE', name: 'Sierra Leonean Leone', country: 'Sierra Leone', keywords: 'sierra leone freetown leone sle', defaultRate: 22.6 },
  { code: 'SLL', name: 'Sierra Leonean Leone (Old)', country: 'Sierra Leone', keywords: 'sierra leone freetown leone sll', defaultRate: 22600 },
  { code: 'LRD', name: 'Liberian Dollar', country: 'Liberia', keywords: 'liberia monrovia dollar lrd', defaultRate: 190 },
  { code: 'CVE', name: 'Cape Verdean Escudo', country: 'Tanjung Verde', keywords: 'tanjung verde cape verde cabo verde escudo cve', defaultRate: 103.5 },
  { code: 'STN', name: 'Sao Tome Dobra', country: 'Sao Tome & Principe', keywords: 'sao tome principe dobra stn', defaultRate: 23 },
  { code: 'KMF', name: 'Comorian Franc', country: 'Komoro', keywords: 'komoro comoros moroni franc kmf', defaultRate: 462 },
  { code: 'SCR', name: 'Seychellois Rupee', country: 'Seychelles', keywords: 'seychelles victoria rupee scr', defaultRate: 13.8 },
  { code: 'MUR', name: 'Mauritian Rupee', country: 'Mauritius', keywords: 'mauritius port louis rupee mur', defaultRate: 46.5 },
  { code: 'MGA', name: 'Malagasy Ariary', country: 'Madagaskar', keywords: 'madagaskar madagascar antananarivo ariary mga', defaultRate: 4650 },
  { code: 'MWK', name: 'Malawian Kwacha', country: 'Malawi', keywords: 'malawi lilongwe kwacha mwk', defaultRate: 1734 },

  { code: 'ZMW', name: 'Zambian Kwacha', country: 'Zambia', keywords: 'zambia lusaka kwacha zmw', defaultRate: 27.1 },
  { code: 'BWP', name: 'Botswanan Pula', country: 'Botswana', keywords: 'botswana gaborone pula bwp', defaultRate: 13.5 },
  { code: 'NAD', name: 'Namibian Dollar', country: 'Namibia', keywords: 'namibia windhoek dollar nad', defaultRate: 18.1 },
  { code: 'SZL', name: 'Swazi Lilangeni', country: 'Eswatini', keywords: 'eswatini swaziland mbabane lilangeni szl', defaultRate: 18.1 },
  { code: 'LSL', name: 'Lesotho Loti', country: 'Lesotho', keywords: 'lesotho maseru loti lsl', defaultRate: 18.1 },
  { code: 'MZN', name: 'Mozambican Metical', country: 'Mozambik', keywords: 'mozambik mozambique maputo metical mzn', defaultRate: 63.9 },
  { code: 'AOA', name: 'Angolan Kwanza', country: 'Angola', keywords: 'angola luanda kwanza aoa', defaultRate: 912 },
  { code: 'CDF', name: 'Congolese Franc', country: 'Kongo (RDK)', keywords: 'kongo congo kinshasa franc cdf', defaultRate: 2850 },
  { code: 'XOF', name: 'West African CFA Franc', country: 'Afrika Barat', keywords: 'afrika barat senegal pantai gading mali benin cfa franc xof', defaultRate: 615 },
  { code: 'XAF', name: 'Central African CFA Franc', country: 'Afrika Tengah', keywords: 'afrika tengah kamerun gabon cfa franc xaf', defaultRate: 615 },
  { code: 'ARS', name: 'Argentine Peso', country: 'Argentina', keywords: 'argentina buenos aires peso ars', defaultRate: 1000 },
  { code: 'CLP', name: 'Chilean Peso', country: 'Chili', keywords: 'chili chile santiago peso clp', defaultRate: 970 },
  { code: 'COP', name: 'Colombian Peso', country: 'Kolombia', keywords: 'kolombia colombia bogota peso cop', defaultRate: 4400 },
  { code: 'PEN', name: 'Peruvian Sol', country: 'Peru', keywords: 'peru lima sol pen', defaultRate: 3.78 },
  { code: 'UYU', name: 'Uruguayan Peso', country: 'Uruguay', keywords: 'uruguay montevideo peso uyu', defaultRate: 42.3 },
  { code: 'PYG', name: 'Paraguayan Guarani', country: 'Paraguay', keywords: 'paraguay asuncion guarani pyg', defaultRate: 7800 },
  { code: 'BOB', name: 'Bolivian Boliviano', country: 'Bolivia', keywords: 'bolivia la paz boliviano bob', defaultRate: 6.91 },
  { code: 'VES', name: 'Venezuelan Bolivar', country: 'Venezuela', keywords: 'venezuela caracas bolivar ves', defaultRate: 45 },
  { code: 'CRC', name: 'Costa Rican Colon', country: 'Kosta Rika', keywords: 'kosta rika costa rica san jose colon crc', defaultRate: 512 },
  { code: 'GTQ', name: 'Guatemalan Quetzal', country: 'Guatemala', keywords: 'guatemala quetzal gtq', defaultRate: 7.72 },
  { code: 'HNL', name: 'Honduran Lempira', country: 'Honduras', keywords: 'honduras tegucigalpa lempira hnl', defaultRate: 25.2 },
  { code: 'NIO', name: 'Nicaraguan Cordoba', country: 'Nikaragua', keywords: 'nikaragua nicaragua managua cordoba nio', defaultRate: 36.8 },
  { code: 'PAB', name: 'Panamanian Balboa', country: 'Panama', keywords: 'panama balboa pab', defaultRate: 1 },
  { code: 'DOP', name: 'Dominican Peso', country: 'Republik Dominika', keywords: 'dominika dominican santo domingo peso dop', defaultRate: 60.2 },
  { code: 'JMD', name: 'Jamaican Dollar', country: 'Jamaika', keywords: 'jamaika jamaica kingston dollar jmd', defaultRate: 158 },

  { code: 'TTD', name: 'Trinidad & Tobago Dollar', country: 'Trinidad & Tobago', keywords: 'trinidad tobago dollar ttd', defaultRate: 6.78 },
  { code: 'BBD', name: 'Barbadian Dollar', country: 'Barbados', keywords: 'barbados dollar bbd', defaultRate: 2 },
  { code: 'BSD', name: 'Bahamian Dollar', country: 'Bahama', keywords: 'bahama bahamas nassau dollar bsd', defaultRate: 1 },
  { code: 'BZD', name: 'Belize Dollar', country: 'Belize', keywords: 'belize dollar bzd', defaultRate: 2 },
  { code: 'HTG', name: 'Haitian Gourde', country: 'Haiti', keywords: 'haiti port au prince gourde htg', defaultRate: 131 },
  { code: 'GYD', name: 'Guyanese Dollar', country: 'Guyana', keywords: 'guyana georgetown dollar gyd', defaultRate: 209 },
  { code: 'SRD', name: 'Surinamese Dollar', country: 'Suriname', keywords: 'suriname paramaribo dollar srd', defaultRate: 35 },
  { code: 'XCD', name: 'East Caribbean Dollar', country: 'Karibia Timur', keywords: 'karibia east caribbean dollar xcd', defaultRate: 2.7 },
  { code: 'AWG', name: 'Aruban Florin', country: 'Aruba', keywords: 'aruba florin awg', defaultRate: 1.79 },
  { code: 'ANG', name: 'Netherlands Antillean Guilder', country: 'Curacao & Sint Maarten', keywords: 'curacao antilles guilder ang', defaultRate: 1.79 },
  { code: 'KYD', name: 'Cayman Islands Dollar', country: 'Kepulauan Cayman', keywords: 'cayman islands dollar kyd', defaultRate: 0.83 },
  { code: 'BMD', name: 'Bermudian Dollar', country: 'Bermuda', keywords: 'bermuda dollar bmd', defaultRate: 1 },
  { code: 'CUP', name: 'Cuban Peso', country: 'Kuba', keywords: 'kuba cuba havana peso cup', defaultRate: 24 },
  { code: 'CUC', name: 'Cuban Convertible Peso', country: 'Kuba', keywords: 'kuba cuba convertible peso cuc', defaultRate: 1 },
  { code: 'FJD', name: 'Fijian Dollar', country: 'Fiji', keywords: 'fiji suva dollar fjd', defaultRate: 2.26 },
  { code: 'PGK', name: 'Papua New Guinean Kina', country: 'Papua Nugini', keywords: 'papua nugini papua new guinea port moresby kina pgk', defaultRate: 4.02 },
  { code: 'SBD', name: 'Solomon Islands Dollar', country: 'Kepulauan Solomon', keywords: 'solomon islands dollar sbd', defaultRate: 8.45 },
  { code: 'VUV', name: 'Vanuatu Vatu', country: 'Vanuatu', keywords: 'vanuatu port vila vatu vuv', defaultRate: 120 },
  { code: 'WST', name: 'Samoan Tala', country: 'Samoa', keywords: 'samoa apia tala wst', defaultRate: 2.75 },
  { code: 'TOP', name: 'Tongan Paanga', country: 'Tonga', keywords: 'tonga paanga top', defaultRate: 2.38 },
  { code: 'XPF', name: 'CFP Franc', country: 'Polinesia Prancis', keywords: 'tahiti polinesia new caledonia cfp franc xpf', defaultRate: 112 },
  { code: 'CLF', name: 'Chilean Unit of Account (UF)', country: 'Chili', keywords: 'chili chile unidad fomento clf', defaultRate: 0.025 },
  { code: 'TVD', name: 'Tuvaluan Dollar', country: 'Tuvalu', keywords: 'tuvalu dollar tvd', defaultRate: 1.53 },
  { code: 'KID', name: 'Kiribati Dollar', country: 'Kiribati', keywords: 'kiribati dollar kid', defaultRate: 1.53 },
  { code: 'ZWG', name: 'Zimbabwe Gold', country: 'Zimbabwe', keywords: 'zimbabwe harare gold zig zwg', defaultRate: 25.5 },
];

const CURRENCY_META_MAP = new Map<string, CurrencyMetadata>(
  WORLD_CURRENCY_CATALOG.map((item) => [item.code, item])
);

export const DEFAULT_USD_EXCHANGE_RATES: Record<string, number> = WORLD_CURRENCY_CATALOG.reduce(
  (acc, item) => {
    acc[item.code] = item.defaultRate;
    return acc;
  },
  {} as Record<string, number>
);

export function getCurrencyMeta(code: string): CurrencyMetadata {
  const upper = code.trim().toUpperCase();
  const known = CURRENCY_META_MAP.get(upper);
  if (known) return known;
  return {
    code: upper,
    name: upper,
    country: 'Mata Uang Dunia',
    keywords: upper.toLowerCase(),
    defaultRate: 1,
  };
}

export function searchCurrencies(
  query: string,
  rates?: Record<string, number>
): CurrencyMetadata[] {
  const combinedMap = new Map<string, CurrencyMetadata>();
  for (const item of WORLD_CURRENCY_CATALOG) {
    combinedMap.set(item.code, item);
  }
  if (rates) {
    for (const rawCode of Object.keys(rates)) {
      const upper = rawCode.trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(upper) && !combinedMap.has(upper)) {
        combinedMap.set(upper, getCurrencyMeta(upper));
      }
    }
  }

  const allItems = Array.from(combinedMap.values());
  const q = query.trim().toLowerCase();

  if (!q) {
    return allItems.sort((a, b) => {
      const rankA = POPULAR_ORDER_MAP.get(a.code) ?? Number.MAX_SAFE_INTEGER;
      const rankB = POPULAR_ORDER_MAP.get(b.code) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.code.localeCompare(b.code);
    });
  }

  const scored: Array<{ item: CurrencyMetadata; score: number }> = [];
  for (const item of allItems) {
    const codeL = item.code.toLowerCase();
    const countryL = item.country.toLowerCase();
    const nameL = item.name.toLowerCase();
    const kwL = item.keywords.toLowerCase();

    let score = -1;
    if (codeL === q) {
      score = 0;
    } else if (codeL.startsWith(q)) {
      score = 1;
    } else if (countryL.startsWith(q) || nameL.startsWith(q)) {
      score = 2;
    } else if (
      kwL.split(/\s+/).some((word) => word.startsWith(q)) ||
      countryL.split(/\s+/).some((word) => word.startsWith(q))
    ) {
      score = 3;
    } else if (
      codeL.includes(q) ||
      countryL.includes(q) ||
      nameL.includes(q) ||
      kwL.includes(q)
    ) {
      score = 4;
    }

    if (score >= 0) {
      scored.push({ item, score });
    }
  }

  return scored
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const rankA = POPULAR_ORDER_MAP.get(a.item.code) ?? Number.MAX_SAFE_INTEGER;
      const rankB = POPULAR_ORDER_MAP.get(b.item.code) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.item.code.localeCompare(b.item.code);
    })
    .map((entry) => entry.item);
}

export const CONVERTER_CATEGORIES: ConverterCategoryMeta[] = [
  {
    id: 'currency',
    label: 'Kurs',
    defaultFrom: 'USD',
    defaultTo: 'IDR',
    units: WORLD_CURRENCY_CATALOG.map((c) => ({
      id: c.code,
      label: `${c.code} · ${c.country}`,
      shortLabel: c.code,
    })),
  },
  {
    id: 'length',
    label: 'Panjang',
    defaultFrom: 'm',
    defaultTo: 'cm',
    units: [
      { id: 'mm', label: 'Milimeter (mm)', shortLabel: 'mm' },
      { id: 'cm', label: 'Sentimeter (cm)', shortLabel: 'cm' },
      { id: 'm', label: 'Meter (m)', shortLabel: 'm' },
      { id: 'km', label: 'Kilometer (km)', shortLabel: 'km' },
      { id: 'in', label: 'Inci (in)', shortLabel: 'in' },
      { id: 'ft', label: 'Kaki (ft)', shortLabel: 'ft' },
      { id: 'mi', label: 'Mil (mi)', shortLabel: 'mi' },
    ],
  },
  {
    id: 'mass',
    label: 'Massa',
    defaultFrom: 'kg',
    defaultTo: 'g',
    units: [
      { id: 'mg', label: 'Miligram (mg)', shortLabel: 'mg' },
      { id: 'g', label: 'Gram (g)', shortLabel: 'g' },
      { id: 'kg', label: 'Kilogram (kg)', shortLabel: 'kg' },
      { id: 'oz', label: 'Ons (oz)', shortLabel: 'oz' },
      { id: 'lb', label: 'Pon (lb)', shortLabel: 'lb' },
    ],
  },
  {
    id: 'temperature',
    label: 'Suhu',
    defaultFrom: 'C',
    defaultTo: 'F',
    units: [
      { id: 'C', label: 'Celsius (°C)', shortLabel: '°C' },
      { id: 'F', label: 'Fahrenheit (°F)', shortLabel: '°F' },
      { id: 'K', label: 'Kelvin (K)', shortLabel: 'K' },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    defaultFrom: 'GB',
    defaultTo: 'MB',
    units: [
      { id: 'B', label: 'Byte (B)', shortLabel: 'B' },
      { id: 'KB', label: 'Kilobyte (KB)', shortLabel: 'KB' },
      { id: 'MB', label: 'Megabyte (MB)', shortLabel: 'MB' },
      { id: 'GB', label: 'Gigabyte (GB)', shortLabel: 'GB' },
      { id: 'KiB', label: 'Kibibyte (KiB)', shortLabel: 'KiB' },
      { id: 'MiB', label: 'Mebibyte (MiB)', shortLabel: 'MiB' },
      { id: 'GiB', label: 'Gibibyte (GiB)', shortLabel: 'GiB' },
    ],
  },
  {
    id: 'timezone',
    label: 'Waktu',
    defaultFrom: 'WIB',
    defaultTo: 'UTC',
    units: [
      { id: 'WIB', label: 'WIB (UTC+7)', shortLabel: 'WIB' },
      { id: 'WITA', label: 'WITA (UTC+8)', shortLabel: 'WITA' },
      { id: 'WIT', label: 'WIT (UTC+9)', shortLabel: 'WIT' },
      { id: 'UTC', label: 'UTC (UTC+0)', shortLabel: 'UTC' },
    ],
  },
];

// Base units: Length -> meter, Mass -> gram, Data -> byte
const LENGTH_TO_METERS: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  mi: 1609.344,
};

const MASS_TO_GRAMS: Record<string, number> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

const DATA_TO_BYTES: Record<string, number> = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
};

export const TIMEZONE_UTC_OFFSETS: Record<string, number> = {
  WIB: 7,
  WITA: 8,
  WIT: 9,
  UTC: 0,
};

export const FX_CACHE_TTL_MS = 30 * 60 * 1000;

export interface CachedExchangeRates {
  rates: Record<string, number>;
  updatedAt: string | null;
  source: string;
  isLive?: boolean;
}

const FX_CACHE_STORAGE_KEY_V2 = 'casa_fx_rates_cache_v2';
const FX_CACHE_STORAGE_KEY_V1 = 'casa_fx_rates_cache_v1';
const MAX_SANITIZED_RATES = 250;

export function sanitizeCurrencyRates(
  raw: Record<string, unknown> | null | undefined
): Record<string, number> {
  const out: Record<string, number> = { ...DEFAULT_USD_EXCHANGE_RATES };
  if (!raw || typeof raw !== 'object') return out;

  for (const [rawCode, candidate] of Object.entries(raw)) {
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || code === 'USD') {
      continue;
    }
    if (Object.keys(out).length >= MAX_SANITIZED_RATES && !(code in out)) {
      continue;
    }
    if (
      typeof candidate === 'number' &&
      Number.isFinite(candidate) &&
      candidate > 0 &&
      candidate < 1_000_000_000
    ) {
      out[code] = candidate;
    }
  }
  out.USD = 1;
  return out;
}

export function isExchangeRateCacheStale(
  cache: CachedExchangeRates,
  nowMs = Date.now()
): boolean {
  if (!cache.updatedAt || !cache.isLive) return true;
  const parsed = Date.parse(cache.updatedAt);
  if (Number.isNaN(parsed)) return true;
  return nowMs - parsed > FX_CACHE_TTL_MS;
}

function formatClockTimeHHMM(isoStr: string | null): string | null {
  if (!isoStr) return null;
  const parsed = Date.parse(isoStr);
  if (Number.isNaN(parsed)) return null;
  const dt = new Date(parsed);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatFxStatusBadge(
  cache: CachedExchangeRates,
  isLoading: boolean,
  isOfflineError: boolean
): { label: string; isLive: boolean } {
  if (isLoading) {
    return { label: 'Memuat kurs...', isLive: false };
  }
  const hhmm = formatClockTimeHHMM(cache.updatedAt);
  if (!isOfflineError && cache.isLive && hhmm) {
    return { label: `Live · ${hhmm}`, isLive: true };
  }
  if (hhmm) {
    return { label: `Offline Cache · ${hhmm}`, isLive: false };
  }
  return { label: 'Offline Cache', isLive: false };
}

export function loadCachedExchangeRates(): CachedExchangeRates {
  const fallback: CachedExchangeRates = {
    rates: { ...DEFAULT_USD_EXCHANGE_RATES },
    updatedAt: null,
    source: 'Offline Cache',
    isLive: false,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw =
      window.localStorage.getItem(FX_CACHE_STORAGE_KEY_V2) ||
      window.localStorage.getItem(FX_CACHE_STORAGE_KEY_V1);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<CachedExchangeRates>;
    const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null;
    const isLive = Boolean(parsed.isLive ?? updatedAt);
    return {
      rates: sanitizeCurrencyRates(parsed.rates as Record<string, unknown>),
      updatedAt,
      source: typeof parsed.source === 'string' && parsed.source ? parsed.source : 'Offline Cache',
      isLive,
    };
  } catch {
    return fallback;
  }
}

export function saveCachedExchangeRates(data: CachedExchangeRates): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FX_CACHE_STORAGE_KEY_V2, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

export function convertLinearUnit(
  value: number,
  fromUnit: string,
  toUnit: string,
  table: Record<string, number>
): number | null {
  if (!Number.isFinite(value)) return null;
  const fromFactor = table[fromUnit];
  const toFactor = table[toUnit];
  if (!fromFactor || !toFactor) return null;
  return normalizeDecimalPrecision((value * fromFactor) / toFactor);
}

export function convertTemperature(value: number, fromUnit: string, toUnit: string): number | null {
  if (!Number.isFinite(value)) return null;
  let celsius: number;
  if (fromUnit === 'C') {
    celsius = value;
  } else if (fromUnit === 'F') {
    celsius = ((value - 32) * 5) / 9;
  } else if (fromUnit === 'K') {
    celsius = value - 273.15;
  } else {
    return null;
  }

  let out: number;
  if (toUnit === 'C') {
    out = celsius;
  } else if (toUnit === 'F') {
    out = (celsius * 9) / 5 + 32;
  } else if (toUnit === 'K') {
    out = celsius + 273.15;
  } else {
    return null;
  }
  return normalizeDecimalPrecision(out);
}

export function convertTimezoneValue(
  rawInput: string,
  fromTz: string,
  toTz: string
): { formatted: string; copyText: string; dayDelta: number } | null {
  const fromOffset = TIMEZONE_UTC_OFFSETS[fromTz];
  const toOffset = TIMEZONE_UTC_OFFSETS[toTz];
  if (typeof fromOffset !== 'number' || typeof toOffset !== 'number') return null;

  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  let hours = 0;
  let minutes = 0;
  const hhmm = /^(\d{1,2})[:.](\d{2})$/.exec(trimmed);
  if (hhmm) {
    hours = Number(hhmm[1]);
    minutes = Number(hhmm[2]);
    if (hours > 23 || minutes > 59) return null;
  } else {
    const dec = Number(trimmed);
    if (!Number.isFinite(dec) || dec < 0 || dec >= 24) return null;
    hours = Math.floor(dec);
    minutes = Math.round((dec - hours) * 60);
    if (minutes === 60) {
      hours = (hours + 1) % 24;
      minutes = 0;
    }
  }

  const totalMin = hours * 60 + minutes + (toOffset - fromOffset) * 60;
  let dayDelta = 0;
  let wrappedMin = totalMin;
  while (wrappedMin < 0) {
    wrappedMin += 1440;
    dayDelta -= 1;
  }
  while (wrappedMin >= 1440) {
    wrappedMin -= 1440;
    dayDelta += 1;
  }

  const outH = String(Math.floor(wrappedMin / 60)).padStart(2, '0');
  const outM = String(wrappedMin % 60).padStart(2, '0');
  const daySuffix = dayDelta > 0 ? ` (+${dayDelta}h)` : dayDelta < 0 ? ` (${dayDelta}h)` : '';
  const timeText = `${outH}:${outM} ${toTz}`;
  return {
    formatted: `${timeText}${daySuffix}`,
    copyText: timeText,
    dayDelta,
  };
}

export function convertCurrencyAmount(
  amount: number,
  fromCode: string,
  toCode: string,
  rates: Record<string, number> = DEFAULT_USD_EXCHANGE_RATES
): number | null {
  if (!Number.isFinite(amount)) return null;
  const fromRate = rates[fromCode.toUpperCase()];
  const toRate = rates[toCode.toUpperCase()];
  if (!fromRate || !toRate || fromRate <= 0 || toRate <= 0) return null;
  const inUsd = amount / fromRate;
  return normalizeDecimalPrecision(inUsd * toRate);
}

export function convertValueByCategory(
  category: ConverterCategoryId,
  rawInput: string,
  fromUnit: string,
  toUnit: string,
  currencyRates: Record<string, number> = DEFAULT_USD_EXCHANGE_RATES
): { formatted: string; copyText: string } | null {
  if (category === 'timezone') {
    const res = convertTimezoneValue(rawInput, fromUnit, toUnit);
    return res ? { formatted: res.formatted, copyText: res.copyText } : null;
  }

  const normalized = rawInput.replace(/,/g, '').trim();
  if (!normalized) return null;
  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;

  let result: number | null = null;
  switch (category) {
    case 'length':
      result = convertLinearUnit(num, fromUnit, toUnit, LENGTH_TO_METERS);
      break;
    case 'mass':
      result = convertLinearUnit(num, fromUnit, toUnit, MASS_TO_GRAMS);
      break;
    case 'temperature':
      result = convertTemperature(num, fromUnit, toUnit);
      break;
    case 'data':
      result = convertLinearUnit(num, fromUnit, toUnit, DATA_TO_BYTES);
      break;
    case 'currency':
      result = convertCurrencyAmount(num, fromUnit, toUnit, currencyRates);
      break;
  }

  if (result === null || !Number.isFinite(result)) return null;

  if (category === 'currency') {
    const upperTo = toUnit.toUpperCase();
    const decimals = ZERO_DECIMAL_CURRENCIES.has(upperTo)
      ? 0
      : THREE_DECIMAL_CURRENCIES.has(upperTo)
      ? 3
      : 2;
    const formatted = `${result.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    })} ${upperTo}`;
    return {
      formatted,
      copyText: Number(result.toFixed(decimals)).toString(),
    };
  }

  const { formatted, copyText } = formatCalcNumber(result);
  const unitMeta = CONVERTER_CATEGORIES.find((c) => c.id === category)?.units.find(
    (u) => u.id === toUnit
  );
  const suffix = unitMeta ? ` ${unitMeta.shortLabel}` : ` ${toUnit}`;
  return {
    formatted: `${formatted}${suffix}`,
    copyText,
  };
}
