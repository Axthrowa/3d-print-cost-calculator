/** Sinif adlarini birlestirir (falsy degerleri atar). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
