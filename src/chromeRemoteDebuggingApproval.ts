const chromeRemoteDebuggingPromptFragments = [
  '\uC6D0\uACA9 \uB514\uBC84\uAE45\uC744 \uD5C8\uC6A9\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?',
  'allow remote debugging',
  'do you want to allow remote debugging',
] as const;

const chromeRemoteDebuggingAllowButtonLabels = [
  '\uD5C8\uC6A9',
  'Allow',
] as const;

function normalizeUiText(text: string): string {
  return text.trim().toLowerCase();
}

export function matchesChromeRemoteDebuggingPrompt(text: string): boolean {
  const normalizedText = normalizeUiText(text);

  if (!normalizedText) {
    return false;
  }

  return chromeRemoteDebuggingPromptFragments.some((promptFragment) =>
    normalizedText.includes(normalizeUiText(promptFragment)),
  );
}

export function matchesChromeRemoteDebuggingAllowButton(text: string): boolean {
  const normalizedText = normalizeUiText(text);

  if (!normalizedText) {
    return false;
  }

  return chromeRemoteDebuggingAllowButtonLabels.some(
    (buttonLabel) => normalizedText === normalizeUiText(buttonLabel),
  );
}

export function getChromeRemoteDebuggingPromptFragments(): string[] {
  return [...chromeRemoteDebuggingPromptFragments];
}

export function getChromeRemoteDebuggingAllowButtonLabels(): string[] {
  return [...chromeRemoteDebuggingAllowButtonLabels];
}
