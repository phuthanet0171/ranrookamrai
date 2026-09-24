// Display names for keys that come from the database.
// Olist keys are English snake_case categories and Brazilian state codes; an imported
// Thai file already has Thai names, so anything not in these maps is shown as-is.
import type { Lang } from "./types";
import { prettyLabel } from "./format";

export const CATEGORY_TH: Record<string, string> = {
  agro_industry_and_commerce: "เกษตรและการค้า",
  air_conditioning: "เครื่องปรับอากาศ",
  art: "ศิลปะ",
  arts_and_craftmanship: "งานศิลปะและงานฝีมือ",
  audio: "เครื่องเสียง",
  auto: "ยานยนต์",
  baby: "แม่และเด็ก",
  bed_bath_table: "เครื่องนอนและของใช้ในห้องน้ำ",
  books_general_interest: "หนังสือทั่วไป",
  books_imported: "หนังสือนำเข้า",
  books_technical: "หนังสือวิชาการ",
  cds_dvds_musicals: "ซีดีและดีวีดีเพลง",
  christmas_supplies: "ของตกแต่งคริสต์มาส",
  cine_photo: "กล้องและอุปกรณ์ถ่ายภาพ",
  computers: "คอมพิวเตอร์",
  computers_accessories: "อุปกรณ์คอมพิวเตอร์",
  consoles_games: "เกมและเครื่องเล่นเกม",
  construction_tools_construction: "เครื่องมือก่อสร้าง",
  construction_tools_lights: "โคมไฟและอุปกรณ์แสงสว่าง",
  construction_tools_safety: "อุปกรณ์นิรภัยงานก่อสร้าง",
  costruction_tools_garden: "เครื่องมือช่างสำหรับสวน",
  costruction_tools_tools: "เครื่องมือช่าง",
  cool_stuff: "ของเก๋ไก๋",
  diapers_and_hygiene: "ผ้าอ้อมและสุขอนามัย",
  drinks: "เครื่องดื่ม",
  dvds_blu_ray: "ดีวีดีและบลูเรย์",
  electronics: "อิเล็กทรอนิกส์",
  fashio_female_clothing: "เสื้อผ้าผู้หญิง",
  fashion_bags_accessories: "กระเป๋าและเครื่องประดับ",
  fashion_childrens_clothes: "เสื้อผ้าเด็ก",
  fashion_male_clothing: "เสื้อผ้าผู้ชาย",
  fashion_shoes: "รองเท้า",
  fashion_sport: "ชุดกีฬา",
  fashion_underwear_beach: "ชุดชั้นในและชุดว่ายน้ำ",
  fixed_telephony: "โทรศัพท์บ้าน",
  flowers: "ดอกไม้",
  food: "อาหาร",
  food_drink: "อาหารและเครื่องดื่ม",
  furniture_bedroom: "เฟอร์นิเจอร์ห้องนอน",
  furniture_decor: "เฟอร์นิเจอร์และของตกแต่งบ้าน",
  furniture_living_room: "เฟอร์นิเจอร์ห้องนั่งเล่น",
  furniture_mattress_and_upholstery: "ที่นอนและเบาะ",
  garden_tools: "อุปกรณ์ทำสวน",
  health_beauty: "สุขภาพและความงาม",
  home_appliances: "เครื่องใช้ไฟฟ้าในบ้าน",
  home_appliances_2: "เครื่องใช้ไฟฟ้าในบ้าน (2)",
  home_comfort_2: "ของใช้ในบ้าน (2)",
  home_confort: "ของใช้ในบ้าน",
  home_construction: "วัสดุก่อสร้างบ้าน",
  housewares: "ของใช้ในครัวเรือน",
  industry_commerce_and_business: "อุตสาหกรรมและธุรกิจ",
  kitchen_dining_laundry_garden_furniture: "เฟอร์นิเจอร์ครัว ซักรีด และสวน",
  la_cuisine: "เครื่องครัว",
  luggage_accessories: "กระเป๋าเดินทาง",
  market_place: "สินค้าจากร้านค้าในตลาด",
  music: "ดนตรี",
  musical_instruments: "เครื่องดนตรี",
  office_furniture: "เฟอร์นิเจอร์สำนักงาน",
  party_supplies: "อุปกรณ์งานเลี้ยง",
  perfumery: "น้ำหอม",
  pet_shop: "สินค้าสัตว์เลี้ยง",
  portable_kitchen_food_processors: "เครื่องเตรียมอาหารขนาดเล็ก",
  pc_gamer: "คอมพิวเตอร์เกมมิ่ง",
  security_and_services: "ความปลอดภัยและบริการ",
  signaling_and_security: "ป้ายและอุปกรณ์รักษาความปลอดภัย",
  small_appliances: "เครื่องใช้ไฟฟ้าขนาดเล็ก",
  small_appliances_home_oven_and_coffee: "เตาอบและเครื่องชงกาแฟ",
  sports_leisure: "กีฬาและนันทนาการ",
  stationery: "เครื่องเขียน",
  tablets_printing_image: "แท็บเล็ตและงานพิมพ์",
  telephony: "โทรศัพท์มือถือและอุปกรณ์",
  toys: "ของเล่น",
  watches_gifts: "นาฬิกาและของขวัญ",
  unknown: "ไม่ระบุหมวด",
};

// Brazilian states (Olist). Thai spelling follows common Thai transliteration.
export const STATE_TH: Record<string, string> = {
  AC: "อากรี", AL: "อาลาโกอัส", AM: "อามาโซนัส", AP: "อามาปา", BA: "บาเอีย", CE: "เซอารา",
  DF: "บราซิเลีย (เขตสหพันธ์)", ES: "เอสปีรีตูซานตู", GO: "โกยาส", MA: "มารานเยา", MG: "มีนัสเจไรส์",
  MS: "มาตูโกรสซูดูซูล", MT: "มาตูโกรสซู", PA: "ปารา", PB: "ปาราอีบา", PE: "เปร์นัมบูกู", PI: "ปีเอาอี",
  PR: "ปารานา", RJ: "รีโอเดจาเนโร", RN: "รีโอกรันดีดูนอร์ตี", RO: "โรนโดเนีย", RR: "โรไรมา",
  RS: "รีโอกรันดีดูซูล", SC: "ซานตากาตารีนา", SE: "เซร์จีปี", SP: "เซาเปาลู", TO: "โตกันชินส์",
};

export const TIME_BLOCK_TH: Record<string, string> = {
  "Night (00-05)": "กลางคืน (00–05 น.)",
  "Morning (06-11)": "ช่วงเช้า (06–11 น.)",
  "Afternoon (12-17)": "ช่วงบ่าย (12–17 น.)",
  "Evening (18-23)": "ช่วงค่ำ (18–23 น.)",
};

export const WEEKDAY_TH = ["", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"]; // 1 = Mon (ISO)
export const WEEKDAY_TH_SHORT = ["", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];

export const OTHER_TH = "อื่น ๆ";

export function categoryLabel(key: string, lang: Lang = "th"): string {
  if (key === "Other") return lang === "th" ? OTHER_TH : "Other";
  if (lang === "th") return CATEGORY_TH[key] ?? key;
  return /^[a-z0-9_]+$/.test(key) ? prettyLabel(key) : key;
}

export function regionLabel(key: string, lang: Lang = "th"): string {
  if (key === "Other") return lang === "th" ? OTHER_TH : "Other";
  if (lang === "th" && STATE_TH[key]) return `${STATE_TH[key]} (${key})`;
  return key;
}

export function timeBlockLabel(key: string, lang: Lang = "th"): string {
  return lang === "th" ? TIME_BLOCK_TH[key] ?? key : key;
}

/** Driver segments: dimension + key -> display name */
export function segmentLabel(dim: string, key: string, lang: Lang = "th"): string {
  if (dim === "category") return categoryLabel(key, lang);
  if (dim === "state") return regionLabel(key, lang);
  if (dim === "time_of_day") return timeBlockLabel(key, lang);
  return key;
}

/** Name of each driver dimension. `region` is what the data calls a region (รัฐ / สาขา). */
export function dimensionLabel(dim: string, lang: Lang, region = "รัฐของลูกค้า"): string {
  if (lang === "th") return dim === "category" ? "หมวดสินค้า" : dim === "state" ? region : "ช่วงเวลา";
  return dim === "category" ? "category" : dim === "state" ? (region === "รัฐของลูกค้า" ? "customer state" : "region") : "time of day";
}
