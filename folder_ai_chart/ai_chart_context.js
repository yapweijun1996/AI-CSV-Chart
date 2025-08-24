// Client context utilities for AI prompts
export function getCurrentUtcTime() {
  return new Date().toISOString();
}

export function getClientTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function getClientCountryFromLocale() {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const parts = locale.split('-');
  if (parts.length > 1) {
    return parts[parts.length - 1].toUpperCase();
  }
  return 'Unknown';
}

export function getClientContextPrompt() {
  const currentUtcTime = getCurrentUtcTime();
  const clientTimezone = getClientTimezone();
  const clientCountry = getClientCountryFromLocale();

  return `
Current Client Context:
- UTC Time: ${currentUtcTime}
- Timezone: ${clientTimezone}
- Country (from locale): ${clientCountry}
`;
}