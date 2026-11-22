export type ProtonAiHistoryKind = "assistant" | "translation" | "image";

export type ProtonAiHistorySummary = {
  id: string;
  kind: ProtonAiHistoryKind;
  createdAt: string;
  expiresAt: string;
};

export type ProtonAiHistoryEntry = {
  summary: ProtonAiHistorySummary;
  content:
    | { kind: "assistant"; prompt: string; text: string }
    | { kind: "translation"; language: string; text: string }
    | { kind: "image"; contentType: string; contentBase64: string };
};
