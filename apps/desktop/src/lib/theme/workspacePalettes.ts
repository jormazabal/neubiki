// sRGB values from docs/architecture/paletas-apariencia.md.
const toneNames = [
  "frame", "editor", "tools", "elevated", "divider", "border", "hover", "selected",
  "action", "actionHover", "pressed", "ink", "logo",
] as const;

export type SurfaceTones = Record<typeof toneNames[number], string>;
export type SurfaceMode = "light" | "dark";
type StringTuple<T extends readonly string[]> = { [Index in keyof T]: string };
type ToneValues = StringTuple<typeof toneNames>;

function palette(label: string, swatch: string, mark: string, light: ToneValues, dark: ToneValues) {
  const tones = (values: ToneValues) => Object.fromEntries(toneNames.map((name, i) => [name, values[i]])) as SurfaceTones;
  return { label, swatch, mark, light: tones(light), dark: tones(dark) };
}

export const workspacePalettes = {
  red: palette("Rojo", "#B73C37", "#FFFFFF",
    ["#F5E3E1", "#FFF9F8", "#FFF3F2", "#FFFDFD", "#ECDCDA", "#7F6865", "#F7DFDB", "#F8CFCA", "#9C4740", "#913D37", "#83342F", "#83342F", "#9C4740"],
    ["#1C0D0B", "#2E1F1D", "#2C1816", "#3C2826", "#443230", "#A58B88", "#4C302D", "#62342F", "#FA9E94", "#FFB0A7", "#EE9187", "#FFB0A7", "#AA5049"]),
  orange: palette("Naranja", "#F37021", "#000000",
    ["#F4E4DD", "#FFF9F7", "#FFF4EF", "#FFFDFD", "#EBDDD6", "#7E6A60", "#F5E0D6", "#F6D1C1", "#994C24", "#8E4219", "#803A11", "#803A11", "#994C24"],
    ["#1B0E08", "#2E201A", "#2B1911", "#3B2921", "#44332C", "#A38D83", "#4A3226", "#603722", "#F6A37C", "#FFB38F", "#EA966E", "#FFB38F", "#A6562D"]),
  amber: palette("Ámbar", "#BD850C", "#000000",
    ["#F0E7DA", "#FEFAF4", "#FDF5EB", "#FFFDFB", "#E7DFD3", "#786D5B", "#EFE3D1", "#EBD7B8", "#855C00", "#795300", "#6C4A00", "#6C4A00", "#855C00"],
    ["#181005", "#2A2216", "#271C0C", "#362C1D", "#3F3628", "#9D907D", "#44361F", "#563E13", "#E1B162", "#EDBF76", "#D6A553", "#EDBF76", "#936600"]),
  yellow: palette("Amarillo", "#C5A823", "#000000",
    ["#ECE8DA", "#FCFBF4", "#FAF7EB", "#FFFEFA", "#E3E0D3", "#746F5B", "#EAE5D1", "#E3DBB8", "#776300", "#6C5A00", "#605000", "#605000", "#776300"],
    ["#151105", "#272416", "#231E0C", "#332E1D", "#3C3828", "#98927D", "#3F381F", "#4D4212", "#D0BA61", "#DCC775", "#C4AD51", "#DCC775", "#836E00"]),
  olive: palette("Oliva", "#647B2C", "#FFFFFF",
    ["#E5EBDC", "#F9FCF5", "#F4F8ED", "#FDFEFB", "#DDE2D5", "#6B725F", "#E1E8D5", "#D4E0BE", "#586E1E", "#4F6510", "#455A00", "#455A00", "#586E1E"],
    ["#0F1407", "#212619", "#1B2110", "#2B3120", "#343A2B", "#8E9681", "#343C24", "#3B481E", "#ACC677", "#B9D386", "#A0BA6B", "#B9D386", "#637A2B"]),
  green: palette("Verde", "#328047", "#FFFFFF",
    ["#DFECE1", "#F7FDF8", "#EFFAF1", "#FCFFFC", "#D8E4DA", "#637465", "#D9EADB", "#C5E3CA", "#29763F", "#1D6C35", "#14612E", "#14612E", "#29763F"],
    ["#09150B", "#1B271D", "#132316", "#233226", "#2E3C30", "#859888", "#293F2D", "#264D2F", "#85CF93", "#95DBA3", "#76C286", "#95DBA3", "#348249"]),
  teal: palette("Verde azulado", "#168477", "#000000",
    ["#DBEDE9", "#F5FDFB", "#EBFAF7", "#FAFFFE", "#D4E4E1", "#5C7570", "#D2EBE6", "#B9E5DD", "#007569", "#006A5F", "#005F55", "#005F55", "#007569"],
    ["#041513", "#162724", "#0A2320", "#1C332F", "#283C39", "#7E9994", "#1E3F3A", "#034E46", "#6FCEBF", "#7CDCCC", "#62C2B3", "#7CDCCC", "#0F8174"]),
  cyan: palette("Cian", "#2386A0", "#000000",
    ["#DAECF2", "#F5FCFF", "#EBF9FE", "#FCFEFF", "#D4E3E8", "#5C737B", "#D2EAF1", "#B9E2F0", "#007089", "#00667C", "#005B6F", "#005B6F", "#007089"],
    ["#041419", "#16262C", "#0A2229", "#1C3239", "#283B41", "#7E979F", "#1E3D47", "#064B5B", "#6EC9E4", "#7CD6F2", "#61BCD7", "#7CD6F2", "#117C96"]),
  blue: palette("Azul", "#3A69AE", "#FFFFFF",
    ["#E0E9F6", "#F8FBFF", "#F1F7FF", "#FDFEFF", "#D9E1EC", "#647080", "#DAE6F7", "#C7DCFA", "#3864A5", "#2F5A9A", "#27508D", "#27508D", "#3864A5"],
    ["#0A121D", "#1C242F", "#151F2D", "#252F3D", "#2F3846", "#8793A6", "#2B394E", "#2B4366", "#8FBCFF", "#A5C9FF", "#80B0F6", "#A5C9FF", "#416FB4"]),
  violet: palette("Violeta", "#7455AB", "#FFFFFF",
    ["#EAE6F4", "#FBFAFF", "#F7F5FF", "#FEFDFF", "#E1DEEB", "#716B7E", "#E7E1F5", "#DDD4F6", "#6E549D", "#644A92", "#594185", "#594185", "#6E549D"],
    ["#130F1C", "#25212E", "#201B2C", "#302B3B", "#393544", "#948EA3", "#3B344B", "#473A62", "#C3AAF9", "#CFBAFF", "#B79EED", "#CFBAFF", "#795EAB"]),
  magenta: palette("Magenta", "#A14688", "#FFFFFF",
    ["#F2E3ED", "#FFF9FD", "#FEF2FA", "#FFFDFE", "#E9DCE4", "#7B6874", "#F2DEEB", "#F0CFE4", "#8E487A", "#843E70", "#773665", "#773665", "#8E487A"],
    ["#190D15", "#2C1F27", "#281823", "#382833", "#41323C", "#A08B98", "#47303F", "#5A344E", "#EA9ED2", "#F5ADDE", "#DE91C6", "#F5ADDE", "#9C5186"]),
  wine: palette("Vino", "#8E304C", "#FFFFFF",
    ["#F5E3E6", "#FFF9FA", "#FFF3F5", "#FFFDFD", "#EBDBDE", "#7F686C", "#F6DEE2", "#F7CED5", "#99455B", "#8E3B52", "#813348", "#813348", "#99455B"],
    ["#1B0D10", "#2E1F22", "#2B181C", "#3B282C", "#443235", "#A48B8F", "#4B2F35", "#60333D", "#F79BB0", "#FFACBE", "#EB8EA3", "#FFACBE", "#A74E65"]),
};
