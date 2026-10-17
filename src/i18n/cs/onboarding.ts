// Texts of the welcome screens shown on the first start. The polish task owns this file and may extend it.
// Keep the named export `onboarding` and `as const`. {appName} is filled in by t() automatically.

export const onboarding = {
  title: 'Vítej v {appName}',
  subtitle: 'Tvůj kapesní ptačí Dex',
  intro: 'Poznáš ptáky podle hlasu i podle fotky a každého, kterého potvrdíš, přidáš do sbírky.',
  start: 'Začít',
  next: 'Dál',
  skip: 'Přeskočit',
  privacy: 'Všechno se děje přímo v telefonu. Žádné účty, žádné sledování.',
} as const
