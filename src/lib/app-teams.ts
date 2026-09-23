/**
 * Microsoft Teams: Entscheidungskarte (Adaptive Card) und App-Manifest für eine
 * ausgelieferte scopebuilder-App. Reine Funktionen – client- und serverseitig nutzbar.
 */

export type TeamsCardInput = {
  title: string;
  headline: string;
  signal: "ok" | "warn" | "alert";
  description: string;
  boardTitle: string;
  leadQuestion: string;
  metrics: { label: string; value: string; hint: string }[];
  appUrl: string;
  updatedAt: string;
};

const SIGNAL_COLOR: Record<TeamsCardInput["signal"], "good" | "warning" | "attention"> = {
  ok: "good",
  warn: "warning",
  alert: "attention",
};

const SIGNAL_LABEL: Record<TeamsCardInput["signal"], string> = {
  ok: "Grün",
  warn: "Bernstein",
  alert: "Rot",
};

/** Adaptive Card 1.5 – so sieht die Lage im Teams-Kanal aus. */
export function buildAdaptiveCard(input: TeamsCardInput) {
  const body: Record<string, unknown>[] = [
    {
      type: "ColumnSet",
      columns: [
        {
          type: "Column",
          width: "stretch",
          items: [
            { type: "TextBlock", text: input.title, weight: "Bolder", size: "Large", wrap: true },
            {
              type: "TextBlock",
              text: input.boardTitle,
              isSubtle: true,
              spacing: "None",
              wrap: true,
            },
          ],
        },
        {
          type: "Column",
          width: "auto",
          items: [
            {
              type: "TextBlock",
              text: `● ${SIGNAL_LABEL[input.signal]}`,
              color: SIGNAL_COLOR[input.signal],
              weight: "Bolder",
            },
          ],
        },
      ],
    },
    {
      type: "TextBlock",
      text: input.headline,
      weight: "Bolder",
      color: SIGNAL_COLOR[input.signal],
      wrap: true,
    },
  ];

  if (input.leadQuestion.trim()) {
    body.push({ type: "TextBlock", text: input.leadQuestion.trim(), wrap: true, isSubtle: true });
  } else if (input.description.trim()) {
    body.push({ type: "TextBlock", text: input.description.trim(), wrap: true, isSubtle: true });
  }

  if (input.metrics.length) {
    body.push({
      type: "FactSet",
      facts: input.metrics.slice(0, 6).map((metric) => ({
        title: metric.label,
        value: metric.hint ? `${metric.value} — ${metric.hint}` : metric.value,
      })),
    });
  }

  body.push({
    type: "TextBlock",
    text: `Stand: ${new Date(input.updatedAt).toLocaleString("de-DE")}`,
    size: "Small",
    isSubtle: true,
    wrap: true,
  });

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body,
    actions: [
      { type: "Action.OpenUrl", title: "Entscheider-Cockpit öffnen", url: input.appUrl },
    ],
  };
}

/** Karte fertig verpackt für einen eingehenden Teams-Webhook. */
export function buildWebhookPayload(input: TeamsCardInput) {
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: buildAdaptiveCard(input),
      },
    ],
  };
}

/** Teams-App-Manifest: die App als Registerkarte in Kanal und persönlichem Bereich. */
export function buildTeamsManifest(input: {
  appId: string;
  title: string;
  description: string;
  origin: string;
}) {
  const host = new URL(input.origin).host;
  const short = input.title.slice(0, 30) || "scopebuilder";
  return {
    $schema: "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: "1.0.0",
    id: input.appId,
    developer: {
      name: "scopebuilder",
      websiteUrl: input.origin,
      privacyUrl: `${input.origin}/datenschutz`,
      termsOfUseUrl: `${input.origin}/agb`,
    },
    name: { short, full: input.title.slice(0, 100) || "scopebuilder App" },
    description: {
      short: (input.description || "Entscheidungsgrundlage aus scopebuilder").slice(0, 80),
      full: (
        input.description || "Kennzahlen, Risiken und Maßnahmen aus einem scopebuilder-Scope."
      ).slice(0, 4000),
    },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: "#1C2321",
    staticTabs: [
      {
        entityId: `scope-app-${input.appId}`,
        name: short,
        contentUrl: `${input.origin}/app/${input.appId}?teams=1`,
        websiteUrl: `${input.origin}/app/${input.appId}`,
        scopes: ["personal"],
      },
    ],
    configurableTabs: [
      {
        configurationUrl: `${input.origin}/app/${input.appId}?teams=1`,
        canUpdateConfiguration: true,
        scopes: ["team", "groupChat"],
      },
    ],
    permissions: ["identity"],
    validDomains: [host],
  };
}
