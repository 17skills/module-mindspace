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

  const cell = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-grid-id='${id}']`) as HTMLElement;

  it("Desktop: 12-Spalten-Raster mit 72-px-Zeilen und gewichteten Startgrößen", () => {
    const { container } = render(
      <AppEngine nodes={[metricNode, mapNode]} layout="free" editable previewDevice="desktop" />,
    );
    const grid = container.querySelector("[data-layout='free'] section") as HTMLElement;
    expect(container.querySelector("[data-device='desktop']")).not.toBeNull();
    expect(grid.className).toContain("grid-cols-12");
    expect(grid.style.gridAutoRows).toBe("72px");
    expect(cell(container, metricNode.id).style.gridColumn).toBe("1 / span 4");
    expect(cell(container, mapNode.id).style.gridColumn).toBe("5 / span 8");
    expect(screen.getByText(/Desktop-Anordnung/)).toBeInTheDocument();
  });

  it("Tablet: mehrspaltig, flachere Zeilen, übernimmt ohne eigene Anordnung den Desktop", () => {
    const desktop = [{ id: mapNode.id, col: 1, row: 1, width: 7, height: 5 }];
    const { container } = render(
      <AppEngine nodes={[metricNode, mapNode]} layout="free" editable previewDevice="tablet" moduleLayout={desktop} />,
    );
    const grid = container.querySelector("[data-layout='free'] section") as HTMLElement;
    expect(grid.className).not.toContain("!block");
    expect(grid.style.gridAutoRows).toBe("56px");
    expect(cell(container, mapNode.id).style.gridColumn).toBe("1 / span 7");
    expect(screen.getByRole("button", { name: /Lagekarte Größe ändern/ })).toBeInTheDocument();
  });

  it("Tablet: eigene gespeicherte Anordnung hat Vorrang vor dem Desktop", () => {
    const { container } = render(
      <AppEngine
        nodes={[mapNode]}
        layout="free"
        previewDevice="tablet"
        moduleLayout={[{ id: mapNode.id, col: 1, row: 1, width: 7, height: 5 }]}
        deviceLayouts={{ tablet: [{ id: mapNode.id, col: 3, row: 2, width: 10, height: 4 }] }}
      />,
    );
    expect(cell(container, mapNode.id).style.gridColumn).toBe("3 / span 10");
    expect(cell(container, mapNode.id).style.gridRow).toBe("2 / span 4");
  });

  it("Handy: startet als einspaltiger Stapel mit modulgerechten Höhen und bleibt bearbeitbar", () => {
    const { container } = render(
      <AppEngine nodes={[metricNode, mapNode]} layout="free" editable previewDevice="mobile" />,
    );
    expect(cell(container, metricNode.id).style.gridColumn).toBe("1 / span 12");
    expect(cell(container, metricNode.id).style.gridRow).toBe("1 / span 2");
    expect(cell(container, mapNode.id).style.gridRow).toBe("3 / span 5");
    expect(screen.getByRole("button", { name: /Lagekarte verschieben/ })).toBeInTheDocument();
    expect(screen.getByText(/Handy-Anordnung/)).toBeInTheDocument();
  });

  it("Handy: nutzt die eigene Anordnung und hebt zu schmale Module auf halbe Breite", () => {
    const { container } = render(
      <AppEngine
        nodes={[metricNode, mapNode]}
        layout="free"
        previewDevice="mobile"
        moduleLayout={[{ id: mapNode.id, col: 1, row: 1, width: 8, height: 6 }]}
        deviceLayouts={{ mobile: [
          { id: mapNode.id, col: 1, row: 1, width: 12, height: 6 },
          { id: metricNode.id, col: 1, row: 7, width: 3, height: 2 },
        ] }}
      />,
    );
    expect(cell(container, mapNode.id).style.gridRow).toBe("1 / span 6");
    expect(cell(container, metricNode.id).style.gridColumn).toBe("1 / span 6");
  });
});
