/** Prüft die App-Engine: alle Aufbauten, alle Modularten, Desktop und Handy. */
import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppEngine, AppModule } from "@/components/app/AppEngine";
import {
  factorNode,
  gaugeNode,
  inspectNode,
  mapNode,
  metricNode,
  riskNode,
  textNode,
} from "@/test/nodes";

const all = [metricNode, gaugeNode, factorNode, riskNode, inspectNode, mapNode, textNode];

describe("Modularten", () => {
  it("zeigt den Wert einer Kennzahl", () => {
    render(<AppModule node={metricNode} nodes={[metricNode]} />);
    expect(screen.getByText("Sofort-Maßnahmen")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("zeigt Faktor-Gesamtwert und Parameter", () => {
    render(<AppModule node={factorNode} nodes={[factorNode]} />);
    expect(screen.getByText("Alter")).toBeInTheDocument();
    expect(screen.getByText("Korrosion")).toBeInTheDocument();
    expect(screen.getByText("/10")).toBeInTheDocument();
  });

  it("zeigt Risikofelder mit Klassenfarbe", () => {
    render(<AppModule node={riskNode} nodes={[riskNode]} />);
    expect(screen.getByText("R1 · Sturm")).toBeInTheDocument();
    expect(screen.getByText("16")).toBeInTheDocument();
  });

  it("zeigt Befunde, filtert sie und meldet Statuswechsel", () => {
    const setStatus = vi.fn();
    render(<AppModule node={inspectNode} nodes={[inspectNode]} actions={{ setStatus }} />);
    expect(screen.getByText("Zaun beschädigt")).toBeInTheDocument();
    expect(screen.getByText("Graffiti")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "offen" }));
    expect(screen.queryByText("Graffiti")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Zaun beschädigt"));
    fireEvent.click(screen.getByRole("button", { name: "beauftragt" }));
    expect(setStatus).toHaveBeenCalledWith(
      inspectNode.id,
      expect.objectContaining({ id: "f1" }),
      "beauftragt",
    );
  });

  it("zeigt Textinhalte und leere Module verständlich", () => {
    const { rerender } = render(<AppModule node={textNode} nodes={[textNode]} />);
    expect(screen.getByText("Bitte Zufahrt beachten.")).toBeInTheDocument();
    rerender(
      <AppModule node={{ ...textNode, content: null }} nodes={[textNode]} />,
    );
    expect(screen.getByText(/noch keinen Inhalt/)).toBeInTheDocument();
  });

  it("rendert die Karte ohne Absturz", () => {
    render(<AppModule node={mapNode} nodes={all} />);
    expect(screen.getByText("Lagekarte")).toBeInTheDocument();
  });
});

describe("Aufbauten", () => {
  it("zeigt in jedem Aufbau alle gewählten Module", () => {
    for (const layout of ["auto", "free", "split", "dashboard", "feed", "report"] as const) {
      const { unmount } = render(<AppEngine nodes={all} layout={layout} />);
      for (const node of all) {
        expect(screen.getByText(node.title!)).toBeInTheDocument();
      }
      unmount();
    }
  });

  it("stellt im geteilten Aufbau ein breites Modul voran", () => {
    const { container } = render(<AppEngine nodes={[metricNode, mapNode]} layout="split" />);
    const main = container.querySelector("main")!;
    expect(within(main).getByText("Lagekarte")).toBeInTheDocument();
    expect(main.className).toContain("lg:grid-cols-");
  });

  it("trennt im Kennzahlen-Raster Kacheln von breiten Modulen", () => {
    const { container } = render(
      <AppEngine nodes={[metricNode, gaugeNode, riskNode]} layout="dashboard" />,
    );
    const grids = container.querySelectorAll("main > div");
    expect(grids.length).toBe(2);
    expect(within(grids[0] as HTMLElement).getByText("Auslastung")).toBeInTheDocument();
    expect(within(grids[1] as HTMLElement).getByText("Netzrisiko")).toBeInTheDocument();
  });

  it("nennt den leeren Zustand", () => {
    render(<AppEngine nodes={[]} layout="auto" />);
    expect(screen.getByText(/noch kein Modul/)).toBeInTheDocument();
  });

  it("bietet in der freien Fläche Griffe zum Verschieben und Vergrößern", () => {
    render(<AppEngine nodes={[metricNode, riskNode]} layout="free" editable />);
    expect(screen.getByRole("button", { name: /Sofort-Maßnahmen verschieben/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Netzrisiko Größe ändern/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raster anzeigen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Magnetisches Einrasten" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rückgängig" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Wiederherstellen" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Links ausrichten" })).toBeDisabled();
  });

  it("blendet Editorwerkzeuge in der Handy-Vorschau aus", () => {
    render(<AppEngine nodes={[metricNode, riskNode]} layout="free" editable previewDevice="mobile" />);
    expect(screen.queryByRole("button", { name: "Raster anzeigen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /verschieben/ })).not.toBeInTheDocument();
  });

  it("hält auf dem Tablet das mehrspaltige Raster mit flacheren Zeilen", () => {
    const { container } = render(
      <AppEngine nodes={[metricNode, mapNode]} layout="free" editable previewDevice="tablet" />,
    );
    const grid = container.querySelector("[data-layout='free'] section") as HTMLElement;
    expect(grid.className).toContain("grid-cols-12");
    expect(grid.className).not.toContain("!block");
    expect(grid.style.gridAutoRows).toBe("56px");
    expect(screen.getByRole("button", { name: /Netzkarte Größe ändern/ })).toBeInTheDocument();
  });

  it("stapelt auf dem Handy einspaltig mit modulgerechten Höhen", () => {
    const { container } = render(
      <AppEngine nodes={[metricNode, mapNode]} layout="free" previewDevice="mobile" />,
    );
    const tiles = Array.from(container.querySelectorAll("[data-grid-id]")) as HTMLElement[];
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.style.minHeight).toBe("110px");
    expect(tiles[1]!.style.minHeight).toBe("360px");
  });
});


describe("Vorschau auf Desktop und Handy", () => {
  const widths = [
    { device: "desktop", width: 1280 },
    { device: "mobile", width: 390 },
  ] as const;

  it("rendert jeden Aufbau in beiden Vorschaubreiten", () => {
    for (const { device, width } of widths) {
      for (const layout of ["auto", "free", "split", "dashboard", "feed", "report"] as const) {
        const { container, unmount } = render(
          <div style={{ width }} data-device={device}>
            <AppEngine nodes={all} layout={layout} />
          </div>,
        );
        expect(container.querySelector("main")).toBeTruthy();
        expect(screen.getAllByText("Sofort-Maßnahmen").length).toBe(1);
        unmount();
      }
    }
  });
});
