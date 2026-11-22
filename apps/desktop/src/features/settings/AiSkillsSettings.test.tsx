import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSkillsSettings } from "./AiSkillsSettings";
import { getAiSkill, listAiSkills, previewAiSkillSelection, validateAiSkill } from "../../lib/api/skills";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";

vi.mock("../../lib/api/skills", () => ({
  listAiSkills: vi.fn(),
  getAiSkill: vi.fn(),
  validateAiSkill: vi.fn(),
  previewAiSkillSelection: vi.fn(),
}));

const diagramMode = {
  id: "diagram_flow",
  name: "Flujo",
  description: "Procesos y decisiones.",
  whenToUse: ["Hay pasos conectados."],
  whenNotToUse: ["Hay datos tabulares."],
  supportedActions: ["insert_diagram", "answer"],
  requiresCapabilities: ["diagrams"],
  validators: ["mermaid.policy", "mermaid.flow"],
  riskLevel: "low" as const,
  contextBudget: 900,
};

const mermaidSkill = {
  id: "neubiki.mermaid",
  name: "Mermaid",
  version: "2.0.0",
  source: "base" as const,
  status: "valid" as const,
  visibility: "readonly" as const,
  runtimeEnabled: true,
  description: "Genera diagramas Mermaid.",
  categories: ["diagrams"],
  capabilities: ["mermaid"],
  outputActions: ["insert_diagram"],
  modes: [diagramMode],
};

const mermaidDetail = {
  ...mermaidSkill,
  manifest: {
    schemaVersion: 2,
    id: mermaidSkill.id,
    name: mermaidSkill.name,
    version: mermaidSkill.version,
    source: mermaidSkill.source,
    description: mermaidSkill.description,
    categories: mermaidSkill.categories,
    capabilities: mermaidSkill.capabilities,
    outputActions: mermaidSkill.outputActions,
    requires: [],
    validators: ["mermaid.policy"],
    runtimeEnabled: true,
    modes: [diagramMode],
  },
  manifestJson: JSON.stringify({ id: mermaidSkill.id }, null, 2),
  instructionsMarkdown: "# Objetivo\n\nCrear diagramas Mermaid.",
  examples: [{ name: "ejemplo.md", markdown: "```mermaid\nflowchart TD\n```" }],
  diagnostics: [{
    skillId: mermaidSkill.id,
    status: "applied" as const,
    title: "Skill valida",
    notes: ["Manifest disponible."],
    phase: "validation" as const,
    severity: "info" as const,
  }],
  mermaidCatalog: [{
    id: "flowchart",
    label: "Flowchart",
    family: "flow",
    maturity: "stable" as const,
    aliases: ["graph"],
    requiredPolicy: "stable",
    validatorId: "mermaid.flow",
  }],
};

beforeEach(() => {
  vi.mocked(listAiSkills).mockResolvedValue({ skills: [mermaidSkill] });
  vi.mocked(getAiSkill).mockResolvedValue(mermaidDetail);
  vi.mocked(validateAiSkill).mockResolvedValue({
    skillId: mermaidSkill.id,
    status: "valid",
    diagnostics: mermaidDetail.diagnostics,
  });
  vi.mocked(previewAiSkillSelection).mockResolvedValue({
    status: "ok",
    selectorStatus: "preview",
    candidateSkills: [mermaidSkill],
    proposed: [],
    applications: [{
      skillId: "neubiki.mermaid",
      modeId: "diagram_flow",
      action: "insert_diagram",
      status: "applied",
      reason: "Diagrama solicitado.",
      confidence: "high",
    }],
    diagnostics: mermaidDetail.diagnostics,
    promptGuidance: "Skill Mermaid activa.",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AiSkillsSettings", () => {
  it("loads base skills and shows read-only skill content", async () => {
    render(<AiSkillsSettings />);

    expect(await screen.findByRole("button", { name: /mermaid/i })).toBeInTheDocument();
    expect(screen.getAllByText("Base").length).toBeGreaterThan(0);
    expect(await screen.findByText(/Skill base incluida con Neubiki/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /instrucciones/i }));
    expect(screen.getByText(/Crear diagramas Mermaid/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /manifest/i }));
    expect(screen.getByText(/neubiki.mermaid/i)).toBeInTheDocument();
  });

  it("shows compact modes, Mermaid catalog and selection preview", async () => {
    render(<AiSkillsSettings />);

    await screen.findByRole("button", { name: /mermaid/i });
    await screen.findByRole("button", { name: /validar skill/i });
    fireEvent.click(screen.getByRole("tab", { name: /modos/i }));
    expect(screen.getByText("Flujo")).toBeInTheDocument();
    expect(screen.getByText(/flowchart · stable/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /resumen/i }));
    fireEvent.click(screen.getByRole("button", { name: /previsualizar seleccion/i }));
    await waitFor(() => expect(previewAiSkillSelection).toHaveBeenCalled());
    expect(await screen.findByText(/mermaid \/ diagram_flow/i)).toBeInTheDocument();
  });

  it("runs skill validation and opens diagnostics", async () => {
    render(<AiSkillsSettings />);

    await screen.findByRole("button", { name: /mermaid/i });
    await screen.findByRole("button", { name: /validar skill/i });
    fireEvent.click(screen.getByRole("button", { name: /validar skill/i }));

    await waitFor(() => expect(validateAiSkill).toHaveBeenCalledWith("neubiki.mermaid"));
    expect(await screen.findByText("Skill valida")).toBeInTheDocument();
  });

  it("localizes the English inspector while preserving original skill text, manifests and diagnostics", async () => {
    render(<UiLocaleProvider language="en"><AiSkillsSettings /></UiLocaleProvider>);
    expect(screen.getByRole("heading", { name: "AI skills" })).toBeVisible();
    expect(await screen.findByRole("tablist", { name: "Skill details" })).toBeVisible();
    expect(screen.getAllByText(mermaidSkill.description).length).toBeGreaterThan(0);
    const sourceFilter = screen.getByRole("combobox", { name: "Filter by source" });
    fireEvent.change(sourceFilter, { target: { value: "user" } });
    expect(screen.getByText("No skills match these filters.")).toBeVisible();
    fireEvent.change(sourceFilter, { target: { value: "base" } });

    fireEvent.click(screen.getByRole("tab", { name: "Instructions" }));
    const instructions = screen.getByRole("tabpanel", { name: "Instructions" });
    expect(instructions.querySelector("pre")?.textContent).toBe(mermaidDetail.instructionsMarkdown);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Instructions" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Manifest" })).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Manifest" }).querySelector("pre")?.textContent).toBe(mermaidDetail.manifestJson);
    fireEvent.click(screen.getByRole("tab", { name: "Examples" }));
    expect(within(screen.getByRole("tabpanel", { name: "Examples" })).getByText("ejemplo.md")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt to test selection" }), { target: { value: "Compara dos opciones." } });
    fireEvent.change(screen.getByRole("combobox", { name: "Expected action" }), { target: { value: "insert_diagram" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview selection" }));
    expect(await screen.findByText("mermaid / diagram_flow")).toBeVisible();
    expect(previewAiSkillSelection).toHaveBeenCalledWith({ prompt: "Compara dos opciones.", expectedAction: "insert_diagram" });

    fireEvent.click(screen.getByRole("button", { name: "Validate skill" }));
    const diagnostics = within(await screen.findByRole("tabpanel", { name: "Diagnostics" }));
    expect(diagnostics.getByText("Skill valida")).toBeVisible();
    expect(diagnostics.getByText("Manifest disponible.")).toBeVisible();
    expect(validateAiSkill).toHaveBeenCalledWith("neubiki.mermaid");
  });
});
