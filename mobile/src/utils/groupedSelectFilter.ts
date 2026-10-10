export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectGroup = {
  label: string;
  options: SelectOption[];
  /** true: seçenekler yalnız arama yazılınca (cari gibi uzun listeler). */
  searchOnly?: boolean;
};

/** Arama kutusu tüm grupları süzer (eski davranış). */
export function filterGroups(groups: SelectGroup[], q: string): SelectGroup[] {
  const needle = q.trim().toLocaleLowerCase("tr-TR");
  if (!needle) return groups;
  return groups
    .map((g) => ({
      ...g,
      options: g.options.filter((o) => {
        const hay = `${g.label} ${o.label}`.toLocaleLowerCase("tr-TR");
        return hay.includes(needle);
      }),
    }))
    .filter((g) => g.options.length > 0);
}

/**
 * searchOnly gruplar: kasa/banka/ortak her zaman görünür; cari yalnız ≥minChars aramada.
 * Seçili cari boş aramada da kalır.
 */
export function visibleSelectGroups(
  groups: SelectGroup[],
  q: string,
  selectedValue = "",
  minChars = 2,
): SelectGroup[] {
  const hasSearchOnly = groups.some((g) => g.searchOnly);
  if (!hasSearchOnly) return filterGroups(groups, q);

  const needle = q.trim().toLocaleLowerCase("tr-TR");
  return groups.map((g) => {
    if (!g.searchOnly) return g;
    if (needle.length < minChars) {
      return {
        ...g,
        options: selectedValue ? g.options.filter((o) => o.value === selectedValue) : [],
      };
    }
    return {
      ...g,
      options: g.options.filter((o) => {
        if (o.value === selectedValue) return true;
        return `${g.label} ${o.label}`.toLocaleLowerCase("tr-TR").includes(needle);
      }),
    };
  });
}
