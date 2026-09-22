/**
 * Vorlagen für verbreitete MCP-Server (Produktivität & Team).
 * Die Adressen sind Vorschläge: gehostete Endpunkte der Anbieter bzw. übliche
 * Bridge-Adressen. Der Nutzer kann sie im Formular anpassen.
 */
export type McpTemplateAuth = "none" | "bearer" | "header";

export type McpTemplate = {
  id: string;
  name: string;
  /** Kurzbeschreibung für die Kachel. */
  summary: string;
  /** Vorgeschlagene Adresse (anpassbar). */
  url: string;
  /** Platzhalter, wenn die Adresse instanzabhängig ist. */
  urlHint?: string;
  authKind: McpTemplateAuth;
  headerName?: string;
  /** Hinweis, welcher Schlüssel benötigt wird. */
  tokenHint?: string;
  /** Typische Werkzeuge, nur zur Vorschau. */
  tools: string[];
};

export const MCP_TEMPLATES: McpTemplate[] = [
  {
    id: "slack",
    name: "Slack",
    summary: "Warnungen in Kanäle senden und Nachrichten lesen.",
    url: "https://mcp.slack.com/mcp",
    authKind: "bearer",
    tokenHint: "Bot-Token der Slack-App (xoxb-…)",
    tools: ["post_message", "list_channels", "get_thread"],
  },
  {
    id: "github",
    name: "GitHub",
    summary: "Maßnahmen als Issues anlegen und Repos durchsuchen.",
    url: "https://api.githubcopilot.com/mcp/",
    authKind: "bearer",
    tokenHint: "Personal Access Token (ghp_… / github_pat_…)",
    tools: ["create_issue", "search_issues", "get_file_contents"],
  },
  {
    id: "jira",
    name: "Jira",
    summary: "Befunde als Vorgänge mit Priorität und Fälligkeit anlegen.",
    url: "https://mcp.atlassian.com/v1/sse",
    urlHint: "Bei eigener Bridge: https://deine-domain.atlassian.net/mcp",
    authKind: "bearer",
    tokenHint: "Atlassian API-Token",
    tools: ["create_issue", "search_issues", "transition_issue"],
  },
  {
    id: "notion",
    name: "Notion",
    summary: "Wissen abfragen und Berichte als Seite ablegen.",
    url: "https://mcp.notion.com/mcp",
    authKind: "bearer",
    tokenHint: "Integrations-Geheimnis (ntn_… / secret_…)",
    tools: ["search", "query_database", "create_page"],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    summary: "Protokolle und Tabellen direkt aus dem Ordner lesen.",
    url: "https://mcp.google.com/drive/mcp",
    urlHint: "Oder Adresse deiner eigenen Drive-Bridge",
    authKind: "bearer",
    tokenHint: "OAuth-Zugriffstoken mit Drive-Leserecht",
    tools: ["search_files", "read_file", "list_folder"],
  },
  {
    id: "onedrive",
    name: "OneDrive",
    summary: "Dateien aus Microsoft 365 in Module einlesen.",
    url: "https://graph.microsoft.com/mcp",
    urlHint: "Oder Adresse deiner eigenen Graph-Bridge",
    authKind: "bearer",
    tokenHint: "Microsoft-Graph-Token (Files.Read)",
    tools: ["search_files", "get_drive_item", "read_content"],
  },
  {
    id: "miro",
    name: "Miro",
    summary: "Workshop-Karten importieren und Ergebnisse zurückspiegeln.",
    url: "https://mcp.miro.com/mcp",
    authKind: "bearer",
    tokenHint: "Miro API-Token der eigenen App",
    tools: ["list_boards", "get_items", "create_sticky_note"],
  },
];

export function findMcpTemplate(id: string): McpTemplate | undefined {
  return MCP_TEMPLATES.find((entry) => entry.id === id);
}
