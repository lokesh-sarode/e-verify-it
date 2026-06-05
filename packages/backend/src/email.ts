import isEmail from "validator/lib/isEmail";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmailSyntax(value: string): boolean {
  return isEmail(value, {
    allow_display_name: false,
    require_tld: true,
    allow_utf8_local_part: true,
    domain_specific_validation: false
  });
}

export function sanitizeFilename(value: string): string {
  return value
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

